import type { Tracer } from '@opentelemetry/api';
/**
 * Initialize the OpenTelemetry SDK.
 * Uses OTLP exporter when OTEL_EXPORTER_OTLP_ENDPOINT is set, otherwise console.
 * Call once at application startup (before any spans are created).
 */
export declare function initTelemetry(serviceName?: string): Promise<void>;
/**
 * Shut down the OpenTelemetry SDK and flush pending spans.
 */
export declare function shutdownTelemetry(): Promise<void>;
/**
 * Get a tracer instance for creating spans.
 * Works without calling initTelemetry() - returns a no-op tracer in that case.
 */
export declare function getTracer(name?: string): Tracer;
//# sourceMappingURL=tracer.d.ts.map
