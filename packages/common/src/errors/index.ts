// Structured error hierarchy for the API gateway and shared use.

export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION', 400, message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super('NOT_FOUND', 404, `${resource} not found`);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super('UNAUTHORIZED', 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', 403, message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super('CONFLICT', 409, message);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(service: string) {
    super('SERVICE_UNAVAILABLE', 503, `${service} is not configured or unavailable`);
  }
}

/**
 * Extract a human-readable message from an unknown caught value.
 * Use in catch blocks instead of `err instanceof Error ? err.message : String(err)`.
 */
export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Re-export existing error classes so barrel import paths stay stable.
export { LLMUnavailableError } from './llm-unavailable.js';
