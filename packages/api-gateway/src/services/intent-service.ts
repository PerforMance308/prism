import { createLogger, DEFAULT_LLM_MODEL, type AlertRule } from '@agentic-obs/common';

const log = createLogger('intent-service');
import type { IAlertRuleRepository, IGatewayInvestigationStore, IGatewayFeedStore, IInvestigationReportRepository } from '@agentic-obs/data-layer';
import { defaultAlertRuleStore } from '@agentic-obs/data-layer';
import { AlertRuleAgent } from '@agentic-obs/agent-core';
import { PrometheusMetricsAdapter } from '@agentic-obs/adapters';
import type { IGatewayDashboardStore } from '../repositories/types.js';
import { getSetupConfig } from '../routes/setup.js';
import { createLlmGateway } from '../routes/llm-factory.js';
import { resolvePrometheusDatasource } from './dashboard-service.js';

export type IntentType = 'alert' | 'dashboard' | 'investigate';

export interface IntentAlertResult {
  intent: 'alert';
  alertRuleId: string;
  summary: string;
  navigate: string;
}

export interface IntentDashboardResult {
  intent: 'dashboard';
  dashboardId: string;
  navigate: string;
}

export interface IntentInvestigateResult {
  intent: 'investigate';
  investigationId: string;
  navigate: string;
}

export type IntentResult = IntentAlertResult | IntentDashboardResult | IntentInvestigateResult;

export interface IntentProgress {
  type: 'thinking' | 'intent';
  data: unknown;
}

export interface IntentServiceDeps {
  dashboardStore: IGatewayDashboardStore;
  alertRuleStore?: IAlertRuleRepository;
  investigationStore?: IGatewayInvestigationStore;
  feedStore?: IGatewayFeedStore;
  reportStore?: IInvestigationReportRepository;
}

export class IntentService {
  private readonly dashboardStore: IGatewayDashboardStore;
  private readonly alertRuleStore: IAlertRuleRepository;
  private readonly investigationStore?: IGatewayInvestigationStore;
  private readonly feedStoreInstance?: IGatewayFeedStore;
  private readonly reportStore?: IInvestigationReportRepository;

  constructor(deps: IntentServiceDeps) {
    this.dashboardStore = deps.dashboardStore;
    this.alertRuleStore = deps.alertRuleStore ?? defaultAlertRuleStore;
    this.investigationStore = deps.investigationStore;
    this.feedStoreInstance = deps.feedStore;
    this.reportStore = deps.reportStore;
  }

  async classifyIntent(message: string): Promise<IntentType> {
    const config = getSetupConfig();
    if (!config.llm) {
      throw new Error('LLM not configured');
    }

    const gateway = createLlmGateway(config.llm);
    const model = config.llm.model || DEFAULT_LLM_MODEL;

    const classifyResp = await gateway.complete([
      {
        role: 'system',
        content:
          `You are an intent classifier for an observability platform. Classify the user's message into exactly one intent.\n\n`
          + `Return JSON: { "intent": "<intent>" }\n\n`
          + `Possible intents:\n`
          + `- "alert": The user wants to set up an alert rule, be notified when a threshold is breached, or create a monitoring condition.\n`
          + `- "dashboard": The user wants to see, view, display, or visualize metrics. This includes requests like "show me X metrics", "give me a dashboard for Y", "I want to see Z", or any request to display/chart/graph data. When in doubt between dashboard and investigate, prefer dashboard.\n`
          + `- "investigate": The user is explicitly asking about a specific problem, incident, or anomaly they've already observed — e.g. "why is latency high", "diagnose the error spike", "what caused the outage". The user must be describing a known issue to investigate.\n\n`
          + `Key rule: If the user asks to "show", "give", "display", or "list" metrics without mentioning a specific problem, classify as "dashboard".`,
      },
      { role: 'user', content: message },
    ], {
      model,
      maxTokens: 64,
      temperature: 0,
      responseFormat: 'json',
    });

    const cleaned = classifyResp.content.replace(/```json\n?/g, '').replace(/```/g, '').trim();
    try {
      const parsed = JSON.parse(cleaned) as { intent?: string };
      return (parsed.intent as IntentType) ?? 'dashboard';
    } catch {
      return 'dashboard';
    }
  }

  async executeAlertIntent(message: string): Promise<IntentAlertResult> {
    const config = getSetupConfig();
    if (!config.llm) {
      throw new Error('LLM not configured');
    }

    const gateway = createLlmGateway(config.llm);
    const model = config.llm.model || DEFAULT_LLM_MODEL;

    const prom = resolvePrometheusDatasource(config.datasources);
    const metrics = prom ? new PrometheusMetricsAdapter(prom.url, prom.headers) : undefined;

    const agent = new AlertRuleAgent({ gateway, model, metrics });
    const result = await agent.generate(message);
    const generated = result.rule;

    const rule = await this.alertRuleStore.create({
      name: generated.name,
      description: generated.description,
      originalPrompt: message,
      condition: generated.condition,
      evaluationIntervalSec: generated.evaluationIntervalSec,
      severity: generated.severity,
      labels: generated.labels,
      createdBy: 'llm',
    } as Omit<AlertRule, 'id' | 'createdAt' | 'updatedAt' | 'fireCount' | 'state' | 'stateChangedAt'>);

    return {
      intent: 'alert',
      alertRuleId: rule.id,
      summary: `Alert "${rule.name}" created: ${rule.condition.query} ${rule.condition.operator} ${rule.condition.threshold}`,
      navigate: '/alerts',
    };
  }

  async executeDashboardIntent(message: string): Promise<IntentDashboardResult> {
    const dashboard = await this.dashboardStore.create({
      title: 'Untitled Dashboard',
      description: '',
      prompt: message,
      userId: 'anonymous',
      datasourceIds: [],
      useExistingMetrics: true,
    });

    return {
      intent: 'dashboard',
      dashboardId: dashboard.id,
      navigate: `/dashboards/${dashboard.id}`,
    };
  }

  async executeInvestigateIntent(message: string): Promise<IntentInvestigateResult> {
    if (!this.investigationStore || !this.feedStoreInstance) {
      throw new Error('investigationStore and feedStore are required for investigate intent');
    }
    const { LiveOrchestratorRunner } = await import('./investigation-runner-service.js');

    const investigation = await this.investigationStore.create({
      question: message,
      sessionId: `ses_${Date.now()}`,
      userId: 'anonymous',
    });

    const orchestrator = new LiveOrchestratorRunner(this.investigationStore, this.feedStoreInstance, this.reportStore);
    orchestrator.run({
      investigationId: investigation.id,
      question: investigation.intent,
      sessionId: investigation.sessionId,
      userId: investigation.userId,
    });

    return {
      intent: 'investigate',
      investigationId: investigation.id,
      navigate: `/investigations/${investigation.id}`,
    };
  }

  async processMessage(
    message: string,
    onProgress: (event: IntentProgress) => void,
  ): Promise<IntentResult> {
    onProgress({ type: 'thinking', data: { content: 'Understanding your request...' } });

    const intent = await this.classifyIntent(message);
    log.info({ message: message.slice(0, 80), intent }, 'classified intent');
    onProgress({ type: 'intent', data: { intent } });

    if (intent === 'alert') {
      onProgress({ type: 'thinking', data: { content: 'Creating alert rule...' } });
      return this.executeAlertIntent(message);
    } else if (intent === 'investigate') {
      onProgress({ type: 'thinking', data: { content: 'Starting investigation...' } });
      return this.executeInvestigateIntent(message);
    } else {
      onProgress({ type: 'thinking', data: { content: 'Setting up dashboard workspace...' } });
      return this.executeDashboardIntent(message);
    }
  }
}
