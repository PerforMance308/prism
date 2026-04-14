/**
 * Casts a typed value to the Record<string, unknown> shape that Drizzle ORM
 * requires for JSON columns. This centralises the unavoidable assertion so
 * callers don't scatter `as unknown as Record<string, unknown>` everywhere.
 */
export function toJsonColumn<T>(value: T): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}
