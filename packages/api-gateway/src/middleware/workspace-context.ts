import type { Request } from 'express';

/** Extract workspaceId from request -- checks header or query param */
export function getWorkspaceId(req: Request): string {
  // Priority: header > query > default
  return (req.headers['x-workspace-id'] as string)
    ?? (req.query['workspaceId'] as string)
    ?? 'default';
}
