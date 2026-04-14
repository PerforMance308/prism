// ExecutionAgent - LLM-classified recommended action generator
import { DEFAULT_LLM_MODEL, type Evidence } from '@agentic-obs/common';
import type { LLMGateway } from '@agentic-obs/llm-gateway';
import { buildCriticalNotifyAction, classifyAndRecommendActions } from './rules.js';
import { agentRegistry } from '../runtime/agent-registry.js';
import type { ExecutionInput, ExecutionOutput } from './types.js';

export class ExecutionAgent {
  static readonly definition = agentRegistry.get('execution')!;

  readonly name = 'execution';
  private readonly maxActions: number;
  private readonly gateway?: LLMGateway;
  private readonly model: string;

  constructor(options: {
    maxActions?: number;
    gateway?: LLMGateway;
    model?: string;
  } = {}) {
    this.maxActions = options.maxActions ?? 5;
    this.gateway = options.gateway;
    this.model = options.model ?? DEFAULT_LLM_MODEL;
  }

  async propose(input: ExecutionInput): Promise<ExecutionOutput> {
    const { conclusion, context } = input;

    // No gateway means no classification is possible — return the conclusion's
    // own recommended actions only, still subject to the same max-actions cap.
    if (!this.gateway) {
      const actions = conclusion.recommendedActions
        .slice(0, this.maxActions)
        .map((rec) => ({ ...rec.action, status: 'proposed' as const }));
      return { actions, summary: this.buildSummary(actions, context.entity) };
    }

    const hypotheses = conclusion.hypotheses
      .filter((h) => h.hypothesis.status !== 'refuted')
      .map((ranked) => ({
        hypothesis: ranked.hypothesis,
        evidence: [] as Evidence[],
      }));

    let actions = await classifyAndRecommendActions(
      hypotheses,
      context.entity,
      this.gateway,
      this.model,
    );

    actions = actions.slice(0, this.maxActions);

    const seenTypes = new Set(actions.map((a) => a.type));
    if (conclusion.impact.severity === 'critical' && !seenTypes.has('notify')) {
      const notifyHypothesis = conclusion.hypotheses[0]?.hypothesis;
      if (notifyHypothesis) {
        actions.push(buildCriticalNotifyAction(notifyHypothesis, context.entity));
        seenTypes.add('notify');
      }
    }

    for (const rec of conclusion.recommendedActions) {
      if (actions.length >= this.maxActions) break;
      if (seenTypes.has(rec.action.type)) continue;
      seenTypes.add(rec.action.type);
      actions.push({ ...rec.action, status: 'proposed' as const });
    }

    return { actions, summary: this.buildSummary(actions, context.entity) };
  }

  private buildSummary(actions: { type: string; policyTag?: string }[], entity: string): string {
    if (actions.length === 0) {
      return `No actionable recommendations generated for ${entity}.`;
    }
    const descriptions = actions.map((a) => `${a.type} (${a.policyTag})`).join(', ');
    return `Generated ${actions.length} recommended action(s) for ${entity}: ${descriptions}. All actions require operator review - none will auto-execute.`;
  }
}
