import { SpanStatusCode } from '@opentelemetry/api';
import { getTracer } from './tracer.js';
/**
 * Generic active span wrapper. Runs `fn` within a new span, automatically
 * recording errors and setting OK/ERROR status on completion.
 */
export async function withSpan(name, attrs, fn, options) {
    const tracer = getTracer();
    return tracer.startActiveSpan(name, options ?? {}, async (span) => {
        // Set all provided attributes (filter out undefined values)
        for (const [key, value] of Object.entries(attrs)) {
            if (value !== undefined) {
                span.setAttribute(key, value);
            }
        }
        try {
            const result = await fn(span);
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
        }
        catch (err) {
            span.setStatus({
                code: SpanStatusCode.ERROR,
                message: err instanceof Error ? err.message : String(err),
            });
            span.recordException(err instanceof Error ? err : new Error(String(err)));
            throw err;
        }
        finally {
            span.end();
        }
    });
}
/**
 * Root span for orchestrator.investigate() - the investigation entry point.
 */
export async function withOrchestratorSpan(investigationId, fn) {
    return withSpan('orchestrator.investigate', { investigationId, 'span.kind': 'service' }, fn);
}
/**
 * Child span for individual agent calls (intent/context/investigation/evidence/explanation).
 */
export async function withAgentSpan(agentName, investigationId, fn) {
    return withSpan(`agent.${agentName}`, { agentName, investigationId }, fn);
}
/**
 * Child span for LLM gateway calls - records model name and token usage.
 */
export async function withLlmSpan(llmModel, fn, extra) {
    return withSpan('llm.gateway.call', { llmModel, ...(extra ?? {}) }, fn);
}
/**
 * Child span for adapter calls - records the adapter name.
 */
export async function withAdapterSpan(adapterName, fn, extra) {
    return withSpan(`adapter.${adapterName}`, { adapterName, ...(extra ?? {}) }, fn);
}
//# sourceMappingURL=spans.js.map
