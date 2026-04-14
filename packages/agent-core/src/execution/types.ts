// Execution Agent types

import type { Action } from '@agentic-obs/common';
import type { StructuredConclusion } from '../explanation/types.js';

// Re-export adapter types from common for backward compatibility
export type {
  AdapterAction,
  AdapterCapability,
  ValidationResult,
  DryRunResult,
  ExecutionResult,
  ExecutionAdapter,
} from '@agentic-obs/common';

export interface ExecutionInput {
  conclusion: StructuredConclusion;
  context: {
    entity: string;
    environment?: string;
  };
}

export interface ExecutionOutput {
  /** Suggested actions - none auto-execute in Phase 0 */
  actions: Action[];
  /** Human-readable summary of all proposed actions */
  summary: string;
}
