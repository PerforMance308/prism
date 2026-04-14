import { createLogger, getErrorMessage } from '@agentic-obs/common'
import type {
  DashboardSseEvent,
  DashboardAction,
  Dashboard,
} from '@agentic-obs/common'
import type {
  IDashboardAgentStore,
  IConversationStore,
  IInvestigationReportStore,
  IInvestigationStore,
  IAlertRuleStore,
  DatasourceConfig,
} from './types.js'
import type { IMetricsAdapter } from '../adapters/index.js'
import type { LLMGateway } from '@agentic-obs/llm-gateway'
import { DashboardGeneratorAgent } from './dashboard-generator-agent.js'
import { PanelAdderAgent } from './panel-adder-agent.js'
import { PanelEditorAgent } from './panel-editor-agent.js'
import { PanelExplainAgent } from './panel-explain-agent.js'
import { InvestigationAgent } from './investigation-agent.js'
import { ActionExecutor } from './action-executor.js'
import { AlertRuleAgent } from './alert-rule-agent.js'
import { ReActLoop } from './react-loop.js'
import type { ReActStep } from './react-loop.js'
import { VerifierAgent } from '../verification/verifier-agent.js'
import { agentRegistry } from '../runtime/agent-registry.js'
import type { AgentToolName, AgentPermissionMode } from '../runtime/agent-types.js'
import type { AgentEvent } from '../runtime/agent-events.js'
import type { AlertRuleSummary } from './orchestrator-alert-helpers.js'
import {
  getStructuredAlertRuleContext,
  parseAlertFollowUpAction,
  composeAlertFollowUpReply,
} from './orchestrator-alert-helpers.js'
import { buildSystemPrompt } from './orchestrator-prompt.js'
import type { ActionContext } from './orchestrator-action-handlers.js'
import {
  handleGenerateDashboard,
  handleAddPanels,
  handleInvestigate,
  handlePanelEdit,
  handleAddVariable,
  handleSetTitle,
  handleCreateAlertRule,
  handleModifyAlertRule,
  handleDeleteAlertRule,
} from './orchestrator-action-handlers.js'

export interface OrchestratorDeps {
  gateway: LLMGateway
  model: string
  store: IDashboardAgentStore
  conversationStore: IConversationStore
  investigationReportStore: IInvestigationReportStore
  investigationStore?: IInvestigationStore
  alertRuleStore: IAlertRuleStore
  metricsAdapter?: IMetricsAdapter
  /** All configured datasources - used to inform the LLM about available environments */
  allDatasources?: DatasourceConfig[]
  sendEvent: (event: DashboardSseEvent) => void
  timeRange?: { start: string; end: string; timezone?: string }
  /** Maximum total tokens per chat message. Default: 50000 */
  maxTokenBudget?: number
}

const MUTATION_ACTIONS = [
  'add_panels', 'remove_panels', 'modify_panel', 'rearrange',
  'add_variable', 'set_title', 'generate_dashboard', 'create_alert_rule', 'modify_alert_rule', 'delete_alert_rule',
] as const;

function checkPermission(mode: AgentPermissionMode, action: string): 'allow' | 'block' | 'approval_required' | 'propose_only' {
  const isMutation = (MUTATION_ACTIONS as readonly string[]).includes(action);
  if (!isMutation) return 'allow';
  if (mode === 'read_only') return 'block';
  if (mode === 'approval_required') return 'approval_required';
  if (mode === 'propose_only') return 'propose_only';
  return 'allow';
}

const log = createLogger('orchestrator')

export class OrchestratorAgent {
  static readonly definition = agentRegistry.get('intent-router')!;

  private readonly actionExecutor: ActionExecutor
  private readonly generatorAgent: DashboardGeneratorAgent
  private readonly panelAdderAgent: PanelAdderAgent
  private readonly panelEditorAgent: PanelEditorAgent
  private readonly panelExplainAgent?: PanelExplainAgent
  private readonly investigationAgent?: InvestigationAgent
  private readonly alertRuleAgent: AlertRuleAgent
  private readonly reactLoop: ReActLoop
  private readonly verifierAgent: VerifierAgent
  private pendingConversationActions: DashboardAction[] = []
  private pendingNavigateTo?: string

  constructor(private deps: OrchestratorDeps) {
    this.actionExecutor = new ActionExecutor(deps.store, deps.sendEvent)

    const subAgentDeps = {
      gateway: deps.gateway,
      model: deps.model,
      metrics: deps.metricsAdapter,
      sendEvent: deps.sendEvent,
    }

    this.generatorAgent = new DashboardGeneratorAgent(subAgentDeps)
    this.panelAdderAgent = new PanelAdderAgent(subAgentDeps)
    this.panelEditorAgent = new PanelEditorAgent({
      gateway: deps.gateway,
      model: deps.model,
      panelAdderAgent: this.panelAdderAgent,
    })

    if (deps.metricsAdapter) {
      this.panelExplainAgent = new PanelExplainAgent({
        gateway: deps.gateway,
        model: deps.model,
        metrics: deps.metricsAdapter,
      })
    }

    if (deps.metricsAdapter) {
      this.investigationAgent = new InvestigationAgent({
        gateway: deps.gateway,
        model: deps.model,
        metrics: deps.metricsAdapter,
        sendEvent: deps.sendEvent,
      })
    }

    this.alertRuleAgent = new AlertRuleAgent({
      gateway: deps.gateway,
      model: deps.model,
      metrics: deps.metricsAdapter,
    })

    this.reactLoop = new ReActLoop({
      gateway: deps.gateway,
      model: deps.model,
      sendEvent: deps.sendEvent,
      maxTokenBudget: deps.maxTokenBudget,
    })

    this.verifierAgent = new VerifierAgent()

    log.info(`[Orchestrator] init: metricsAdapter=${deps.metricsAdapter ? 'SET' : 'UNSET'}, investigationAgent=${this.investigationAgent ? 'YES' : 'NO'}`)
  }

  private emitAgentEvent(event: AgentEvent): void {
    this.deps.sendEvent({ type: 'agent_event', event });
  }

  private makeAgentEvent(
    type: AgentEvent['type'],
    metadata?: Record<string, unknown>,
  ): AgentEvent {
    return {
      type,
      agentType: OrchestratorAgent.definition.type,
      timestamp: new Date().toISOString(),
      ...(metadata ? { metadata } : {}),
    };
  }

  consumeConversationActions(): DashboardAction[] {
    const actions = [...this.pendingConversationActions]
    this.pendingConversationActions = []
    return actions
  }

  consumeNavigate(): string | undefined {
    const navigateTo = this.pendingNavigateTo
    this.pendingNavigateTo = undefined
    return navigateTo
  }

  private isPanelExplanationRequest(message: string): boolean {
    const text = message.trim().toLowerCase()
    if (!text) return false
    return /(how is|what.*show|explain|interpret|analy[sz]e|describe|tell me about|walk me through|break down|summarize)/i.test(text)
      && /(panel|latency|error|rate|request|duration|p\d+|average|avg|http|metric|data|trend|chart)/i.test(text)
  }

  private findRelevantPanel(message: string, dashboard: Dashboard): Dashboard['panels'][number] | null {
    const lowered = message.toLowerCase()
    const scored = dashboard.panels.map((panel) => {
      const title = panel.title.toLowerCase()
      const description = (panel.description ?? '').toLowerCase()
      let score = 0
      if (lowered.includes(title)) score += 5
      const titleTokens = title.split(/[^a-z0-9\u4e00-\u9fa5]+/i).filter((token) => token.length >= 2)
      for (const token of titleTokens) {
        if (lowered.includes(token)) score += 1
      }
      if (description && lowered.includes(description)) score += 2
      return { panel, score }
    })

    scored.sort((left, right) => right.score - left.score)
    return scored[0] && scored[0].score > 0 ? scored[0].panel : null
  }

  async handleMessage(dashboardId: string, message: string): Promise<string> {
    this.emitAgentEvent(this.makeAgentEvent('agent.started', { dashboardId, message }));
    this.pendingConversationActions = []
    this.pendingNavigateTo = undefined

    const dashboard = await this.deps.store.findById(dashboardId)
    if (!dashboard) {
      this.emitAgentEvent(this.makeAgentEvent('agent.failed', { reason: 'Dashboard not found' }));
      throw new Error(`Dashboard ${dashboardId} not found`)
    }

    const history = await this.deps.conversationStore.getMessages(dashboardId)

    if (this.panelExplainAgent && this.isPanelExplanationRequest(message)) {
      const panel = this.findRelevantPanel(message, dashboard)
      if (panel && (panel.queries?.length || panel.query)) {
        const explainablePanel = panel.queries?.length
          ? panel
          : {
              ...panel,
              queries: panel.query ? [{ refId: 'A', expr: panel.query, instant: panel.visualization !== 'time_series' }] : [],
            }

        const reply = await this.panelExplainAgent.explain({
          userRequest: message,
          dashboard,
          panel: explainablePanel,
          timeRange: this.deps.timeRange,
        })
        this.deps.sendEvent({ type: 'reply', content: reply })
        this.emitAgentEvent(this.makeAgentEvent('agent.completed', { dashboardId, mode: 'panel_explanation', panelId: panel.id }))
        return reply
      }
    }

    // Fetch existing alert rules so LLM can reference them for modify/delete
    let alertRules: AlertRuleSummary[] = []
    if (this.deps.alertRuleStore.findAll) {
      try {
        const result = await this.deps.alertRuleStore.findAll()
        alertRules = (Array.isArray(result) ? result : (result as { list: unknown[] }).list ?? []) as typeof alertRules
      } catch { /* ignore */ }
    }

    const activeAlertRule = getStructuredAlertRuleContext(history, alertRules)
    const directFollowUpAction = parseAlertFollowUpAction(message, activeAlertRule)
    if (directFollowUpAction) {
      const result = await this.executeAction(dashboardId, directFollowUpAction)
      const finalReply = result
        ? await composeAlertFollowUpReply(this.deps.gateway, this.deps.model, message, directFollowUpAction, result)
        : ''
      if (finalReply) {
        this.deps.sendEvent({ type: 'reply', content: finalReply })
      }
      this.emitAgentEvent(this.makeAgentEvent('agent.completed', { dashboardId, mode: 'structured_alert_followup' }));
      return finalReply
    }

    const systemPrompt = buildSystemPrompt(dashboard, history, alertRules, activeAlertRule, this.deps.allDatasources ?? [])

    try {
      const result = await this.reactLoop.runLoop(
        systemPrompt,
        message,
        (step) => this.executeAction(dashboardId, step, message),
      )
      this.emitAgentEvent(this.makeAgentEvent('agent.completed', { dashboardId }));
      return result;
    }
    catch (err) {
      this.emitAgentEvent(this.makeAgentEvent('agent.failed', {
        dashboardId,
        error: getErrorMessage(err),
      }));
      throw err;
    }
  }

  private buildActionContext(): ActionContext {
    return {
      gateway: this.deps.gateway,
      model: this.deps.model,
      store: this.deps.store,
      investigationReportStore: this.deps.investigationReportStore,
      investigationStore: this.deps.investigationStore,
      alertRuleStore: this.deps.alertRuleStore,
      metricsAdapter: this.deps.metricsAdapter,
      allDatasources: this.deps.allDatasources,
      sendEvent: this.deps.sendEvent,
      actionExecutor: this.actionExecutor,
      generatorAgent: this.generatorAgent,
      panelAdderAgent: this.panelAdderAgent,
      panelEditorAgent: this.panelEditorAgent,
      investigationAgent: this.investigationAgent,
      alertRuleAgent: this.alertRuleAgent,
      verifierAgent: this.verifierAgent,
      emitAgentEvent: (event) => this.emitAgentEvent(event),
      makeAgentEvent: (type, metadata) => this.makeAgentEvent(type, metadata),
      pushConversationAction: (action) => this.pendingConversationActions.push(action),
      setNavigateTo: (path) => { this.pendingNavigateTo = path },
    }
  }

  private async executeAction(dashboardId: string, step: ReActStep, userMessage = ''): Promise<string | null> {
    const { action, args } = step
    const agentDef = OrchestratorAgent.definition;

    // --- Tool boundary enforcement ---
    if (!agentDef.allowedTools.includes(action as AgentToolName)) {
      log.warn(`[Orchestrator] agent attempted undeclared tool "${action}" — blocked`);
      this.emitAgentEvent(this.makeAgentEvent('agent.tool_blocked', { tool: action, reason: 'undeclared_tool' }));
      return `Tool "${action}" is not permitted for this agent.`;
    }

    // --- Permission mode enforcement ---
    const permissionResult = checkPermission(agentDef.permissionMode, action);
    if (permissionResult === 'block') {
      log.warn(`[Orchestrator] mutation "${action}" blocked — agent is read_only`);
      this.emitAgentEvent(this.makeAgentEvent('agent.tool_blocked', { tool: action, reason: 'read_only' }));
      return `Action "${action}" is blocked: agent is in read-only mode.`;
    }
    if (permissionResult === 'approval_required') {
      log.info(`[Orchestrator] mutation "${action}" requires approval — emitting proposal`);
      this.emitAgentEvent(this.makeAgentEvent('agent.artifact_proposed', { tool: action, args }));
      this.deps.sendEvent({
        type: 'approval_required',
        tool: action,
        args,
        displayText: `Action "${action}" requires approval before execution.`,
      });
      return `Action "${action}" requires approval. A proposal has been submitted.`;
    }
    if (permissionResult === 'propose_only') {
      log.info({ action }, 'mutation proposed but not applied — agent is propose_only');
      this.emitAgentEvent(this.makeAgentEvent('agent.artifact_proposed', { tool: action, args }));
      this.deps.sendEvent({
        type: 'tool_result',
        tool: action,
        summary: `Proposed "${action}" (not applied — propose-only mode)`,
        success: true,
      });
      return `Proposed "${action}" with args ${JSON.stringify(args).slice(0, 200)}. Not applied in propose-only mode.`;
    }

    // --- Emit tool_called event ---
    this.emitAgentEvent(this.makeAgentEvent('agent.tool_called', { tool: action }));

    const ctx = this.buildActionContext()

    try {
      switch (action) {
        case 'generate_dashboard': return handleGenerateDashboard(ctx, dashboardId, args)
        case 'add_panels': return handleAddPanels(ctx, dashboardId, args)
        case 'investigate': return handleInvestigate(ctx, dashboardId, args)
        case 'remove_panels': return handlePanelEdit(ctx, dashboardId, userMessage, 'remove_panels', args)
        case 'modify_panel': return handlePanelEdit(ctx, dashboardId, userMessage, 'modify_panel', args)
        case 'rearrange': return handlePanelEdit(ctx, dashboardId, userMessage, 'rearrange', args)
        case 'add_variable': return handleAddVariable(ctx, dashboardId, args)
        case 'set_title': return handleSetTitle(ctx, dashboardId, args)
        case 'create_alert_rule': return handleCreateAlertRule(ctx, dashboardId, args)
        case 'modify_alert_rule': return handleModifyAlertRule(ctx, dashboardId, args)
        case 'delete_alert_rule': return handleDeleteAlertRule(ctx, dashboardId, args)
        default: return `Unknown action "${action}" - skipping.`
      }
    }
    catch (err) {
      const observationText = `Action "${action}" failed: ${getErrorMessage(err)}. Do NOT retry this action — inform the user of the error and use the "reply" action to end.`
      this.deps.sendEvent({
        type: 'tool_result',
        tool: action,
        summary: observationText,
        success: false,
      })
      this.emitAgentEvent(this.makeAgentEvent('agent.tool_completed', {
        tool: action,
        success: false,
        error: getErrorMessage(err),
      }));
      return observationText
    }
  }
}
