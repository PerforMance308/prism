import type { DbClient } from '../db/client.js';
import type { SqliteClient } from '../db/sqlite-client.js';
import type {
  IInvestigationRepository,
  IIncidentRepository,
  IFeedRepository,
  ICaseRepository,
  IApprovalRepository,
  IShareRepository,
  IFeedItemRepository,
  IApprovalRequestRepository,
  IShareLinkRepository,
  IDashboardRepository,
  IConversationRepository,
  IFolderRepository,
  IAlertRuleRepository,
  INotificationRepository,
  IVersionRepository,
  IWorkspaceRepository,
  IInvestigationReportRepository,
  IPostMortemRepository,
} from './interfaces.js';

import { InMemoryInvestigationRepository } from './memory/investigation.js';
import { InMemoryIncidentRepository } from './memory/incident.js';
import { InMemoryFeedRepository } from './memory/feed.js';
import { InMemoryCaseRepository } from './memory/case.js';
import { InMemoryApprovalRepository } from './memory/approval.js';
import { InMemoryShareRepository } from './memory/share.js';

import { PostgresInvestigationRepository } from './postgres/investigation.js';
import { PostgresIncidentRepository } from './postgres/incident.js';
import { PostgresFeedRepository } from './postgres/feed.js';
import { PostgresCaseRepository } from './postgres/case.js';
import { PostgresApprovalRepository } from './postgres/approval.js';
import { PostgresShareRepository } from './postgres/share.js';

import { SqliteInvestigationRepository } from './sqlite/investigation.js';
import { SqliteIncidentRepository } from './sqlite/incident.js';
import { SqliteFeedItemRepository } from './sqlite/feed.js';
import { SqliteApprovalRequestRepository } from './sqlite/approval.js';
import { SqliteShareLinkRepository } from './sqlite/share.js';
import { SqliteDashboardRepository } from './sqlite/dashboard.js';
import { SqliteConversationRepository } from './sqlite/conversation.js';
import { SqliteFolderRepository } from './sqlite/folder.js';
import { SqliteAlertRuleRepository } from './sqlite/alert-rule.js';
import { SqliteNotificationRepository } from './sqlite/notification.js';
import { SqliteVersionRepository } from './sqlite/version.js';
import { SqliteWorkspaceRepository } from './sqlite/workspace.js';
import { SqliteInvestigationReportRepository } from './sqlite/investigation-report.js';
import { SqlitePostMortemRepository } from './sqlite/post-mortem.js';

/**
 * Core repositories (shared across all backends that support them).
 */
export interface Repositories {
  investigations: IInvestigationRepository;
  incidents: IIncidentRepository;
  feed: IFeedRepository;
  cases: ICaseRepository;
  approvals: IApprovalRepository;
  shares: IShareRepository;
}

/**
 * Extended repositories available with the SQLite backend.
 * Includes all entity types that were previously only available via in-memory stores.
 */
export interface SqliteRepositories {
  investigations: IInvestigationRepository;
  incidents: IIncidentRepository;
  feedItems: IFeedItemRepository;
  approvals: IApprovalRequestRepository;
  shares: IShareLinkRepository;
  dashboards: IDashboardRepository;
  conversations: IConversationRepository;
  folders: IFolderRepository;
  alertRules: IAlertRuleRepository;
  notifications: INotificationRepository;
  versions: IVersionRepository;
  workspaces: IWorkspaceRepository;
  investigationReports: IInvestigationReportRepository;
  postMortems: IPostMortemRepository;
}

export function createInMemoryRepositories(): Repositories {
  return {
    investigations: new InMemoryInvestigationRepository(),
    incidents: new InMemoryIncidentRepository(),
    feed: new InMemoryFeedRepository(),
    cases: new InMemoryCaseRepository(),
    approvals: new InMemoryApprovalRepository(),
    shares: new InMemoryShareRepository(),
  };
}

export function createPostgresRepositories(db: DbClient): Repositories {
  return {
    investigations: new PostgresInvestigationRepository(db),
    incidents: new PostgresIncidentRepository(db),
    feed: new PostgresFeedRepository(db),
    cases: new PostgresCaseRepository(db),
    approvals: new PostgresApprovalRepository(db),
    shares: new PostgresShareRepository(db),
  };
}

export function createSqliteRepositories(db: SqliteClient): SqliteRepositories {
  return {
    investigations: new SqliteInvestigationRepository(db),
    incidents: new SqliteIncidentRepository(db),
    feedItems: new SqliteFeedItemRepository(db),
    approvals: new SqliteApprovalRequestRepository(db),
    shares: new SqliteShareLinkRepository(db),
    dashboards: new SqliteDashboardRepository(db),
    conversations: new SqliteConversationRepository(db),
    folders: new SqliteFolderRepository(db),
    alertRules: new SqliteAlertRuleRepository(db),
    notifications: new SqliteNotificationRepository(db),
    versions: new SqliteVersionRepository(db),
    workspaces: new SqliteWorkspaceRepository(db),
    investigationReports: new SqliteInvestigationReportRepository(db),
    postMortems: new SqlitePostMortemRepository(db),
  };
}

export type RepositoryBackend = 'memory' | 'postgres' | 'sqlite';

export function createRepositories(
  backend: RepositoryBackend,
  db?: DbClient,
): Repositories {
  if (backend === 'postgres') {
    if (!db) throw new Error('DbClient is required for postgres backend');
    return createPostgresRepositories(db);
  }
  return createInMemoryRepositories();
}
