import type { LLMGateway } from '@agentic-obs/llm-gateway';
import type { ActionRule, ExecutionInput, ExecutionOutput } from './types.js';
export declare class ExecutionAgent {
    static readonly definition: import("../index.js").AgentDefinition;
    readonly name = "execution";
    private readonly rules;
    private readonly maxActions;
    private readonly gateway?;
    private readonly model;
    constructor(options?: {
        rules?: ActionRule[];
        maxActions?: number;
        gateway?: LLMGateway;
        model?: string;
    });
    propose(input: ExecutionInput): Promise<ExecutionOutput>;
    private proposeLegacy;
    private buildSummary;
}
//# sourceMappingURL=agent.d.ts.map