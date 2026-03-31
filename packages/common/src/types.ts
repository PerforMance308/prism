// Core domain types for Agentic Observability Platform

export type EntityId = string;

// Re-export all model types
export * from './models/index.js';

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}
