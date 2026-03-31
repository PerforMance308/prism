// WorkerQueueFactory - selects BullMQ or InMemory implementation based on config

import type { IWorkerQueue } from './interface.js';
import { InMemoryWorkerQueue } from './memory.js';
import { BullMQWorkerQueue } from './bullmq.js';
import type { BullMQWorkerQueueOptions } from './bullmq.js';

export type WorkerQueueBackend = 'memory' | 'bullmq';

export interface WorkerQueueConfig {
  backend: WorkerQueueBackend;
  bullmq?: BullMQWorkerQueueOptions;
}

export function createWorkerQueue(config: WorkerQueueConfig = { backend: 'memory' }): IWorkerQueue {
  if (config.backend === 'bullmq') {
    return new BullMQWorkerQueue(config.bullmq ?? {});
  }
  return new InMemoryWorkerQueue();
}

/**
 * Convenience factory that reads REDIS_URL from the environment.
 * Falls back to InMemoryWorkerQueue when REDIS_URL is not set.
 */
export function createWorkerQueueFromEnv(): IWorkerQueue {
  const redisUrl = process.env['REDIS_URL'];
  if (redisUrl) {
    return new BullMQWorkerQueue({ url: redisUrl });
  }
  return new InMemoryWorkerQueue();
}
