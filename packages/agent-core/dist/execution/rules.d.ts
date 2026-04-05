import type { LLMGateway } from '@agentic-obs/llm-gateway';
import type { ActionRule } from './types.js';
import type { Action, Hypothesis, Evidence } from '@agentic-obs/common';
export declare function classifyAndRecommendActions(hypotheses: {
    hypothesis: Hypothesis;
    evidence: Evidence[];
}[], entity: string, gateway: LLMGateway, model: string): Promise<Action[]>;
export declare const rollbackRule: ActionRule;
export declare const scaleRule: ActionRule;
export declare const configReviewRule: ActionRule;
export declare const genericTicketRule: ActionRule;
export declare const criticalNotifyRule: ActionRule;
export declare const DEFAULT_RULES: ActionRule[];
//# sourceMappingURL=rules.d.ts.map