import { randomUUID } from 'crypto';
import type { Investigation } from '@agentic-obs/common';
import type { ExplanationResult } from '@agentic-obs/common';
import type {
  IInvestigationRepository,
  InvestigationFindAllOptions,
} from '../interfaces.js';
import type { FollowUpRecord, FeedbackBody, StoredFeedback } from '../../stores/investigation-store.js';

export class InMemoryInvestigationRepository implements IInvestigationRepository {
  private readonly active = new Map<string, Investigation>();
  private readonly archived = new Map<string, Investigation>();
  private readonly followUps = new Map<string, FollowUpRecord[]>();
  private readonly feedbackMap = new Map<string, StoredFeedback[]>();
  private readonly conclusions = new Map<string, ExplanationResult>();
  private readonly workspaceMap = new Map<string, string>();

  async findById(id: string): Promise<Investigation | undefined> {
    return this.active.get(id) ?? this.archived.get(id);
  }

  async findAll(opts: InvestigationFindAllOptions = {}): Promise<Investigation[]> {
    let items = [...this.active.values()];

    if (opts.tenantId !== undefined) {
      items = items.filter((i) => (i as Investigation & { tenantId?: string }).tenantId === opts.tenantId);
    }
    if (opts.status !== undefined) {
      items = items.filter((i) => i.status === opts.status);
    }
    if (opts.offset !== undefined) items = items.slice(opts.offset);
    if (opts.limit !== undefined) items = items.slice(0, opts.limit);
    return items;
  }

  async create(
    data: Omit<Investigation, 'id' | 'createdAt'> & { id?: string },
  ): Promise<Investigation> {
    const now = new Date().toISOString();
    const investigation: Investigation = {
      ...data,
      id: data.id ?? `inv_${randomUUID().slice(0, 8)}`,
      createdAt: now,
      updatedAt: data.updatedAt ?? now,
    } as Investigation;
    this.active.set(investigation.id, investigation);
    return investigation;
  }

  async update(
    id: string,
    patch: Partial<Omit<Investigation, 'id'>>,
  ): Promise<Investigation | undefined> {
    const existing = this.active.get(id);
    if (!existing) return undefined;
    const updated: Investigation = {
      ...existing,
      ...patch,
      id: existing.id,
      updatedAt: new Date().toISOString(),
    } as Investigation;
    this.active.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.active.delete(id) || this.archived.delete(id);
  }

  async count(): Promise<number> {
    return this.active.size;
  }

  async findBySession(sessionId: string): Promise<Investigation[]> {
    return [...this.active.values()].filter((i) => i.sessionId === sessionId);
  }

  async findByUser(userId: string, _tenantId?: string): Promise<Investigation[]> {
    return [...this.active.values()].filter((i) => i.userId === userId);
  }

  async archive(id: string): Promise<Investigation | undefined> {
    const item = this.active.get(id);
    if (!item) return undefined;
    this.active.delete(id);
    const archived: Investigation = { ...item, updatedAt: new Date().toISOString() } as Investigation;
    this.archived.set(id, archived);
    return archived;
  }

  async restore(id: string): Promise<Investigation | undefined> {
    const item = this.archived.get(id);
    if (!item) return undefined;
    this.archived.delete(id);
    const restored: Investigation = { ...item, updatedAt: new Date().toISOString() } as Investigation;
    this.active.set(id, restored);
    return restored;
  }

  async findArchived(_tenantId?: string): Promise<Investigation[]> {
    return [...this.archived.values()];
  }

  async findByWorkspace(workspaceId: string): Promise<Investigation[]> {
    return [...this.active.values()].filter(
      (inv) => this.workspaceMap.get(inv.id) === workspaceId,
    );
  }

  async addFollowUp(investigationId: string, question: string): Promise<FollowUpRecord> {
    const record: FollowUpRecord = {
      id: `fu_${randomUUID().slice(0, 8)}`,
      investigationId,
      question,
      createdAt: new Date().toISOString(),
    };
    const existing = this.followUps.get(investigationId) ?? [];
    existing.push(record);
    this.followUps.set(investigationId, existing);
    return record;
  }

  async getFollowUps(investigationId: string): Promise<FollowUpRecord[]> {
    return this.followUps.get(investigationId) ?? [];
  }

  async addFeedback(investigationId: string, body: FeedbackBody): Promise<StoredFeedback> {
    const record: StoredFeedback = {
      id: `fb_${randomUUID().slice(0, 8)}`,
      investigationId,
      ...body,
      createdAt: new Date().toISOString(),
    };
    const existing = this.feedbackMap.get(investigationId) ?? [];
    existing.push(record);
    this.feedbackMap.set(investigationId, existing);
    return record;
  }

  async getConclusion(id: string): Promise<ExplanationResult | undefined> {
    return this.conclusions.get(id);
  }

  async setConclusion(id: string, conclusion: ExplanationResult): Promise<void> {
    this.conclusions.set(id, conclusion);
  }

  async updateStatus(id: string, status: string): Promise<Investigation | undefined> {
    return this.update(id, { status } as Partial<Omit<Investigation, 'id'>>);
  }

  async updatePlan(id: string, plan: Investigation['plan']): Promise<Investigation | undefined> {
    return this.update(id, { plan } as Partial<Omit<Investigation, 'id'>>);
  }

  async updateResult(id: string, result: {
    hypotheses: Investigation['hypotheses'];
    evidence: Investigation['evidence'];
    conclusion: ExplanationResult | null;
  }): Promise<Investigation | undefined> {
    const updated = await this.update(id, {
      hypotheses: result.hypotheses,
      evidence: result.evidence,
    } as Partial<Omit<Investigation, 'id'>>);
    if (updated && result.conclusion) {
      this.conclusions.set(id, result.conclusion);
    }
    return updated;
  }

  /** Test helper */
  clear(): void {
    this.active.clear();
    this.archived.clear();
    this.followUps.clear();
    this.feedbackMap.clear();
    this.conclusions.clear();
    this.workspaceMap.clear();
  }
}
