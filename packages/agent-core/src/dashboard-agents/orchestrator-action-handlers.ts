import { randomUUID } from 'node:crypto'
import { createLogger } from '@agentic-obs/common'
import type {
  DashboardAction,
  DashboardVariable,
  DashboardSseEvent,
  Dashboard,
  Evidence,
  Hypothesis,
  ExplanationResult,
} from '@agentic-obs/common'
import type { LLMGateway } from '@agentic-obs/llm-gateway'
import type { IMetricsAdapter } from '../adapters/index.js'
import type { AgentEvent } from '../runtime/agent-events.js'
import type { ReActStep } from './react-loop.js'
import type {
  IDashboardAgentStore,
  IInvestigationReportStore,
  IInvestigationStore,
  IAlertRuleStore,
  DatasourceConfig,
} from './types.js'
import type { DatasourceContext } from './panel-adder-agent.js'
import type { ActionExecutor } from './action-executor.js'
import type { DashboardGeneratorAgent } from './dashboard-generator-agent.js'
import type { PanelAdderAgent } from './panel-adder-agent.js'
import type { PanelEditorAgent } from './panel-editor-agent.js'
import type { InvestigationAgent } from './investigation-agent.js'
import type { AlertRuleAgent } from './alert-rule-agent.js'
import type { VerifierAgent } from '../verification/verifier-agent.js'
import { DiscoveryAgent } from './discovery-agent.js'

const log = createLogger('orchestrator-actions')

/** Shared context passed to every action handler. */
export interface ActionContext {
  gateway: LLMGateway
  model: string
  store: IDashboardAgentStore
  investigationReportStore: IInvestigationReportStore
  investigationStore?: IInvestigationStore
  alertRuleStore: IAlertRuleStore
  metricsAdapter?: IMetricsAdapter
  allDatasources?: DatasourceConfig[]
  sendEvent: (event: DashboardSseEvent) => void

  actionExecutor: ActionExecutor
  generatorAgent: DashboardGeneratorAgent
  panelAdderAgent: PanelAdderAgent
  panelEditorAgent: PanelEditorAgent
  investigationAgent?: InvestigationAgent
  alertRuleAgent: AlertRuleAgent
  verifierAgent: VerifierAgent

  emitAgentEvent(event: AgentEvent): void
  makeAgentEvent(type: AgentEvent['type'], metadata?: Record<string, unknown>): AgentEvent
  pushConversationAction(action: DashboardAction): void
  setNavigateTo(path: string): void
}

// ---------------------------------------------------------------------------
// Panel edit (shared by remove_panels, modify_panel, rearrange)
// ---------------------------------------------------------------------------

export async function handlePanelEdit(
  ctx: ActionContext,
  dashboardId: string,
  userMessage: string,
  requestedAction: 'modify_panel' | 'remove_panels' | 'rearrange',
  args: Record<string, unknown>,
): Promise<string> {
  const currentDash = await ctx.store.findById(dashboardId)
  if (!currentDash) throw new Error('Dashboard not found')

  const displayText = requestedAction === 'modify_panel'
    ? `Editing panels: ${userMessage}`
    : requestedAction === 'remove_panels'
      ? `Removing panel(s)`
      : 'Rearranging panel layout'

  ctx.sendEvent({ type: 'tool_call', tool: requestedAction, args, displayText })

  const plan = await ctx.panelEditorAgent.planEdit({
    userRequest: userMessage,
    requestedAction,
    requestedArgs: args,
    dashboard: currentDash,
  })

  if (plan.actions.length === 0) {
    ctx.sendEvent({ type: 'tool_result', tool: requestedAction, summary: plan.summary, success: false })
    ctx.emitAgentEvent(ctx.makeAgentEvent('agent.tool_completed', { tool: requestedAction, summary: plan.summary }))
    return plan.summary
  }

  await ctx.actionExecutor.execute(dashboardId, plan.actions)

  let verificationFailed = false
  let verificationIssues = ''
  const updatedDash = await ctx.store.findById(dashboardId)
  if (updatedDash) {
    const verificationReport = await ctx.verifierAgent.verify('dashboard', updatedDash, {
      metricsAdapter: ctx.metricsAdapter,
    })
    ctx.sendEvent({ type: 'verification_report', report: verificationReport })
    ctx.emitAgentEvent(ctx.makeAgentEvent('agent.artifact_verified', {
      tool: requestedAction,
      status: verificationReport.status,
      summary: verificationReport.summary,
    }))

    if (verificationReport.status === 'failed') {
      verificationFailed = true
      verificationIssues = verificationReport.issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.message)
        .join('; ')
      await ctx.store.updatePanels(dashboardId, currentDash.panels)
      await ctx.store.updateVariables(dashboardId, currentDash.variables)
    }
  }

  const observationText = verificationFailed
    ? verificationIssues
      ? `Panel edit was reverted because verification failed: ${verificationIssues}`
      : 'Panel edit was reverted because verification failed.'
    : `${plan.summary} No further dashboard mutation is needed for this request.`

  ctx.sendEvent({
    type: 'tool_result',
    tool: requestedAction,
    summary: verificationFailed ? 'Panel edit reverted after verification failed' : plan.summary,
    success: !verificationFailed,
  })
  ctx.emitAgentEvent(ctx.makeAgentEvent('agent.tool_completed', { tool: requestedAction, summary: observationText }))
  return observationText
}

// ---------------------------------------------------------------------------
// generate_dashboard
// ---------------------------------------------------------------------------

export async function handleGenerateDashboard(
  ctx: ActionContext,
  dashboardId: string,
  args: Record<string, unknown>,
): Promise<string> {
  const goal = String(args.goal ?? '')

  ctx.sendEvent({
    type: 'tool_call',
    tool: 'generate_dashboard',
    args: { goal },
    displayText: `Generating dashboard: ${goal}`,
  })

  const currentDash = await ctx.store.findById(dashboardId)
  if (!currentDash) throw new Error('Dashboard not found')

  const result = await ctx.generatorAgent.generate({
    goal,
    existingPanels: currentDash.panels,
    existingVariables: currentDash.variables,
  })

  // Discovery found 0 relevant metrics — ask the user for clarification
  if (result.needsClarification) {
    const { searchedFor, totalMetricsInPrometheus, candidateMetrics } = result.needsClarification
    let clarificationMsg = `I searched for metrics related to "${searchedFor}" but found no relevant matches in your Prometheus instance (${totalMetricsInPrometheus} total metrics available).`
    if (candidateMetrics.length > 0) {
      const listed = candidateMetrics.slice(0, 10).join(', ')
      clarificationMsg += `\n\nSome potentially related metrics I found: ${listed}`
      if (candidateMetrics.length > 10) {
        clarificationMsg += ` (and ${candidateMetrics.length - 10} more)`
      }
    }
    clarificationMsg += '\n\nCould you clarify what you\'d like to monitor? For example, you could specify a metric prefix or the service/exporter name.'

    ctx.sendEvent({
      type: 'tool_result',
      tool: 'generate_dashboard',
      summary: 'No relevant metrics found — asking user for clarification',
      success: false,
    })
    ctx.emitAgentEvent(ctx.makeAgentEvent('agent.tool_completed', {
      tool: 'generate_dashboard',
      summary: 'needsClarification — 0 relevant metrics',
    }))
    return `CLARIFICATION_NEEDED: ${clarificationMsg}`
  }

  if (result.title) {
    await ctx.actionExecutor.execute(dashboardId, [{
      type: 'set_title',
      title: result.title,
      ...(result.description ? { description: result.description } : {}),
    }])
  }

  if (result.panels.length > 0) {
    await ctx.actionExecutor.execute(dashboardId, [{ type: 'add_panels', panels: result.panels }])
  }

  if (result.variables && result.variables.length > 0) {
    for (const variable of result.variables) {
      await ctx.actionExecutor.execute(dashboardId, [{ type: 'add_variable', variable }])
    }
  }

  // Run verification on the generated dashboard
  const updatedDash = await ctx.store.findById(dashboardId)
  let verificationFailed = false
  if (updatedDash) {
    const verificationReport = await ctx.verifierAgent.verify('dashboard', updatedDash, {
      metricsAdapter: ctx.metricsAdapter,
    })
    ctx.sendEvent({ type: 'verification_report', report: verificationReport })
    ctx.emitAgentEvent(ctx.makeAgentEvent('agent.artifact_verified', {
      tool: 'generate_dashboard',
      status: verificationReport.status,
      summary: verificationReport.summary,
    }))
    if (verificationReport.status === 'failed') {
      verificationFailed = true
      log.warn({ summary: verificationReport.summary }, 'dashboard verification failed — rolling back panels')
      const panelIdsToRemove = result.panels.map((p) => p.id)
      if (panelIdsToRemove.length > 0) {
        await ctx.actionExecutor.execute(dashboardId, [{ type: 'remove_panels', panelIds: panelIdsToRemove }])
      }
      if (result.title) {
        await ctx.actionExecutor.execute(dashboardId, [{ type: 'set_title', title: currentDash.title }])
      }
      if (result.variables?.length) {
        log.warn(
          { count: result.variables.length },
          'cannot rollback added variables — remove_variable action not implemented; variables may remain',
        )
      }
    }
  }

  const observationText = verificationFailed
    ? `Generated ${result.panels.length} panels but some had issues (panels rolled back).`
    : `Generated ${result.panels.length} panels`
      + (result.variables?.length ? ` and ${result.variables.length} variables` : '')

  ctx.sendEvent({
    type: 'tool_result',
    tool: 'generate_dashboard',
    summary: observationText,
    success: !verificationFailed && result.panels.length > 0,
  })
  ctx.emitAgentEvent(ctx.makeAgentEvent('agent.tool_completed', { tool: 'generate_dashboard', summary: observationText }))
  return observationText
}

// ---------------------------------------------------------------------------
// add_panels
// ---------------------------------------------------------------------------

export async function handleAddPanels(
  ctx: ActionContext,
  dashboardId: string,
  args: Record<string, unknown>,
): Promise<string> {
  const goal = String(args.goal ?? '')
  const currentDash = await ctx.store.findById(dashboardId)
  if (!currentDash) throw new Error('Dashboard not found')

  ctx.sendEvent({
    type: 'tool_call',
    tool: 'add_panels',
    args: { goal },
    displayText: `Adding panels: ${goal}`,
  })

  // Discover available metrics and labels before generating panels
  let discoveredDatasources: DatasourceContext[] = []
  if (ctx.metricsAdapter) {
    try {
      const discoveryAgent = new DiscoveryAgent(ctx.metricsAdapter, ctx.sendEvent)
      let searchPatterns: string[]
      try {
        const kwResp = await ctx.gateway.complete([
          { role: 'system', content: 'Extract 3-5 short metric name keywords/prefixes from the user goal. Return ONLY a JSON array of strings like ["http", "request", "duration"]. No explanation.' },
          { role: 'user', content: goal },
        ], { model: ctx.model, maxTokens: 100, temperature: 0, responseFormat: 'json' })
        const parsed = JSON.parse(kwResp.content.replace(/```json\n?/g, '').replace(/```/g, '').trim())
        searchPatterns = Array.isArray(parsed) ? parsed : [goal]
      } catch {
        searchPatterns = goal.split(/\s+/).filter((w) => w.length > 3)
      }
      const discovery = await discoveryAgent.discover(searchPatterns)
      const labelsByMetric: Record<string, string[]> = { ...discovery.labelsByMetric }
      for (const [metric, sample] of Object.entries(discovery.sampleValues)) {
        if (sample.sampleLabels.length > 0) {
          const valueContext = sample.sampleLabels.map((labels) =>
            Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(', ')
          )
          labelsByMetric[metric] = [...(labelsByMetric[metric] ?? []), `  sample: {${valueContext[0]}}`]
        }
      }
      const activeDs = ctx.allDatasources?.[0]
      discoveredDatasources = [{
        name: activeDs?.name ?? 'metrics',
        type: activeDs?.type ?? 'prometheus',
        metrics: discovery.metrics,
        labelsByMetric,
      }]
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : err }, 'metric discovery failed, proceeding without context')
    }
  }

  const result = await ctx.panelAdderAgent.addPanels({
    goal,
    existingPanels: currentDash.panels,
    existingVariables: currentDash.variables,
    datasources: discoveredDatasources,
    gridNextRow: currentDash.panels.length > 0
      ? Math.max(...currentDash.panels.map((p) => p.row + p.height))
      : 0,
  })

  if (result.panels.length > 0) {
    await ctx.actionExecutor.execute(dashboardId, [{ type: 'add_panels', panels: result.panels }])
  }

  if (result.variables && result.variables.length > 0) {
    for (const variable of result.variables) {
      await ctx.actionExecutor.execute(dashboardId, [{ type: 'add_variable', variable }])
    }
  }

  // Run verification on the updated dashboard
  const updatedDashForPanels = await ctx.store.findById(dashboardId)
  let addPanelsVerificationFailed = false
  if (updatedDashForPanels) {
    const verificationReport = await ctx.verifierAgent.verify('dashboard', updatedDashForPanels, {
      metricsAdapter: ctx.metricsAdapter,
    })
    ctx.sendEvent({ type: 'verification_report', report: verificationReport })
    ctx.emitAgentEvent(ctx.makeAgentEvent('agent.artifact_verified', {
      tool: 'add_panels',
      status: verificationReport.status,
      summary: verificationReport.summary,
    }))
    if (verificationReport.status === 'failed') {
      addPanelsVerificationFailed = true
      await ctx.store.updatePanels(dashboardId, currentDash.panels)
    }
  }

  const observationText = addPanelsVerificationFailed
    ? 'The new panels were not applied because verification found problems with the result.'
    : `Added ${result.panels.length} panel(s)` + (result.variables?.length ? ` and ${result.variables.length} variable(s)` : '')

  ctx.sendEvent({
    type: 'tool_result',
    tool: 'add_panels',
    summary: addPanelsVerificationFailed ? 'Panel addition was reverted after verification failed' : observationText,
    success: result.panels.length > 0 && !addPanelsVerificationFailed,
  })
  ctx.emitAgentEvent(ctx.makeAgentEvent('agent.tool_completed', { tool: 'add_panels', summary: observationText }))
  return observationText
}

// ---------------------------------------------------------------------------
// investigate
// ---------------------------------------------------------------------------

function extractEvidenceFromReport(
  report: { sections: Array<{ type: string, content?: string, panel?: Dashboard['panels'][number] }> },
): Evidence[] {
  const evidence: Evidence[] = []
  for (const section of report.sections) {
    if (section.type !== 'evidence' || !section.panel) continue
    const query = section.panel.queries?.[0]?.expr ?? section.panel.query ?? ''
    evidence.push({
      id: randomUUID(),
      hypothesisId: '',
      type: 'metric',
      query,
      queryLanguage: 'promql',
      result: { query, series: [], totalSeries: 0 },
      summary: section.content ?? section.panel.title,
      timestamp: new Date().toISOString(),
      reproducible: true,
    })
  }
  return evidence
}

function extractHypothesesFromSummary(
  investigationId: string,
  summary: string,
  evidence: Evidence[],
): Hypothesis[] {
  return [{
    id: randomUUID(),
    investigationId,
    description: summary,
    confidence: 0.7,
    confidenceBasis: `Based on ${evidence.length} evidence items`,
    status: 'supported',
    evidenceIds: evidence.map((item) => item.id),
    counterEvidenceIds: [],
  }]
}

export async function handleInvestigate(
  ctx: ActionContext,
  dashboardId: string,
  args: Record<string, unknown>,
): Promise<string> {
  const goal = String(args.goal ?? '')
  ctx.sendEvent({
    type: 'tool_call',
    tool: 'investigate',
    args: { goal },
    displayText: `Investigating: ${goal}`,
  })

  if (!ctx.investigationAgent) {
    const observationText = 'Investigation requires Prometheus - no Prometheus URL configured.'
    ctx.sendEvent({ type: 'tool_result', tool: 'investigate', summary: observationText, success: false })
    return observationText
  }

  const currentDash = await ctx.store.findById(dashboardId)
  if (!currentDash) throw new Error('Dashboard not found')

  const result = await ctx.investigationAgent.investigate({
    goal,
    existingPanels: currentDash.panels,
    gridNextRow: currentDash.panels.length > 0
      ? Math.max(...currentDash.panels.map((p) => p.row + p.height))
      : 0,
  })

  // Run verification on the investigation report
  const verificationReport = await ctx.verifierAgent.verify('investigation_report', result.report, {
    metricsAdapter: ctx.metricsAdapter,
  })
  ctx.sendEvent({ type: 'verification_report', report: verificationReport })
  ctx.emitAgentEvent(ctx.makeAgentEvent('agent.artifact_verified', {
    tool: 'investigate',
    status: verificationReport.status,
    summary: verificationReport.summary,
  }))

  // Save report and provide a navigable link
  const reportId = randomUUID()
  ctx.investigationReportStore.save({
    id: reportId,
    dashboardId,
    goal,
    summary: result.summary,
    sections: result.report.sections,
    createdAt: new Date().toISOString(),
  })

  if (ctx.investigationStore) {
    const investigation = await ctx.investigationStore.create({
      question: goal,
      sessionId: `ses_dash_${Date.now()}`,
      userId: currentDash.userId ?? 'anonymous',
    })

    const evidence = extractEvidenceFromReport(result.report)
    const hypotheses = extractHypothesesFromSummary(investigation.id, result.summary, evidence)
    const conclusion: ExplanationResult = {
      summary: result.summary,
      rootCause: null,
      confidence: 0.7,
      recommendedActions: [],
    }

    await ctx.investigationStore.updatePlan(investigation.id, {
      entity: currentDash.title,
      objective: goal,
      steps: [
        { id: 'plan', type: 'plan', description: 'Plan investigation queries', status: 'completed' },
        { id: 'query', type: 'query', description: 'Execute Prometheus queries', status: 'completed' },
        { id: 'analyze', type: 'analyze', description: 'Analyze evidence and generate report', status: 'completed' },
      ],
      stopConditions: [],
    })
    await ctx.investigationStore.updateResult(investigation.id, {
      hypotheses,
      evidence,
      conclusion,
    })
    await ctx.investigationReportStore.save({
      id: randomUUID(),
      dashboardId: investigation.id,
      goal,
      summary: result.report.summary,
      sections: result.report.sections,
      createdAt: new Date().toISOString(),
    })
    await ctx.investigationStore.updateStatus(investigation.id, 'completed')
    ctx.setNavigateTo(`/investigations/${investigation.id}`)
  }

  const observationText = result.summary
  ctx.sendEvent({
    type: 'tool_result',
    tool: 'investigate',
    summary: `Investigation complete — ${result.panels.length} evidence panels added. [View report](/investigations)`,
    success: !verificationReport || verificationReport.status !== 'failed',
  })
  ctx.emitAgentEvent(ctx.makeAgentEvent('agent.tool_completed', { tool: 'investigate', summary: observationText }))
  return observationText
}

// ---------------------------------------------------------------------------
// add_variable
// ---------------------------------------------------------------------------

export async function handleAddVariable(
  ctx: ActionContext,
  dashboardId: string,
  args: Record<string, unknown>,
): Promise<string> {
  const variable = args.variable as DashboardVariable
  ctx.sendEvent({
    type: 'tool_call',
    tool: 'add_variable',
    args: { variable },
    displayText: `Adding variable: ${variable?.name ?? ''}`,
  })

  const addVarAction: DashboardAction = { type: 'add_variable', variable }
  await ctx.actionExecutor.execute(dashboardId, [addVarAction])
  const observationText = `Added variable: ${variable?.name ?? ''}.`

  ctx.sendEvent({
    type: 'tool_result',
    tool: 'add_variable',
    summary: `Variable ${variable?.name ?? ''} added`,
    success: true,
  })
  ctx.emitAgentEvent(ctx.makeAgentEvent('agent.tool_completed', { tool: 'add_variable', summary: observationText }))
  return observationText
}

// ---------------------------------------------------------------------------
// set_title
// ---------------------------------------------------------------------------

export async function handleSetTitle(
  ctx: ActionContext,
  dashboardId: string,
  args: Record<string, unknown>,
): Promise<string> {
  const title = String(args.title ?? '')
  const description = typeof args.description === 'string' ? args.description : undefined
  ctx.sendEvent({
    type: 'tool_call',
    tool: 'set_title',
    args: { title, ...(description !== undefined ? { description } : {}) },
    displayText: `Setting title: "${title}"`,
  })

  const titleAction: DashboardAction = {
    type: 'set_title',
    title,
    ...(description !== undefined ? { description } : {}),
  }
  await ctx.actionExecutor.execute(dashboardId, [titleAction])
  const observationText = `Title set to "${title}".`

  ctx.sendEvent({
    type: 'tool_result',
    tool: 'set_title',
    summary: `Title updated to "${title}"`,
    success: true,
  })
  ctx.emitAgentEvent(ctx.makeAgentEvent('agent.tool_completed', { tool: 'set_title', summary: observationText }))
  return observationText
}

// ---------------------------------------------------------------------------
// create_alert_rule
// ---------------------------------------------------------------------------

export async function handleCreateAlertRule(
  ctx: ActionContext,
  dashboardId: string,
  args: Record<string, unknown>,
): Promise<string> {
  const prompt = String(args.prompt ?? args.goal ?? '')
  ctx.sendEvent({
    type: 'tool_call',
    tool: 'create_alert_rule',
    args: { prompt },
    displayText: `Creating alert rule: ${prompt.slice(0, 60)}`,
  })

  const currentDash = await ctx.store.findById(dashboardId)
  const existingQueries = (currentDash?.panels ?? [])
    .flatMap((p) => [
      ...(p.queries ?? []).map((q) => q.expr),
      ...(typeof p.query === 'string' && p.query.trim().length > 0 ? [p.query] : []),
    ])
    .filter(Boolean)
  const variables = (currentDash?.variables ?? []).map((v) => ({
    name: v.name,
    value: v.current,
  }))

  const result = await ctx.alertRuleAgent.generate(prompt, {
    dashboardId,
    dashboardTitle: currentDash?.title,
    existingQueries: existingQueries.length > 0 ? existingQueries : undefined,
    variables: variables.length > 0 ? variables : undefined,
  })
  const generated = result.rule

  if (result.verificationReport) {
    ctx.sendEvent({ type: 'verification_report', report: result.verificationReport })

    if (result.verificationReport.status === 'failed') {
      const failIssues = result.verificationReport.issues
        .filter((i) => i.severity === 'error')
        .map((i) => i.message)
        .join('; ')
      ctx.sendEvent({
        type: 'tool_result',
        tool: 'create_alert_rule',
        summary: `Alert rule verification failed — rule NOT saved`,
        success: false,
      })
      ctx.emitAgentEvent(ctx.makeAgentEvent('agent.tool_completed', { tool: 'create_alert_rule', summary: 'blocked by verifier' }))
      return `Alert rule verification failed: ${failIssues}. Rule was NOT saved.`
    }
  }

  // Upsert: if a rule with the same name exists, update it instead of creating a duplicate
  let rule: Record<string, unknown> | undefined
  let isUpdate = false
  if (ctx.alertRuleStore.findAll && ctx.alertRuleStore.update) {
    try {
      const existing = await ctx.alertRuleStore.findAll()
      const list = (Array.isArray(existing) ? existing : (existing as { list: unknown[] }).list ?? []) as Array<{ id: string; name: string }>
      const match = list.find((r) => r.name === generated.name)
      if (match) {
        rule = await ctx.alertRuleStore.update(match.id, {
          description: generated.description,
          condition: generated.condition,
          evaluationIntervalSec: generated.evaluationIntervalSec,
          severity: generated.severity,
        }) as Record<string, unknown> | undefined
        isUpdate = true
      }
    } catch { /* fall through to create */ }
  }

  if (!rule) {
    rule = await ctx.alertRuleStore.create({
      name: generated.name,
      description: generated.description,
      originalPrompt: prompt,
      condition: generated.condition,
      evaluationIntervalSec: generated.evaluationIntervalSec,
      severity: generated.severity,
      labels: {
        ...generated.labels,
        ...(dashboardId ? { dashboardId } : {}),
      },
      createdBy: 'llm',
    }) as Record<string, unknown>
  }

  const rc = rule.condition as Record<string, unknown>
  const verb = isUpdate ? 'Updated' : 'Created'
  ctx.pushConversationAction({
    type: 'create_alert_rule',
    ruleId: String(rule.id ?? ''),
    name: String(rule.name ?? generated.name),
    severity: String(rule.severity ?? generated.severity),
    query: String(rc.query ?? ''),
    operator: String(rc.operator ?? ''),
    threshold: Number(rc.threshold ?? 0),
    forDurationSec: Number(rc.forDurationSec ?? 0),
    evaluationIntervalSec: Number(rule.evaluationIntervalSec ?? generated.evaluationIntervalSec),
  })
  const observationText = `${verb} alert rule "${rule.name}" (id: ${rule.id ?? 'unknown'}, ${rule.severity}, evaluating every ${rule.evaluationIntervalSec}s). Rule: ${rc.query} ${rc.operator} ${rc.threshold} for ${rc.forDurationSec}s.${generated.autoInvestigate ? ' Auto-investigation enabled on fire.' : ''}`
  ctx.sendEvent({
    type: 'tool_result',
    tool: 'create_alert_rule',
    summary: `Alert rule "${rule.name}" ${verb.toLowerCase()}`,
    success: true,
  })
  ctx.emitAgentEvent(ctx.makeAgentEvent('agent.tool_completed', { tool: 'create_alert_rule', summary: observationText }))
  return observationText
}

// ---------------------------------------------------------------------------
// modify_alert_rule
// ---------------------------------------------------------------------------

export async function handleModifyAlertRule(
  ctx: ActionContext,
  dashboardId: string,
  args: Record<string, unknown>,
): Promise<string> {
  const ruleId = String(args.ruleId ?? '')
  const patch = (args.patch ?? args) as Record<string, unknown>
  if (!ruleId) return 'Error: ruleId is required for modify_alert_rule.'
  if (!ctx.alertRuleStore.update) return 'Error: alert rule store does not support updates.'
  if (!ctx.alertRuleStore.findById) return 'Error: alert rule store does not support findById.'

  ctx.sendEvent({
    type: 'tool_call',
    tool: 'modify_alert_rule',
    args: { ruleId, patch },
    displayText: `Updating alert rule ${ruleId}...`,
  })

  const existingRule = await ctx.alertRuleStore.findById(ruleId) as Record<string, unknown> | undefined
  if (!existingRule) return `Error: alert rule ${ruleId} not found.`

  const updatePatch: Record<string, unknown> = {}
  if (patch.severity) updatePatch.severity = patch.severity
  if (patch.evaluationIntervalSec) updatePatch.evaluationIntervalSec = patch.evaluationIntervalSec
  if (patch.name) updatePatch.name = patch.name

  const existingCondition = (existingRule.condition ?? {}) as Record<string, unknown>
  const hasConditionChanges = patch.threshold !== undefined || patch.operator || patch.forDurationSec !== undefined || patch.query
  if (hasConditionChanges) {
    updatePatch.condition = {
      ...existingCondition,
      ...(patch.threshold !== undefined ? { threshold: patch.threshold } : {}),
      ...(patch.operator ? { operator: patch.operator } : {}),
      ...(patch.forDurationSec !== undefined ? { forDurationSec: patch.forDurationSec } : {}),
      ...(patch.query ? { query: patch.query } : {}),
    }
  }

  const updatedRule = await ctx.alertRuleStore.update(ruleId, updatePatch) as Record<string, unknown> | undefined

  ctx.pushConversationAction({
    type: 'modify_alert_rule',
    ruleId,
    patch: {
      ...(patch.threshold !== undefined ? { threshold: Number(patch.threshold) } : {}),
      ...(typeof patch.operator === 'string' ? { operator: patch.operator } : {}),
      ...(typeof patch.severity === 'string' ? { severity: patch.severity } : {}),
      ...(patch.forDurationSec !== undefined ? { forDurationSec: Number(patch.forDurationSec) } : {}),
      ...(patch.evaluationIntervalSec !== undefined ? { evaluationIntervalSec: Number(patch.evaluationIntervalSec) } : {}),
      ...(typeof patch.query === 'string' ? { query: patch.query } : {}),
      ...(typeof patch.name === 'string' ? { name: patch.name } : {}),
    },
  })

  const updatedRuleName = String(updatedRule?.name ?? existingRule.name ?? 'the alert rule')
  const updatedCondition = ((updatedRule?.condition ?? updatePatch.condition ?? existingCondition) as Record<string, unknown>)
  const thresholdText = updatedCondition.threshold !== undefined ? ` to ${updatedCondition.threshold}` : ''
  const operatorText = typeof updatedCondition.operator === 'string' ? ` (${updatedCondition.operator})` : ''
  const observationText = `Updated "${updatedRuleName}"${thresholdText}${operatorText}.`
  ctx.sendEvent({
    type: 'tool_result',
    tool: 'modify_alert_rule',
    summary: observationText,
    success: true,
  })
  ctx.emitAgentEvent(ctx.makeAgentEvent('agent.tool_completed', { tool: 'modify_alert_rule', summary: observationText }))
  return observationText
}

// ---------------------------------------------------------------------------
// delete_alert_rule
// ---------------------------------------------------------------------------

export async function handleDeleteAlertRule(
  ctx: ActionContext,
  dashboardId: string,
  args: Record<string, unknown>,
): Promise<string> {
  const ruleId = String(args.ruleId ?? '')
  if (!ruleId) return 'Error: ruleId is required for delete_alert_rule.'

  ctx.sendEvent({
    type: 'tool_call',
    tool: 'delete_alert_rule',
    args: { ruleId },
    displayText: `Deleting alert rule ${ruleId}...`,
  })

  const existingRule = ctx.alertRuleStore.findById
    ? await ctx.alertRuleStore.findById(ruleId) as Record<string, unknown> | undefined
    : undefined

  if (ctx.alertRuleStore.delete) {
    await ctx.alertRuleStore.delete(ruleId)
  }

  ctx.pushConversationAction({
    type: 'delete_alert_rule',
    ruleId,
  })

  const deletedRuleName = String(existingRule?.name ?? 'the alert rule')
  const observationText = `Deleted "${deletedRuleName}".`
  ctx.sendEvent({
    type: 'tool_result',
    tool: 'delete_alert_rule',
    summary: observationText,
    success: true,
  })
  ctx.emitAgentEvent(ctx.makeAgentEvent('agent.tool_completed', { tool: 'delete_alert_rule', summary: observationText }))
  return observationText
}
