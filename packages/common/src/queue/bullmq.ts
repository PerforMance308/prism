// BullMQWorkerQueue - Redis-backed queue using BullMQ
//
// Each queue name maps to a separate BullMQ Queue + Worker pair.
// Dead-letter handling: failed jobs (exhausted retries) remain in the
// BullMQ "failed" set and are reflected in getStats().

import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { IWorkerQueue, JobOptions, JobRecord, JobHandler, QueueStats } from './interface.js';

export interface BullMQWorkerQueueOptions {
  /** Redis connection URL, e.g. redis://localhost:6379 */
  url?: string;
  /** Pre-built ioredis ConnectionOptions (takes precedence over url) */
  connection?: ConnectionOptions;
  /** Default number of job attempts (default 3) */
  defaultAttempts?: number;
}

interface ManagedQueue {
  queue: Queue;
  workers: Worker[];
}

function parseConnection(opts: BullMQWorkerQueueOptions): ConnectionOptions {
  if (opts.connection) return opts.connection;
  const url = new URL(opts.url ?? 'redis://localhost:6379');
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password || undefined,
    db: url.pathname ? Number(url.pathname.slice(1)) || 0 : 0,
  };
}

export class BullMQWorkerQueue implements IWorkerQueue {
  private readonly connection: ConnectionOptions;
  private readonly defaultAttempts: number;
  private readonly managed = new Map<string, ManagedQueue>();

  constructor(opts: BullMQWorkerQueueOptions = {}) {
    this.connection = parseConnection(opts);
    this.defaultAttempts = opts.defaultAttempts ?? 3;
  }

  async enqueue<T>(queueName: string, data: T, opts: JobOptions = {}): Promise<string> {
    const managed = this.getOrCreateQueue(queueName);
    const job = await managed.queue.add(queueName, data as object, {
      attempts: opts.attempts ?? this.defaultAttempts,
      delay: opts.delay,
      priority: opts.priority,
      backoff: opts.backoff
        ? { type: opts.backoff.type, delay: opts.backoff.delay }
        : { type: 'exponential', delay: 1000 },
    });
    return job.id ?? '';
  }

  process<T>(queueName: string, handler: JobHandler<T>): () => Promise<void> {
    const managed = this.getOrCreateQueue(queueName);
    const worker = new Worker(
      queueName,
      async (job) => {
        const record: JobRecord<T> = {
          id: job.id ?? '',
          name: job.name,
          data: job.data as T,
          attempts: job.attemptsMade,
          createdAt: new Date(job.timestamp).toISOString(),
        };
        await handler(record);
      },
      { connection: this.connection },
    );
    managed.workers.push(worker);

    return async () => {
      const idx = managed.workers.indexOf(worker);
      if (idx !== -1) managed.workers.splice(idx, 1);
      await worker.close();
    };
  }

  async getStats(queueName: string): Promise<QueueStats> {
    const managed = this.managed.get(queueName);
    if (!managed) return { waiting: 0, active: 0, completed: 0, failed: 0 };
    const [waiting, active, completed, failed] = await Promise.all([
      managed.queue.getWaitingCount(),
      managed.queue.getActiveCount(),
      managed.queue.getCompletedCount(),
      managed.queue.getFailedCount(),
    ]);
    return { waiting, active, completed, failed };
  }

  async close(): Promise<void> {
    await Promise.all(
      Array.from(this.managed.values()).flatMap(({ queue, workers }) => [
        queue.close(),
        ...workers.map((w) => w.close()),
      ]),
    );
    this.managed.clear();
  }

  private getOrCreateQueue(queueName: string): ManagedQueue {
    if (!this.managed.has(queueName)) {
      this.managed.set(queueName, {
        queue: new Queue(queueName, { connection: this.connection }),
        workers: [],
      });
    }

    return this.managed.get(queueName)!;
  }
}
