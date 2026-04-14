import { Router } from 'express';
import type { Response, NextFunction } from 'express';
import type { ApiError, WorkspaceSettings } from '@agentic-obs/common';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { authMiddleware } from '../middleware/auth.js';
import type { IWorkspaceRepository } from '@agentic-obs/data-layer';
import { defaultWorkspaceStore } from '@agentic-obs/data-layer';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface WorkspaceRouterDeps {
  store?: IWorkspaceRepository;
}

/**
 * Returns the requesting user's role within a workspace, or undefined if they are not a member.
 * The workspace owner is always treated as 'owner' even if not in the members array.
 */
function getMemberRole(
  workspace: import('@agentic-obs/common').Workspace,
  userId: string,
): 'owner' | 'admin' | 'editor' | 'viewer' | undefined {
  if (workspace.ownerId === userId) return 'owner';
  const member = workspace.members.find((m) => m.userId === userId);
  return member?.role;
}

export function createWorkspaceRouter(deps: WorkspaceRouterDeps = {}): Router {
  const store: IWorkspaceRepository = deps.store ?? defaultWorkspaceStore;
  const router = Router();
  router.use(authMiddleware);

  // GET /api/workspaces - list workspaces for current user
  router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.auth?.sub;
      if (!userId) {
        const err: ApiError = { code: 'UNAUTHORIZED', message: 'authentication required' };
        res.status(401).json(err);
        return;
      }
      const workspaces = await store.findByMember(userId);
      res.json({ list: workspaces });
    } catch (err) { next(err); }
  });

  // POST /api/workspaces - create workspace
  router.post('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.auth?.sub;
      if (!userId) {
        const err: ApiError = { code: 'UNAUTHORIZED', message: 'authentication required' };
        res.status(401).json(err);
        return;
      }

      const { name, slug, settings } = req.body as {
        name?: string;
        slug?: string;
        settings?: WorkspaceSettings;
      };

      if (typeof name !== 'string' || !name.trim()) {
        const err: ApiError = { code: 'INVALID_INPUT', message: 'name is required and must be a non-empty string' };
        res.status(400).json(err);
        return;
      }

      if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
        const err: ApiError = {
          code: 'INVALID_INPUT',
          message: 'slug is required and must be a lowercase alphanumeric string with hyphens (e.g. "my-workspace")',
        };
        res.status(400).json(err);
        return;
      }

      // Check slug uniqueness
      if (await store.findBySlug(slug)) {
        const err: ApiError = { code: 'CONFLICT', message: `a workspace with slug "${slug}" already exists` };
        res.status(409).json(err);
        return;
      }

      const workspace = await store.create({
        name: name.trim(),
        slug,
        ownerId: userId,
        settings,
      });

      res.status(201).json(workspace);
    } catch (err) { next(err); }
  });

  // GET /api/workspaces/:id - get workspace (members only)
  router.get('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.auth?.sub;
      if (!userId) { res.status(401).json({ code: 'UNAUTHORIZED', message: 'authentication required' } satisfies ApiError); return; }

      const workspace = await store.findById(req.params['id']!);
      if (!workspace) {
        const err: ApiError = { code: 'NOT_FOUND', message: 'workspace not found' };
        res.status(404).json(err);
        return;
      }

      if (!getMemberRole(workspace, userId)) {
        res.status(403).json({ code: 'FORBIDDEN', message: 'you are not a member of this workspace' } satisfies ApiError);
        return;
      }

      res.json(workspace);
    } catch (err) { next(err); }
  });

  // PUT /api/workspaces/:id - update workspace (owner/admin only)
  router.put('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.auth?.sub;
      if (!userId) { res.status(401).json({ code: 'UNAUTHORIZED', message: 'authentication required' } satisfies ApiError); return; }

      const workspace = await store.findById(req.params['id']!);
      if (!workspace) {
        const err: ApiError = { code: 'NOT_FOUND', message: 'workspace not found' };
        res.status(404).json(err);
        return;
      }

      const role = getMemberRole(workspace, userId);
      if (role !== 'owner' && role !== 'admin') {
        res.status(403).json({ code: 'FORBIDDEN', message: 'only workspace owner or admin can update settings' } satisfies ApiError);
        return;
      }

      const { name, slug, settings } = req.body as {
        name?: string;
        slug?: string;
        settings?: WorkspaceSettings;
      };

      const patch: Partial<Pick<import('@agentic-obs/common').Workspace, 'name' | 'slug' | 'settings'>> = {};
      if (name !== undefined) {
        if (typeof name !== 'string' || !name.trim()) {
          const err: ApiError = { code: 'INVALID_INPUT', message: 'name must be a non-empty string' };
          res.status(400).json(err);
          return;
        }
        patch.name = name.trim();
      }
      if (slug !== undefined) {
        if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
          const err: ApiError = { code: 'INVALID_INPUT', message: 'slug must be a lowercase alphanumeric string with hyphens' };
          res.status(400).json(err);
          return;
        }
        const existing = await store.findBySlug(slug);
        if (existing && existing.id !== req.params['id']) {
          const err: ApiError = { code: 'CONFLICT', message: `a workspace with slug "${slug}" already exists` };
          res.status(409).json(err);
          return;
        }
        patch.slug = slug;
      }
      if (settings !== undefined) {
        patch.settings = settings;
      }

      const updated = await store.update(req.params['id']!, patch);
      if (!updated) {
        const err: ApiError = { code: 'NOT_FOUND', message: 'workspace not found' };
        res.status(404).json(err);
        return;
      }
      res.json(updated);
    } catch (err) { next(err); }
  });

  // DELETE /api/workspaces/:id - delete workspace (owner only)
  router.delete('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.auth?.sub;
      if (!userId) { res.status(401).json({ code: 'UNAUTHORIZED', message: 'authentication required' } satisfies ApiError); return; }

      const workspace = await store.findById(req.params['id']!);
      if (!workspace) {
        const err: ApiError = { code: 'NOT_FOUND', message: 'workspace not found' };
        res.status(404).json(err);
        return;
      }

      if (getMemberRole(workspace, userId) !== 'owner') {
        res.status(403).json({ code: 'FORBIDDEN', message: 'only the workspace owner can delete it' } satisfies ApiError);
        return;
      }

      await store.delete(req.params['id']!);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // POST /api/workspaces/:id/members - add member (owner/admin only)
  router.post('/:id/members', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const callerId = req.auth?.sub;
      if (!callerId) { res.status(401).json({ code: 'UNAUTHORIZED', message: 'authentication required' } satisfies ApiError); return; }

      const workspace = await store.findById(req.params['id']!);
      if (!workspace) {
        const err: ApiError = { code: 'NOT_FOUND', message: 'workspace not found' };
        res.status(404).json(err);
        return;
      }

      const callerRole = getMemberRole(workspace, callerId);
      if (callerRole !== 'owner' && callerRole !== 'admin') {
        res.status(403).json({ code: 'FORBIDDEN', message: 'only workspace owner or admin can manage members' } satisfies ApiError);
        return;
      }

      const { userId, role } = req.body as { userId?: string; role?: string };

      if (typeof userId !== 'string' || !userId.trim()) {
        const err: ApiError = { code: 'INVALID_INPUT', message: 'userId is required' };
        res.status(400).json(err);
        return;
      }

      const validRoles = ['admin', 'editor', 'viewer'] as const;
      if (!role || !(validRoles as readonly string[]).includes(role)) {
        const err: ApiError = { code: 'INVALID_INPUT', message: `role must be one of: ${validRoles.join(', ')}` };
        res.status(400).json(err);
        return;
      }

      const updated = await store.addMember(req.params['id']!, {
        userId: userId.trim(),
        role: role as 'admin' | 'editor' | 'viewer',
      });

      if (!updated) {
        const err: ApiError = { code: 'NOT_FOUND', message: 'workspace not found' };
        res.status(404).json(err);
        return;
      }

      res.json(updated);
    } catch (err) { next(err); }
  });

  // DELETE /api/workspaces/:id/members/:userId - remove member (owner/admin only)
  router.delete('/:id/members/:userId', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const callerId = req.auth?.sub;
      if (!callerId) { res.status(401).json({ code: 'UNAUTHORIZED', message: 'authentication required' } satisfies ApiError); return; }

      const workspace = await store.findById(req.params['id']!);
      if (!workspace) {
        const err: ApiError = { code: 'NOT_FOUND', message: 'workspace not found' };
        res.status(404).json(err);
        return;
      }

      const callerRole = getMemberRole(workspace, callerId);
      if (callerRole !== 'owner' && callerRole !== 'admin') {
        res.status(403).json({ code: 'FORBIDDEN', message: 'only workspace owner or admin can remove members' } satisfies ApiError);
        return;
      }

      if (workspace.ownerId === req.params['userId']) {
        const err: ApiError = { code: 'INVALID_INPUT', message: 'cannot remove the workspace owner' };
        res.status(400).json(err);
        return;
      }

      const updated = await store.removeMember(req.params['id']!, req.params['userId']!);
      if (!updated) {
        const err: ApiError = { code: 'NOT_FOUND', message: 'workspace not found' };
        res.status(404).json(err);
        return;
      }

      res.json(updated);
    } catch (err) { next(err); }
  });

  return router;
}
