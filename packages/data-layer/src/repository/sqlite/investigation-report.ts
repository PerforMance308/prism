import { eq } from 'drizzle-orm';
import type { SavedInvestigationReport, InvestigationReportSection } from '@agentic-obs/common';
import type { SqliteClient } from '../../db/sqlite-client.js';
import { investigationReports } from '../../db/sqlite-schema.js';
import type { IInvestigationReportRepository } from '../interfaces.js';

type DbRow = typeof investigationReports.$inferSelect;

function rowToReport(row: DbRow): SavedInvestigationReport {
  return {
    id: row.id,
    dashboardId: row.dashboardId,
    goal: row.goal,
    summary: row.summary,
    sections: (row.sections as InvestigationReportSection[]) ?? [],
    createdAt: row.createdAt,
  };
}

export class SqliteInvestigationReportRepository implements IInvestigationReportRepository {
  constructor(private readonly db: SqliteClient) {}

  async save(report: SavedInvestigationReport): Promise<void> {
    // Upsert: try to find existing, then insert or update
    const existing = await this.db
      .select()
      .from(investigationReports)
      .where(eq(investigationReports.id, report.id));

    if (existing.length > 0) {
      await this.db
        .update(investigationReports)
        .set({
          dashboardId: report.dashboardId,
          goal: report.goal,
          summary: report.summary,
          sections: report.sections as unknown as Record<string, unknown>,
        })
        .where(eq(investigationReports.id, report.id));
    } else {
      await this.db.insert(investigationReports).values({
        id: report.id,
        dashboardId: report.dashboardId,
        goal: report.goal,
        summary: report.summary,
        sections: report.sections as unknown as Record<string, unknown>,
        createdAt: report.createdAt,
      });
    }
  }

  async findById(id: string): Promise<SavedInvestigationReport | undefined> {
    const [row] = await this.db
      .select()
      .from(investigationReports)
      .where(eq(investigationReports.id, id));
    return row ? rowToReport(row) : undefined;
  }

  async findAll(): Promise<SavedInvestigationReport[]> {
    const rows = await this.db.select().from(investigationReports);
    return rows.map(rowToReport);
  }

  async findByDashboard(dashboardId: string): Promise<SavedInvestigationReport[]> {
    const rows = await this.db
      .select()
      .from(investigationReports)
      .where(eq(investigationReports.dashboardId, dashboardId));
    return rows.map(rowToReport);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .delete(investigationReports)
      .where(eq(investigationReports.id, id))
      .returning();
    return result.length > 0;
  }
}
