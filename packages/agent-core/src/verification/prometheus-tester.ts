import { getErrorMessage } from '@agentic-obs/common';
import type { IMetricsAdapter } from '../adapters/index.js';

export interface PrometheusTestResult {
  ok: boolean;
  unreachable?: boolean;
  error?: string;
}

export async function testPrometheusQuery(
  adapter: IMetricsAdapter,
  expr: string,
): Promise<PrometheusTestResult> {
  try {
    return await adapter.testQuery(expr);
  } catch (err) {
    const message = getErrorMessage(err);
    if (isUnreachableError(message)) {
      return { ok: false, unreachable: true, error: message };
    }
    return { ok: false, error: message };
  }
}

function isUnreachableError(message: string): boolean {
  return (
    message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND') ||
    message.includes('ETIMEDOUT') ||
    message.includes('timeout') ||
    message.includes('fetch failed')
  );
}
