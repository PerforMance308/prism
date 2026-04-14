const MIN_JWT_SECRET_LENGTH = 32;

export function getJwtSecret(source: string): string {
  const secret = process.env['JWT_SECRET'];
  if (!secret) {
    throw new Error(`[${source}] FATAL: JWT_SECRET environment variable is required.`);
  }
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `[${source}] FATAL: JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters long.`,
    );
  }
  return secret;
}
