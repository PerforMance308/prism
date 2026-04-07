import { eq, sql } from 'drizzle-orm';
import type { Workspace, WorkspaceMember } from '@agentic-obs/common';
import type { SqliteClient } from '../../db/sqlite-client.js';
import { workspaces } from '../../db/sqlite-schema.js';
import type { IWorkspaceRepository } from '../interfaces.js';

type WorkspaceRow = typeof workspaces.$inferSelect;

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function rowToWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    ownerId: row.ownerId,
    members: (row.members as WorkspaceMember[]) ?? [],
    settings: (row.settings as Workspace['settings']) ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class SqliteWorkspaceRepository implements IWorkspaceRepository {
  constructor(private readonly db: SqliteClient) {}

  async create(params: {
    name: string;
    slug: string;
    ownerId: string;
    settings?: Workspace['settings'];
  }): Promise<Workspace> {
    const now = new Date().toISOString();
    const id = uid();
    const members: WorkspaceMember[] = [
      { userId: params.ownerId, role: 'owner', joinedAt: now },
    ];
    const [row] = await this.db
      .insert(workspaces)
      .values({
        id,
        name: params.name,
        slug: params.slug,
        ownerId: params.ownerId,
        members: members as unknown[],
        settings: (params.settings ?? {}) as unknown as Record<string, unknown>,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return rowToWorkspace(row!);
  }

  async findById(id: string): Promise<Workspace | undefined> {
    const [row] = await this.db.select().from(workspaces).where(eq(workspaces.id, id));
    return row ? rowToWorkspace(row) : undefined;
  }

  async findBySlug(slug: string): Promise<Workspace | undefined> {
    const [row] = await this.db.select().from(workspaces).where(eq(workspaces.slug, slug));
    return row ? rowToWorkspace(row) : undefined;
  }

  async findByMember(userId: string): Promise<Workspace[]> {
    // SQLite JSON querying is limited; fetch all and filter in-memory
    const rows = await this.db.select().from(workspaces);
    return rows
      .filter((row) => {
        const members = row.members as WorkspaceMember[];
        return members.some((m) => m.userId === userId);
      })
      .map(rowToWorkspace);
  }

  async update(
    id: string,
    patch: Partial<Pick<Workspace, 'name' | 'slug' | 'settings'>>,
  ): Promise<Workspace | undefined> {
    const sets: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (patch.name !== undefined) sets.name = patch.name;
    if (patch.slug !== undefined) sets.slug = patch.slug;
    if (patch.settings !== undefined) sets.settings = patch.settings;
    const [row] = await this.db
      .update(workspaces)
      .set(sets)
      .where(eq(workspaces.id, id))
      .returning();
    return row ? rowToWorkspace(row) : undefined;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.delete(workspaces).where(eq(workspaces.id, id)).returning();
    return result.length > 0;
  }

  async addMember(
    workspaceId: string,
    member: { userId: string; role: WorkspaceMember['role'] },
  ): Promise<Workspace | undefined> {
    const ws = await this.findById(workspaceId);
    if (!ws) return undefined;

    // Don't add duplicate members
    if (ws.members.some((m) => m.userId === member.userId)) return ws;

    const members: WorkspaceMember[] = [
      ...ws.members,
      { userId: member.userId, role: member.role, joinedAt: new Date().toISOString() },
    ];

    const [row] = await this.db
      .update(workspaces)
      .set({ members: members as unknown[], updatedAt: new Date().toISOString() })
      .where(eq(workspaces.id, workspaceId))
      .returning();
    return row ? rowToWorkspace(row) : undefined;
  }

  async removeMember(workspaceId: string, userId: string): Promise<Workspace | undefined> {
    const ws = await this.findById(workspaceId);
    if (!ws) return undefined;

    // Cannot remove the owner
    if (ws.ownerId === userId) return undefined;

    const members = ws.members.filter((m) => m.userId !== userId);
    const [row] = await this.db
      .update(workspaces)
      .set({ members: members as unknown[], updatedAt: new Date().toISOString() })
      .where(eq(workspaces.id, workspaceId))
      .returning();
    return row ? rowToWorkspace(row) : undefined;
  }
}
