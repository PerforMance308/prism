import { eq } from 'drizzle-orm';
import type { DashboardMessage } from '@agentic-obs/common';
import type { SqliteClient } from '../../db/sqlite-client.js';
import { dashboardMessages } from '../../db/sqlite-schema.js';
import type { IConversationRepository } from '../interfaces.js';

type DbRow = typeof dashboardMessages.$inferSelect;

function rowToMessage(row: DbRow): DashboardMessage {
  return {
    id: row.id,
    role: row.role as DashboardMessage['role'],
    content: row.content,
    actions: (row.actions as DashboardMessage['actions']) ?? undefined,
    timestamp: row.timestamp,
  };
}

export class SqliteConversationRepository implements IConversationRepository {
  constructor(private readonly db: SqliteClient) {}

  async addMessage(dashboardId: string, msg: DashboardMessage): Promise<DashboardMessage> {
    const [row] = await this.db
      .insert(dashboardMessages)
      .values({
        id: msg.id,
        dashboardId,
        role: msg.role,
        content: msg.content,
        actions: (msg.actions ?? null) as Record<string, unknown> | null,
        timestamp: msg.timestamp,
      })
      .returning();
    return rowToMessage(row!);
  }

  async getMessages(dashboardId: string): Promise<DashboardMessage[]> {
    const rows = await this.db
      .select()
      .from(dashboardMessages)
      .where(eq(dashboardMessages.dashboardId, dashboardId));
    return rows.map(rowToMessage);
  }

  async clearMessages(dashboardId: string): Promise<void> {
    await this.db.delete(dashboardMessages).where(eq(dashboardMessages.dashboardId, dashboardId));
  }

  async deleteConversation(dashboardId: string): Promise<void> {
    await this.db.delete(dashboardMessages).where(eq(dashboardMessages.dashboardId, dashboardId));
  }
}
