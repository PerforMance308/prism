import { eq } from 'drizzle-orm';
import type {
  Dashboard,
  DashboardStatus,
  DashboardVariable,
  PanelConfig,
  PublishStatus,
  DashboardType,
} from '@agentic-obs/common';
import type { SqliteClient } from '../../db/sqlite-client.js';
import { dashboards } from '../../db/sqlite-schema.js';
import type { IDashboardRepository } from '../interfaces.js';

type DbRow = typeof dashboards.$inferSelect;

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function rowToDashboard(row: DbRow): Dashboard {
  return {
    id: row.id,
    type: (row.type ?? 'dashboard') as DashboardType,
    title: row.title,
    description: row.description,
    prompt: row.prompt,
    userId: row.userId,
    status: row.status as DashboardStatus,
    panels: (row.panels as PanelConfig[]) ?? [],
    variables: (row.variables as DashboardVariable[]) ?? [],
    refreshIntervalSec: row.refreshIntervalSec,
    datasourceIds: (row.datasourceIds as string[]) ?? [],
    useExistingMetrics: row.useExistingMetrics,
    folder: row.folder ?? undefined,
    workspaceId: row.workspaceId ?? undefined,
    version: row.version ?? undefined,
    publishStatus: (row.publishStatus as PublishStatus) ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class SqliteDashboardRepository implements IDashboardRepository {
  constructor(private readonly db: SqliteClient) {}

  async create(params: {
    title: string;
    description: string;
    prompt: string;
    userId: string;
    datasourceIds: string[];
    useExistingMetrics?: boolean;
    folder?: string;
    workspaceId?: string;
  }): Promise<Dashboard> {
    const now = new Date().toISOString();
    const id = uid();
    const [row] = await this.db
      .insert(dashboards)
      .values({
        id,
        type: 'dashboard',
        title: params.title,
        description: params.description,
        prompt: params.prompt,
        userId: params.userId,
        status: 'generating',
        panels: [],
        variables: [],
        refreshIntervalSec: 30,
        datasourceIds: params.datasourceIds,
        useExistingMetrics: params.useExistingMetrics ?? true,
        folder: params.folder ?? null,
        workspaceId: params.workspaceId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return rowToDashboard(row!);
  }

  async findById(id: string): Promise<Dashboard | undefined> {
    const [row] = await this.db.select().from(dashboards).where(eq(dashboards.id, id));
    return row ? rowToDashboard(row) : undefined;
  }

  async findAll(userId?: string): Promise<Dashboard[]> {
    if (userId !== undefined) {
      const rows = await this.db.select().from(dashboards).where(eq(dashboards.userId, userId));
      return rows.map(rowToDashboard);
    }
    const rows = await this.db.select().from(dashboards);
    return rows.map(rowToDashboard);
  }

  async listByWorkspace(workspaceId: string): Promise<Dashboard[]> {
    const rows = await this.db
      .select()
      .from(dashboards)
      .where(eq(dashboards.workspaceId, workspaceId));
    return rows.map(rowToDashboard);
  }

  async update(
    id: string,
    patch: Partial<Pick<Dashboard, 'type' | 'title' | 'description' | 'panels' | 'variables' | 'refreshIntervalSec' | 'folder'>>,
  ): Promise<Dashboard | undefined> {
    const sets: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (patch.type !== undefined) sets.type = patch.type;
    if (patch.title !== undefined) sets.title = patch.title;
    if (patch.description !== undefined) sets.description = patch.description;
    if (patch.panels !== undefined) sets.panels = patch.panels;
    if (patch.variables !== undefined) sets.variables = patch.variables;
    if (patch.refreshIntervalSec !== undefined) sets.refreshIntervalSec = patch.refreshIntervalSec;
    if (patch.folder !== undefined) sets.folder = patch.folder;

    const [row] = await this.db
      .update(dashboards)
      .set(sets)
      .where(eq(dashboards.id, id))
      .returning();
    return row ? rowToDashboard(row) : undefined;
  }

  async updateStatus(id: string, status: DashboardStatus, error?: string): Promise<Dashboard | undefined> {
    const sets: Record<string, unknown> = {
      status,
      updatedAt: new Date().toISOString(),
    };
    if (error !== undefined) sets.error = error;

    const [row] = await this.db
      .update(dashboards)
      .set(sets)
      .where(eq(dashboards.id, id))
      .returning();
    return row ? rowToDashboard(row) : undefined;
  }

  async updatePanels(id: string, panels: PanelConfig[]): Promise<Dashboard | undefined> {
    const [row] = await this.db
      .update(dashboards)
      .set({ panels, updatedAt: new Date().toISOString() })
      .where(eq(dashboards.id, id))
      .returning();
    return row ? rowToDashboard(row) : undefined;
  }

  async updateVariables(id: string, variables: DashboardVariable[]): Promise<Dashboard | undefined> {
    const [row] = await this.db
      .update(dashboards)
      .set({ variables, updatedAt: new Date().toISOString() })
      .where(eq(dashboards.id, id))
      .returning();
    return row ? rowToDashboard(row) : undefined;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.delete(dashboards).where(eq(dashboards.id, id)).returning();
    return result.length > 0;
  }
}
