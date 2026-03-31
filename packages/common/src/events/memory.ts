// InMemoryEventBus - EventEmitter-backed, single-process implementation

import { EventEmitter } from 'events';
import type { IEventBus, EventHandler } from './interface.js';
import type { EventEnvelope } from './types.js';

export class InMemoryEventBus implements IEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Increase default max listeners to accommodate multiple subscribers per topic
    this.emitter.setMaxListeners(100);
  }

  async publish<T>(topic: string, event: EventEnvelope<T>): Promise<void> {
    this.emitter.emit(topic, event);
  }

  subscribe<T>(topic: string, handler: EventHandler<T>): () => void {
    const listener = (event: EventEnvelope<T>) => {
      void handler(event);
    };
    this.emitter.on(topic, listener);
    return () => {
      this.emitter.off(topic, listener);
    };
  }

  async close(): Promise<void> {
    this.emitter.removeAllListeners();
  }
}
