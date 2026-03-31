import type { Span, SpanOptions, OtelSpanOptions } from '@opentelemetry/api';
export interface SpanAttributes {
    investigationId?: string;
    agentName?: string;
    llmModel?: string;
    tokenCount?: number;
    adapterName?: string;
    [key: string]: string | number | boolean | undefined;
}
/**
 * Generic active span wrapper. Runs `fn` within a new span, automatically
 * recording errors and setting OK/ERROR status on completion.
 */
export declare function withSpan<T>(name: string, attrs: SpanAttributes, fn: (span: Span) => Promise<T>, options?: OtelSpanOptions): Promise<T>;
/** Root span for orchestrator.investigate() - the investigation entry point. */
export declare function withOrchestratorSpan<T>(investigationId: string, fn: (span: Span) => Promise<T>): Promise<T>;
/** Child span for individual agent calls (intent/context/investigation/evidence/explanation). */
export declare function withAgentSpan<T>(agentName: string, investigationId: string, fn: (span: Span) => Promise<T>): Promise<T>;
/** Child span for LLM gateway calls - records model name and token usage. */
export declare function withLlmSpan<T>(llmModel: string, fn: (span: Span) => Promise<T>, extra?: {
    investigationId?: string;
    tokenCount?: number;
    promptTokens?: number;
}): Promise<T>;
/** Child span for adapter calls - records the adapter name. */
export declare function withAdapterSpan<T>(adapterName: string, fn: (span: Span) => Promise<T>, extra?: {
    investigationId?: string;
}): Promise<T>;
//# sourceMappingURL=spans.d.ts.map
