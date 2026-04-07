/**
 * JSON-to-SQLite migration module.
 *
 * Reads the legacy stores.json file produced by the api-gateway's persistence
 * layer and inserts all data into the SQLite database using the Drizzle schema.
 *
 * After a successful migration the stores.json file is renamed to
 * stores.json.migrated so the migration is idempotent.
 */

import { readFile, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { SqliteClient } from './sqlite-client.js';
import * as schema from './sqlite-schema.js';

// -- Schema versioning ---------------------------------------------------------

const SCHEMA_VERSION = 1;

/**
 * Create all tables if they don't exist, and track schema version.
 */
export function ensureSchema(db: SqliteClient): void {
  // Create the _migrations tracking table
  db.run(sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Check current version
  const rows = db.all<{ version: number }>(sql`
    SELECT version FROM _migrations ORDER BY version DESC LIMIT 1
  `);

  const currentVersion = rows.length > 0 ? rows[0]!.version : 0;

  if (currentVersion >= SCHEMA_VERSION) {
    return; // Already up to date
  }

  // Create all schema tables via Drizzle's push mechanism
  // We use raw SQL CREATE TABLE IF NOT EXISTS for reliability
  const tableDefinitions = [
    `CREATE TABLE IF NOT EXISTS investigations (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT '',
      session_id TEXT,
      user_id TEXT,
      intent TEXT NOT NULL,
      structured_intent TEXT,
      plan TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      hypotheses TEXT NOT NULL DEFAULT '[]',
      actions TEXT NOT NULL DEFAULT '[]',
      evidence TEXT NOT NULL DEFAULT '[]',
      symptoms TEXT NOT NULL DEFAULT '[]',
      workspace_id TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS investigation_follow_ups (
      id TEXT PRIMARY KEY,
      investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS investigation_feedback (
      id TEXT PRIMARY KEY,
      investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
      helpful INTEGER NOT NULL,
      comment TEXT,
      root_cause_verdict TEXT,
      hypothesis_feedbacks TEXT,
      action_feedbacks TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS investigation_conclusions (
      investigation_id TEXT PRIMARY KEY REFERENCES investigations(id) ON DELETE CASCADE,
      conclusion TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      service_ids TEXT NOT NULL DEFAULT '[]',
      investigation_ids TEXT NOT NULL DEFAULT '[]',
      timeline TEXT NOT NULL DEFAULT '[]',
      assignee TEXT,
      workspace_id TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      resolved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS feed_items (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unread',
      feedback TEXT,
      feedback_comment TEXT,
      hypothesis_feedback TEXT,
      action_feedback TEXT,
      investigation_id TEXT,
      followed_up INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      context TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at TEXT NOT NULL,
      resolved_at TEXT,
      resolved_by TEXT,
      resolved_by_roles TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS share_links (
      token TEXT PRIMARY KEY,
      investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL,
      permission TEXT NOT NULL DEFAULT 'view_only',
      expires_at TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS dashboards (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'dashboard',
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      prompt TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'generating',
      panels TEXT NOT NULL DEFAULT '[]',
      variables TEXT NOT NULL DEFAULT '[]',
      refresh_interval_sec INTEGER NOT NULL DEFAULT 30,
      datasource_ids TEXT NOT NULL DEFAULT '[]',
      use_existing_metrics INTEGER NOT NULL DEFAULT 1,
      folder TEXT,
      workspace_id TEXT,
      version INTEGER,
      publish_status TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS dashboard_messages (
      id TEXT PRIMARY KEY,
      dashboard_id TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      actions TEXT,
      timestamp TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      original_prompt TEXT,
      condition TEXT NOT NULL,
      evaluation_interval_sec INTEGER NOT NULL DEFAULT 60,
      severity TEXT NOT NULL,
      labels TEXT,
      state TEXT NOT NULL DEFAULT 'normal',
      state_changed_at TEXT NOT NULL,
      pending_since TEXT,
      notification_policy_id TEXT,
      investigation_id TEXT,
      workspace_id TEXT,
      created_by TEXT NOT NULL,
      last_evaluated_at TEXT,
      last_fired_at TEXT,
      fire_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS alert_history (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
      rule_name TEXT NOT NULL,
      from_state TEXT NOT NULL,
      to_state TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 0,
      threshold INTEGER NOT NULL DEFAULT 0,
      timestamp TEXT NOT NULL,
      labels TEXT NOT NULL DEFAULT '{}'
    )`,
    `CREATE TABLE IF NOT EXISTS alert_silences (
      id TEXT PRIMARY KEY,
      matchers TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      comment TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS notification_policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      matchers TEXT NOT NULL,
      channels TEXT NOT NULL,
      group_by TEXT,
      group_wait_sec INTEGER,
      group_interval_sec INTEGER,
      repeat_interval_sec INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS contact_points (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      integrations TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS notification_policy_tree (
      id TEXT PRIMARY KEY DEFAULT 'root',
      tree TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS mute_timings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      time_intervals TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      members TEXT NOT NULL DEFAULT '[]',
      settings TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS asset_versions (
      id TEXT PRIMARY KEY,
      asset_type TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      diff TEXT,
      edited_by TEXT NOT NULL,
      edit_source TEXT NOT NULL,
      message TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS post_mortems (
      id TEXT PRIMARY KEY,
      incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      impact TEXT NOT NULL,
      timeline TEXT NOT NULL,
      root_cause TEXT NOT NULL,
      actions_taken TEXT NOT NULL,
      lessons_learned TEXT NOT NULL,
      action_items TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      generated_by TEXT NOT NULL DEFAULT 'llm'
    )`,
    `CREATE TABLE IF NOT EXISTS investigation_reports (
      id TEXT PRIMARY KEY,
      dashboard_id TEXT NOT NULL,
      goal TEXT NOT NULL,
      summary TEXT NOT NULL,
      sections TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  ];

  for (const ddl of tableDefinitions) {
    db.run(sql.raw(ddl));
  }

  // Record migration
  db.run(sql`INSERT INTO _migrations (version) VALUES (${SCHEMA_VERSION})`);
}

// -- JSON-to-SQLite migration --------------------------------------------------

interface StoresJson {
  investigations?: {
    investigations?: unknown[];
    archived?: unknown[];
    followUps?: Record<string, unknown[]>;
    feedback?: Record<string, unknown[]>;
    tenants?: Record<string, string>;
    workspaces?: Record<string, string>;
  };
  dashboards?: unknown[];
  alertRules?: {
    rules?: unknown[];
    history?: unknown[];
    silences?: unknown[];
    policies?: unknown[];
  };
  conversations?: Record<string, unknown[]>;
  investigationReports?: unknown[];
  shares?: unknown[];
  notifications?: {
    contactPoints?: unknown[];
    policyTree?: unknown;
    muteTimings?: unknown[];
  };
  folders?: unknown[];
}

/**
 * Read stores.json and insert all data into the SQLite database.
 * Wrapped in a transaction for atomicity. After success, renames
 * stores.json to stores.json.migrated.
 */
export async function migrateJsonToSqlite(
  db: SqliteClient,
  dataDir: string,
): Promise<{ migrated: boolean; counts: Record<string, number> }> {
  const storeFile = join(dataDir, 'stores.json');

  // Check if stores.json exists
  try {
    await stat(storeFile);
  } catch {
    return { migrated: false, counts: {} };
  }

  const raw = await readFile(storeFile, 'utf-8');
  const data = JSON.parse(raw) as StoresJson;
  const counts: Record<string, number> = {};

  // Use a transaction for atomicity
  db.transaction((tx) => {
    // -- Investigations
    const invData = data.investigations;
    if (invData) {
      const allInvestigations = [
        ...(invData.investigations ?? []),
        ...(invData.archived ?? []).map((inv: any) => ({ ...inv, archived: true })),
      ] as any[];

      for (const inv of allInvestigations) {
        if (!inv.id) continue;
        const tenantId = invData.tenants?.[inv.id] ?? '';
        const workspaceId = invData.workspaces?.[inv.id] ?? null;
        const now = inv.updatedAt ?? inv.createdAt ?? new Date().toISOString();

        tx.insert(schema.investigations).values({
          id: inv.id,
          tenantId,
          sessionId: inv.sessionId ?? null,
          userId: inv.userId ?? null,
          intent: inv.intent ?? '',
          structuredIntent: inv.structuredIntent ?? null,
          plan: inv.plan ?? { steps: [] },
          status: inv.status ?? 'pending',
          hypotheses: inv.hypotheses ?? [],
          actions: inv.actions ?? [],
          evidence: inv.evidence ?? [],
          symptoms: inv.symptoms ?? [],
          workspaceId,
          archived: inv.archived ?? false,
          createdAt: inv.createdAt ?? now,
          updatedAt: now,
        }).onConflictDoNothing().run();
      }
      counts.investigations = allInvestigations.length;

      // Follow-ups
      let followUpCount = 0;
      for (const [invId, followUps] of Object.entries(invData.followUps ?? {})) {
        for (const fu of followUps as any[]) {
          tx.insert(schema.investigationFollowUps).values({
            id: fu.id ?? randomUUID(),
            investigationId: invId,
            question: fu.question ?? '',
            createdAt: fu.createdAt ?? new Date().toISOString(),
          }).onConflictDoNothing().run();
          followUpCount++;
        }
      }
      counts.followUps = followUpCount;

      // Feedback
      let feedbackCount = 0;
      for (const [invId, feedbacks] of Object.entries(invData.feedback ?? {})) {
        for (const fb of feedbacks as any[]) {
          tx.insert(schema.investigationFeedback).values({
            id: fb.id ?? randomUUID(),
            investigationId: invId,
            helpful: fb.helpful ?? false,
            comment: fb.comment ?? null,
            rootCauseVerdict: fb.rootCauseVerdict ?? null,
            hypothesisFeedbacks: fb.hypothesisFeedbacks ?? null,
            actionFeedbacks: fb.actionFeedbacks ?? null,
            createdAt: fb.createdAt ?? new Date().toISOString(),
          }).onConflictDoNothing().run();
          feedbackCount++;
        }
      }
      counts.feedback = feedbackCount;
    }

    // -- Dashboards
    if (Array.isArray(data.dashboards)) {
      for (const d of data.dashboards as any[]) {
        if (!d.id) continue;
        const now = d.updatedAt ?? d.createdAt ?? new Date().toISOString();
        tx.insert(schema.dashboards).values({
          id: d.id,
          type: d.type ?? 'dashboard',
          title: d.title ?? '',
          description: d.description ?? '',
          prompt: d.prompt ?? '',
          userId: d.userId ?? '',
          status: d.status ?? 'generating',
          panels: d.panels ?? [],
          variables: d.variables ?? [],
          refreshIntervalSec: d.refreshIntervalSec ?? 30,
          datasourceIds: d.datasourceIds ?? [],
          useExistingMetrics: d.useExistingMetrics ?? true,
          folder: d.folder ?? null,
          workspaceId: d.workspaceId ?? null,
          version: d.version ?? null,
          publishStatus: d.publishStatus ?? null,
          error: d.error ?? null,
          createdAt: d.createdAt ?? now,
          updatedAt: now,
        }).onConflictDoNothing().run();
      }
      counts.dashboards = data.dashboards.length;
    }

    // -- Conversations
    if (data.conversations && typeof data.conversations === 'object') {
      let msgCount = 0;
      for (const [dashboardId, messages] of Object.entries(data.conversations)) {
        if (!Array.isArray(messages)) continue;
        for (const msg of messages as any[]) {
          tx.insert(schema.dashboardMessages).values({
            id: msg.id ?? randomUUID(),
            dashboardId,
            role: msg.role ?? 'user',
            content: msg.content ?? '',
            actions: msg.actions ?? null,
            timestamp: msg.timestamp ?? new Date().toISOString(),
          }).onConflictDoNothing().run();
          msgCount++;
        }
      }
      counts.conversations = msgCount;
    }

    // -- Alert Rules
    const alertData = data.alertRules;
    if (alertData) {
      if (Array.isArray(alertData.rules)) {
        for (const r of alertData.rules as any[]) {
          if (!r.id) continue;
          const now = r.updatedAt ?? r.createdAt ?? new Date().toISOString();
          tx.insert(schema.alertRules).values({
            id: r.id,
            name: r.name ?? '',
            description: r.description ?? '',
            originalPrompt: r.originalPrompt ?? null,
            condition: r.condition ?? {},
            evaluationIntervalSec: r.evaluationIntervalSec ?? 60,
            severity: r.severity ?? 'medium',
            labels: r.labels ?? null,
            state: r.state ?? 'normal',
            stateChangedAt: r.stateChangedAt ?? now,
            pendingSince: r.pendingSince ?? null,
            notificationPolicyId: r.notificationPolicyId ?? null,
            investigationId: r.investigationId ?? null,
            workspaceId: r.workspaceId ?? null,
            createdBy: r.createdBy ?? 'user',
            lastEvaluatedAt: r.lastEvaluatedAt ?? null,
            lastFiredAt: r.lastFiredAt ?? null,
            fireCount: r.fireCount ?? 0,
            createdAt: r.createdAt ?? now,
            updatedAt: now,
          }).onConflictDoNothing().run();
        }
        counts.alertRules = alertData.rules.length;
      }

      if (Array.isArray(alertData.history)) {
        for (const h of alertData.history as any[]) {
          tx.insert(schema.alertHistory).values({
            id: h.id ?? randomUUID(),
            ruleId: h.ruleId ?? '',
            ruleName: h.ruleName ?? '',
            fromState: h.fromState ?? '',
            toState: h.toState ?? '',
            value: h.value ?? 0,
            threshold: h.threshold ?? 0,
            timestamp: h.timestamp ?? new Date().toISOString(),
            labels: h.labels ?? {},
          }).onConflictDoNothing().run();
        }
        counts.alertHistory = alertData.history.length;
      }

      if (Array.isArray(alertData.silences)) {
        for (const s of alertData.silences as any[]) {
          if (!s.id) continue;
          tx.insert(schema.alertSilences).values({
            id: s.id,
            matchers: s.matchers ?? [],
            startsAt: s.startsAt ?? new Date().toISOString(),
            endsAt: s.endsAt ?? new Date().toISOString(),
            comment: s.comment ?? '',
            createdBy: s.createdBy ?? 'user',
            createdAt: s.createdAt ?? new Date().toISOString(),
          }).onConflictDoNothing().run();
        }
        counts.alertSilences = alertData.silences.length;
      }

      if (Array.isArray(alertData.policies)) {
        for (const p of alertData.policies as any[]) {
          if (!p.id) continue;
          const now = p.updatedAt ?? p.createdAt ?? new Date().toISOString();
          tx.insert(schema.notificationPolicies).values({
            id: p.id,
            name: p.name ?? '',
            matchers: p.matchers ?? [],
            channels: p.channels ?? [],
            groupBy: p.groupBy ?? null,
            groupWaitSec: p.groupWaitSec ?? null,
            groupIntervalSec: p.groupIntervalSec ?? null,
            repeatIntervalSec: p.repeatIntervalSec ?? null,
            createdAt: p.createdAt ?? now,
            updatedAt: now,
          }).onConflictDoNothing().run();
        }
        counts.notificationPolicies = alertData.policies.length;
      }
    }

    // -- Investigation Reports
    if (Array.isArray(data.investigationReports)) {
      for (const r of data.investigationReports as any[]) {
        if (!r.id) continue;
        tx.insert(schema.investigationReports).values({
          id: r.id,
          dashboardId: r.dashboardId ?? '',
          goal: r.goal ?? '',
          summary: r.summary ?? '',
          sections: r.sections ?? [],
          createdAt: r.createdAt ?? new Date().toISOString(),
        }).onConflictDoNothing().run();
      }
      counts.investigationReports = data.investigationReports.length;
    }

    // -- Share Links
    if (Array.isArray(data.shares)) {
      for (const s of data.shares as any[]) {
        if (!s.token) continue;
        tx.insert(schema.shareLinks).values({
          token: s.token,
          investigationId: s.investigationId ?? '',
          createdBy: s.createdBy ?? '',
          permission: s.permission ?? 'view_only',
          expiresAt: s.expiresAt ?? null,
          createdAt: s.createdAt ?? new Date().toISOString(),
        }).onConflictDoNothing().run();
      }
      counts.shares = data.shares.length;
    }

    // -- Notifications
    const notifData = data.notifications;
    if (notifData) {
      if (Array.isArray(notifData.contactPoints)) {
        for (const cp of notifData.contactPoints as any[]) {
          if (!cp.id) continue;
          const now = cp.updatedAt ?? cp.createdAt ?? new Date().toISOString();
          tx.insert(schema.contactPoints).values({
            id: cp.id,
            name: cp.name ?? '',
            integrations: cp.integrations ?? [],
            createdAt: cp.createdAt ?? now,
            updatedAt: now,
          }).onConflictDoNothing().run();
        }
        counts.contactPoints = notifData.contactPoints.length;
      }

      if (notifData.policyTree) {
        tx.insert(schema.notificationPolicyTree).values({
          id: 'root',
          tree: notifData.policyTree as any,
          updatedAt: new Date().toISOString(),
        }).onConflictDoNothing().run();
        counts.policyTree = 1;
      }

      if (Array.isArray(notifData.muteTimings)) {
        for (const mt of notifData.muteTimings as any[]) {
          if (!mt.id) continue;
          const now = mt.updatedAt ?? mt.createdAt ?? new Date().toISOString();
          tx.insert(schema.muteTimings).values({
            id: mt.id,
            name: mt.name ?? '',
            timeIntervals: mt.timeIntervals ?? [],
            createdAt: mt.createdAt ?? now,
            updatedAt: now,
          }).onConflictDoNothing().run();
        }
        counts.muteTimings = notifData.muteTimings.length;
      }
    }

    // -- Folders
    if (Array.isArray(data.folders)) {
      for (const f of data.folders as any[]) {
        if (!f.id) continue;
        tx.insert(schema.folders).values({
          id: f.id,
          name: f.name ?? '',
          parentId: f.parentId ?? null,
          createdAt: f.createdAt ?? new Date().toISOString(),
        }).onConflictDoNothing().run();
      }
      counts.folders = data.folders.length;
    }
  });

  // Rename stores.json to stores.json.migrated
  await rename(storeFile, `${storeFile}.migrated`);

  return { migrated: true, counts };
}
