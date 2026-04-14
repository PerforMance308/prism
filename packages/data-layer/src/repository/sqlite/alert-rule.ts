import { eq, and, like, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import type {
  AlertRule,
  AlertRuleState,
  AlertHistoryEntry,
  AlertSilence,
  NotificationPolicy,
  SilenceStatus,
} from '@agentic-obs/common';
import type { SqliteClient } from '../../db/sqlite-client.js';
import { toJsonColumn } from '../json-column.js';
import {
  alertRules,
  alertHistory,
  alertSilences,
  notificationPolicies,
} from '../../db/sqlite-schema.js';
import type { IAlertRuleRepository, AlertRuleFindAllOptions } from '../interfaces.js';

type RuleRow = typeof alertRules.$inferSelect;
type HistoryRow = typeof alertHistory.$inferSelect;
type SilenceRow = typeof alertSilences.$inferSelect;
type PolicyRow = typeof notificationPolicies.$inferSelect;

function rowToRule(row: RuleRow): AlertRule {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    originalPrompt: row.originalPrompt ?? undefined,
    condition: row.condition as AlertRule['condition'],
    evaluationIntervalSec: row.evaluationIntervalSec,
    severity: row.severity as AlertRule['severity'],
    labels: (row.labels as Record<string, string>) ?? undefined,
    state: row.state as AlertRuleState,
    stateChangedAt: row.stateChangedAt,
    pendingSince: row.pendingSince ?? undefined,
    notificationPolicyId: row.notificationPolicyId ?? undefined,
    investigationId: row.investigationId ?? undefined,
    workspaceId: row.workspaceId ?? undefined,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastEvaluatedAt: row.lastEvaluatedAt ?? undefined,
    lastFiredAt: row.lastFiredAt ?? undefined,
    fireCount: row.fireCount,
  };
}

function rowToHistoryEntry(row: HistoryRow): AlertHistoryEntry {
  return {
    id: row.id,
    ruleId: row.ruleId,
    ruleName: row.ruleName,
    fromState: row.fromState as AlertRuleState,
    toState: row.toState as AlertRuleState,
    value: row.value,
    threshold: row.threshold,
    timestamp: row.timestamp,
    labels: (row.labels as Record<string, string>) ?? {},
  };
}

function computeSilenceStatus(silence: { startsAt: string; endsAt: string }): SilenceStatus {
  const now = new Date().toISOString();
  if (silence.endsAt < now) return 'expired';
  if (silence.startsAt > now) return 'pending';
  return 'active';
}

function rowToSilence(row: SilenceRow): AlertSilence {
  return {
    id: row.id,
    matchers: row.matchers as AlertSilence['matchers'],
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    comment: row.comment,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    status: computeSilenceStatus(row),
  };
}

function rowToPolicy(row: PolicyRow): NotificationPolicy {
  return {
    id: row.id,
    name: row.name,
    matchers: row.matchers as NotificationPolicy['matchers'],
    channels: row.channels as NotificationPolicy['channels'],
    groupBy: (row.groupBy as string[]) ?? undefined,
    groupWaitSec: row.groupWaitSec ?? undefined,
    groupIntervalSec: row.groupIntervalSec ?? undefined,
    repeatIntervalSec: row.repeatIntervalSec ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class SqliteAlertRuleRepository implements IAlertRuleRepository {
  constructor(private readonly db: SqliteClient) {}

  // — Rules

  async create(
    data: Omit<AlertRule, 'id' | 'createdAt' | 'updatedAt' | 'fireCount' | 'state' | 'stateChangedAt'>,
  ): Promise<AlertRule> {
    const now = new Date().toISOString();
    const id = `alert_${randomUUID().slice(0, 12)}`;
    const [row] = await this.db
      .insert(alertRules)
      .values({
        id,
        name: data.name,
        description: data.description,
        originalPrompt: data.originalPrompt,
        condition: toJsonColumn(data.condition),
        evaluationIntervalSec: data.evaluationIntervalSec,
        severity: data.severity,
        labels: toJsonColumn(data.labels),
        state: 'normal',
        stateChangedAt: now,
        notificationPolicyId: data.notificationPolicyId,
        investigationId: data.investigationId,
        workspaceId: data.workspaceId,
        createdBy: data.createdBy,
        fireCount: 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return rowToRule(row!);
  }

  async findById(id: string): Promise<AlertRule | undefined> {
    const [row] = await this.db.select().from(alertRules).where(eq(alertRules.id, id));
    return row ? rowToRule(row) : undefined;
  }

  async findAll(filter: AlertRuleFindAllOptions = {}): Promise<{ list: AlertRule[]; total: number }> {
    const conditions: ReturnType<typeof eq>[] = [];
    if (filter.state) conditions.push(eq(alertRules.state, filter.state));
    if (filter.severity) conditions.push(eq(alertRules.severity, filter.severity));

    const where = conditions.length ? and(...conditions) : undefined;

    // Fetch all matching rows for search + total count
    let rows = await this.db
      .select()
      .from(alertRules)
      .where(where)
      .orderBy(sql`${alertRules.updatedAt} desc`);

    if (filter.search) {
      const q = filter.search.toLowerCase();
      rows = rows.filter((r) =>
        r.name.toLowerCase().includes(q)
        || r.description.toLowerCase().includes(q)
        || Object.values((r.labels as Record<string, string>) ?? {}).some((v) => v.toLowerCase().includes(q)),
      );
    }

    const total = rows.length;
    if (filter.offset) rows = rows.slice(filter.offset);
    if (filter.limit) rows = rows.slice(0, filter.limit);

    return { list: rows.map(rowToRule), total };
  }

  async findByWorkspace(workspaceId: string): Promise<AlertRule[]> {
    const rows = await this.db
      .select()
      .from(alertRules)
      .where(eq(alertRules.workspaceId, workspaceId));
    return rows.map(rowToRule);
  }

  async update(
    id: string,
    patch: Partial<Omit<AlertRule, 'id' | 'createdAt'>>,
  ): Promise<AlertRule | undefined> {
    const sets: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (patch.name !== undefined) sets.name = patch.name;
    if (patch.description !== undefined) sets.description = patch.description;
    if (patch.originalPrompt !== undefined) sets.originalPrompt = patch.originalPrompt;
    if (patch.condition !== undefined) sets.condition = patch.condition;
    if (patch.evaluationIntervalSec !== undefined) sets.evaluationIntervalSec = patch.evaluationIntervalSec;
    if (patch.severity !== undefined) sets.severity = patch.severity;
    if (patch.labels !== undefined) sets.labels = patch.labels;
    if (patch.state !== undefined) sets.state = patch.state;
    if (patch.stateChangedAt !== undefined) sets.stateChangedAt = patch.stateChangedAt;
    if (patch.pendingSince !== undefined) sets.pendingSince = patch.pendingSince;
    if ('pendingSince' in patch && patch.pendingSince === undefined) sets.pendingSince = null;
    if (patch.notificationPolicyId !== undefined) sets.notificationPolicyId = patch.notificationPolicyId;
    if (patch.investigationId !== undefined) sets.investigationId = patch.investigationId;
    if (patch.workspaceId !== undefined) sets.workspaceId = patch.workspaceId;
    if (patch.lastEvaluatedAt !== undefined) sets.lastEvaluatedAt = patch.lastEvaluatedAt;
    if (patch.lastFiredAt !== undefined) sets.lastFiredAt = patch.lastFiredAt;
    if (patch.fireCount !== undefined) sets.fireCount = patch.fireCount;

    const [row] = await this.db
      .update(alertRules)
      .set(sets)
      .where(eq(alertRules.id, id))
      .returning();
    return row ? rowToRule(row) : undefined;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.delete(alertRules).where(eq(alertRules.id, id)).returning();
    return result.length > 0;
  }

  async transition(id: string, newState: AlertRuleState, value?: number): Promise<AlertRule | undefined> {
    const rule = await this.findById(id);
    if (!rule) return undefined;
    if (rule.state === newState) return rule;

    const now = new Date().toISOString();

    // Record history entry
    await this.db.insert(alertHistory).values({
      id: randomUUID(),
      ruleId: id,
      ruleName: rule.name,
      fromState: rule.state,
      toState: newState,
      value: value ?? 0,
      threshold: rule.condition.threshold,
      timestamp: now,
      labels: toJsonColumn(rule.labels ?? {}),
    });

    const patch: Partial<AlertRule> = {
      state: newState,
      stateChangedAt: now,
      lastEvaluatedAt: now,
    };
    if (newState === 'pending') patch.pendingSince = now;
    if (newState === 'firing') {
      patch.lastFiredAt = now;
      patch.fireCount = rule.fireCount + 1;
      patch.pendingSince = undefined;
    }
    if (newState === 'normal' || newState === 'resolved') {
      patch.pendingSince = undefined;
    }

    return this.update(id, patch);
  }

  // — History

  async getHistory(ruleId: string, limit = 50): Promise<AlertHistoryEntry[]> {
    const rows = await this.db
      .select()
      .from(alertHistory)
      .where(eq(alertHistory.ruleId, ruleId))
      .orderBy(sql`${alertHistory.timestamp} desc`)
      .limit(limit);
    return rows.map(rowToHistoryEntry);
  }

  async getAllHistory(limit = 100): Promise<AlertHistoryEntry[]> {
    const rows = await this.db
      .select()
      .from(alertHistory)
      .orderBy(sql`${alertHistory.timestamp} desc`)
      .limit(limit);
    return rows.map(rowToHistoryEntry);
  }

  // — Silences

  async createSilence(data: Omit<AlertSilence, 'id' | 'createdAt'>): Promise<AlertSilence> {
    const now = new Date().toISOString();
    const id = `silence_${randomUUID().slice(0, 12)}`;
    const [row] = await this.db
      .insert(alertSilences)
      .values({
        id,
        matchers: data.matchers as unknown[],
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        comment: data.comment,
        createdBy: data.createdBy,
        createdAt: now,
      })
      .returning();
    return rowToSilence(row!);
  }

  async findSilences(): Promise<AlertSilence[]> {
    const now = new Date().toISOString();
    const rows = await this.db
      .select()
      .from(alertSilences)
      .where(sql`${alertSilences.endsAt} > ${now}`);
    return rows.map(rowToSilence);
  }

  async findAllSilencesIncludingExpired(): Promise<AlertSilence[]> {
    const rows = await this.db.select().from(alertSilences);
    return rows.map(rowToSilence);
  }

  async updateSilence(
    id: string,
    patch: Partial<Omit<AlertSilence, 'id' | 'createdAt'>>,
  ): Promise<AlertSilence | undefined> {
    const sets: Record<string, unknown> = {};
    if (patch.matchers !== undefined) sets.matchers = patch.matchers;
    if (patch.startsAt !== undefined) sets.startsAt = patch.startsAt;
    if (patch.endsAt !== undefined) sets.endsAt = patch.endsAt;
    if (patch.comment !== undefined) sets.comment = patch.comment;
    if (patch.createdBy !== undefined) sets.createdBy = patch.createdBy;

    const [row] = await this.db
      .update(alertSilences)
      .set(sets)
      .where(eq(alertSilences.id, id))
      .returning();
    return row ? rowToSilence(row) : undefined;
  }

  async deleteSilence(id: string): Promise<boolean> {
    const result = await this.db.delete(alertSilences).where(eq(alertSilences.id, id)).returning();
    return result.length > 0;
  }

  // — Notification Policies (flat)

  async createPolicy(
    data: Omit<NotificationPolicy, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<NotificationPolicy> {
    const now = new Date().toISOString();
    const id = `policy_${randomUUID().slice(0, 12)}`;
    const [row] = await this.db
      .insert(notificationPolicies)
      .values({
        id,
        name: data.name,
        matchers: data.matchers as unknown[],
        channels: data.channels as unknown[],
        groupBy: data.groupBy ?? null,
        groupWaitSec: data.groupWaitSec ?? null,
        groupIntervalSec: data.groupIntervalSec ?? null,
        repeatIntervalSec: data.repeatIntervalSec ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return rowToPolicy(row!);
  }

  async findAllPolicies(): Promise<NotificationPolicy[]> {
    const rows = await this.db.select().from(notificationPolicies);
    return rows.map(rowToPolicy);
  }

  async findPolicyById(id: string): Promise<NotificationPolicy | undefined> {
    const [row] = await this.db
      .select()
      .from(notificationPolicies)
      .where(eq(notificationPolicies.id, id));
    return row ? rowToPolicy(row) : undefined;
  }

  async updatePolicy(
    id: string,
    patch: Partial<Omit<NotificationPolicy, 'id' | 'createdAt'>>,
  ): Promise<NotificationPolicy | undefined> {
    const sets: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (patch.name !== undefined) sets.name = patch.name;
    if (patch.matchers !== undefined) sets.matchers = patch.matchers;
    if (patch.channels !== undefined) sets.channels = patch.channels;
    if (patch.groupBy !== undefined) sets.groupBy = patch.groupBy;
    if (patch.groupWaitSec !== undefined) sets.groupWaitSec = patch.groupWaitSec;
    if (patch.groupIntervalSec !== undefined) sets.groupIntervalSec = patch.groupIntervalSec;
    if (patch.repeatIntervalSec !== undefined) sets.repeatIntervalSec = patch.repeatIntervalSec;

    const [row] = await this.db
      .update(notificationPolicies)
      .set(sets)
      .where(eq(notificationPolicies.id, id))
      .returning();
    return row ? rowToPolicy(row) : undefined;
  }

  async deletePolicy(id: string): Promise<boolean> {
    const result = await this.db
      .delete(notificationPolicies)
      .where(eq(notificationPolicies.id, id))
      .returning();
    return result.length > 0;
  }
}
