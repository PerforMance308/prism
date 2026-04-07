import { eq, and, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import type { Investigation } from '@agentic-obs/common';
import type { ExplanationResult } from '@agentic-obs/common';
import type { SqliteClient } from '../../db/sqlite-client.js';
import {
  investigations,
  investigationFollowUps,
  investigationFeedback,
  investigationConclusions,
} from '../../db/sqlite-schema.js';
import type {
  IInvestigationRepository,
  InvestigationFindAllOptions,
} from '../interfaces.js';
import type { FollowUpRecord, FeedbackBody, StoredFeedback } from '../../stores/investigation-store.js';

type DbRow = typeof investigations.$inferSelect;

function rowToInvestigation(row: DbRow): Investigation {
  return {
    id: row.id,
    sessionId: row.sessionId ?? '',
    userId: row.userId ?? '',
    intent: row.intent,
    structuredIntent: (row.structuredIntent ?? {}) as Investigation['structuredIntent'],
    plan: (row.plan ?? { entity: '', objective: '', steps: [], stopConditions: [] }) as Investigation['plan'],
    status: row.status as Investigation['status'],
    hypotheses: (row.hypotheses as Investigation['hypotheses']) ?? [],
    evidence: (row.evidence as Investigation['evidence']) ?? [],
    symptoms: (row.symptoms as Investigation['symptoms']) ?? [],
    actions: (row.actions as Investigation['actions']) ?? [],
    workspaceId: row.workspaceId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class SqliteInvestigationRepository implements IInvestigationRepository {
  constructor(private readonly db: SqliteClient) {}

  async findById(id: string): Promise<Investigation | undefined> {
    const [row] = await this.db.select().from(investigations).where(eq(investigations.id, id));
    return row ? rowToInvestigation(row) : undefined;
  }

  async findAll(opts: InvestigationFindAllOptions = {}): Promise<Investigation[]> {
    const conditions = [eq(investigations.archived, false)];
    if (opts.tenantId) conditions.push(eq(investigations.tenantId, opts.tenantId));
    if (opts.status) conditions.push(eq(investigations.status, opts.status));

    const rows = await this.db
      .select()
      .from(investigations)
      .where(and(...conditions))
      .limit(opts.limit ?? 100)
      .offset(opts.offset ?? 0);

    return rows.map(rowToInvestigation);
  }

  async create(
    data: Omit<Investigation, 'id' | 'createdAt'> & { id?: string },
  ): Promise<Investigation> {
    const now = new Date().toISOString();
    const id = data.id ?? `inv_${randomUUID().slice(0, 8)}`;
    const [row] = await this.db
      .insert(investigations)
      .values({
        id,
        tenantId: (data as Investigation & { tenantId?: string }).tenantId ?? 'default',
        sessionId: data.sessionId,
        userId: data.userId,
        intent: data.intent,
        structuredIntent: data.structuredIntent as unknown as Record<string, unknown>,
        plan: data.plan as unknown as Record<string, unknown>,
        status: data.status,
        hypotheses: data.hypotheses,
        actions: data.actions ?? [],
        evidence: data.evidence,
        symptoms: data.symptoms,
        workspaceId: (data as Investigation & { workspaceId?: string }).workspaceId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return rowToInvestigation(row!);
  }

  async update(
    id: string,
    patch: Partial<Omit<Investigation, 'id'>>,
  ): Promise<Investigation | undefined> {
    const sets: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (patch.status !== undefined) sets.status = patch.status;
    if (patch.plan !== undefined) sets.plan = patch.plan;
    if (patch.hypotheses !== undefined) sets.hypotheses = patch.hypotheses;
    if (patch.evidence !== undefined) sets.evidence = patch.evidence;
    if (patch.symptoms !== undefined) sets.symptoms = patch.symptoms;
    if (patch.actions !== undefined) sets.actions = patch.actions;
    if (patch.intent !== undefined) sets.intent = patch.intent;

    const [row] = await this.db
      .update(investigations)
      .set(sets)
      .where(eq(investigations.id, id))
      .returning();

    return row ? rowToInvestigation(row) : undefined;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.delete(investigations).where(eq(investigations.id, id)).returning();
    return result.length > 0;
  }

  async count(): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(investigations)
      .where(eq(investigations.archived, false));
    return Number(result[0]?.count ?? 0);
  }

  async findBySession(sessionId: string): Promise<Investigation[]> {
    const rows = await this.db
      .select()
      .from(investigations)
      .where(eq(investigations.sessionId, sessionId));
    return rows.map(rowToInvestigation);
  }

  async findByUser(userId: string, tenantId?: string): Promise<Investigation[]> {
    const conditions = [eq(investigations.userId, userId), eq(investigations.archived, false)];
    if (tenantId) conditions.push(eq(investigations.tenantId, tenantId));
    const rows = await this.db
      .select()
      .from(investigations)
      .where(and(...conditions));
    return rows.map(rowToInvestigation);
  }

  async findByWorkspace(workspaceId: string): Promise<Investigation[]> {
    const rows = await this.db
      .select()
      .from(investigations)
      .where(and(eq(investigations.workspaceId, workspaceId), eq(investigations.archived, false)));
    return rows.map(rowToInvestigation);
  }

  async archive(id: string): Promise<Investigation | undefined> {
    const [row] = await this.db
      .update(investigations)
      .set({ archived: true, updatedAt: new Date().toISOString() })
      .where(eq(investigations.id, id))
      .returning();
    return row ? rowToInvestigation(row) : undefined;
  }

  async restore(id: string): Promise<Investigation | undefined> {
    const [row] = await this.db
      .update(investigations)
      .set({ archived: false, updatedAt: new Date().toISOString() })
      .where(eq(investigations.id, id))
      .returning();
    return row ? rowToInvestigation(row) : undefined;
  }

  async findArchived(tenantId?: string): Promise<Investigation[]> {
    const conditions = [eq(investigations.archived, true)];
    if (tenantId) conditions.push(eq(investigations.tenantId, tenantId));
    const rows = await this.db
      .select()
      .from(investigations)
      .where(and(...conditions));
    return rows.map(rowToInvestigation);
  }

  // — Follow-ups

  async addFollowUp(investigationId: string, question: string): Promise<FollowUpRecord> {
    const now = new Date().toISOString();
    const id = `fu_${randomUUID().slice(0, 8)}`;
    const [row] = await this.db
      .insert(investigationFollowUps)
      .values({ id, investigationId, question, createdAt: now })
      .returning();
    return { id: row!.id, investigationId: row!.investigationId, question: row!.question, createdAt: row!.createdAt };
  }

  async getFollowUps(investigationId: string): Promise<FollowUpRecord[]> {
    const rows = await this.db
      .select()
      .from(investigationFollowUps)
      .where(eq(investigationFollowUps.investigationId, investigationId));
    return rows.map((r) => ({ id: r.id, investigationId: r.investigationId, question: r.question, createdAt: r.createdAt }));
  }

  // — Feedback

  async addFeedback(investigationId: string, body: FeedbackBody): Promise<StoredFeedback> {
    const now = new Date().toISOString();
    const id = `fb_${randomUUID().slice(0, 8)}`;
    const [row] = await this.db
      .insert(investigationFeedback)
      .values({
        id,
        investigationId,
        helpful: body.helpful,
        comment: body.comment ?? null,
        rootCauseVerdict: body.rootCauseVerdict ?? null,
        hypothesisFeedbacks: body.hypothesisFeedbacks ?? null,
        actionFeedbacks: body.actionFeedbacks ?? null,
        createdAt: now,
      })
      .returning();
    return {
      id: row!.id,
      investigationId: row!.investigationId,
      helpful: row!.helpful,
      comment: row!.comment ?? undefined,
      rootCauseVerdict: row!.rootCauseVerdict as StoredFeedback['rootCauseVerdict'],
      hypothesisFeedbacks: row!.hypothesisFeedbacks as StoredFeedback['hypothesisFeedbacks'],
      actionFeedbacks: row!.actionFeedbacks as StoredFeedback['actionFeedbacks'],
      createdAt: row!.createdAt,
    };
  }

  // — Conclusions

  async getConclusion(id: string): Promise<ExplanationResult | undefined> {
    const [row] = await this.db
      .select()
      .from(investigationConclusions)
      .where(eq(investigationConclusions.investigationId, id));
    return row ? (row.conclusion as ExplanationResult) : undefined;
  }

  async setConclusion(id: string, conclusion: ExplanationResult): Promise<void> {
    // Upsert: try insert, on conflict update
    const existing = await this.db
      .select()
      .from(investigationConclusions)
      .where(eq(investigationConclusions.investigationId, id));
    if (existing.length > 0) {
      await this.db
        .update(investigationConclusions)
        .set({ conclusion: conclusion as unknown as Record<string, unknown> })
        .where(eq(investigationConclusions.investigationId, id));
    } else {
      await this.db
        .insert(investigationConclusions)
        .values({ investigationId: id, conclusion: conclusion as unknown as Record<string, unknown> });
    }
  }

  // — Orchestrator write-back

  async updateStatus(id: string, status: string): Promise<Investigation | undefined> {
    return this.update(id, { status: status as Investigation['status'] });
  }

  async updatePlan(id: string, plan: Investigation['plan']): Promise<Investigation | undefined> {
    return this.update(id, { plan });
  }

  async updateResult(id: string, result: {
    hypotheses: Investigation['hypotheses'];
    evidence: Investigation['evidence'];
    conclusion: ExplanationResult | null;
  }): Promise<Investigation | undefined> {
    const inv = await this.update(id, {
      hypotheses: result.hypotheses,
      evidence: result.evidence,
    });
    if (inv && result.conclusion) {
      await this.setConclusion(id, result.conclusion);
    }
    return inv;
  }
}
