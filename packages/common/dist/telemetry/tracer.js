import { trace } from '@opentelemetry/api';
const TRACER_NAME = 'agentic-obs';
const TRACER_VERSION = '0.0.1';
let sdk = null;
let initialized = false;
/**
 * Initialize the OpenTelemetry SDK.
 * Uses OTLP exporter when OTEL_EXPORTER_OTLP_ENDPOINT is set, otherwise console.
 * Call once at application startup (before any spans are created).
 */
export async function initTelemetry(serviceName = 'agentic-obs') {
    if (initialized) {
        return;
    }
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
    const { ConsoleSpanExporter } = await import('@opentelemetry/sdk-trace-node');
    const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');
    const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
    const traceExporter = endpoint
        ? new OTLPTraceExporter({ url: `${endpoint}/v1/traces` })
        : new ConsoleSpanExporter();
    const instance = new NodeSDK({
        serviceName,
        traceExporter,
        instrumentations: [
            getNodeAutoInstrumentations({
                // Disable noisy instrumentations not needed for this service
                '@opentelemetry/instrumentation-fs': { enabled: false },
            }),
        ],
    });
    await instance.start();
    sdk = instance;
    initialized = true;
}
/**
 * Shut down the OpenTelemetry SDK and flush pending spans.
 */
export async function shutdownTelemetry() {
    if (sdk) {
        await sdk.shutdown();
        sdk = null;
        initialized = false;
    }
}
/**
 * Get a tracer instance for creating spans.
 * Works without calling initTelemetry() - returns a no-op tracer in that case.
 */
export function getTracer(name = TRACER_NAME) {
    return trace.getTracer(name, TRACER_VERSION);
}
//# sourceMappingURL=tracer.js.map
