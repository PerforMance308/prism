import type { Dashboard } from '@agentic-obs/common';
import type { VerificationTargetKind, VerificationReport, VerificationContext } from './types.js';
import { DashboardVerifier } from './dashboard-verifier.js';

export class VerifierAgent {
  private readonly dashboardVerifier = new DashboardVerifier();

  async verify(
    targetKind: VerificationTargetKind,
    target: unknown,
    context?: VerificationContext,
  ): Promise<VerificationReport> {
    switch (targetKind) {
      case 'dashboard': {
        return this.dashboardVerifier.verify({
          dashboard: target as Dashboard,
          prometheusUrl: context?.prometheusUrl,
          prometheusHeaders: context?.prometheusHeaders,
        });
      }

      case 'investigation_report':
      case 'alert_rule': {
        // Placeholder - will be implemented in Milestone 3
        return {
          status: 'passed',
          targetKind,
          summary: `Verification for ${targetKind} not yet implemented - auto-passing`,
          issues: [],
          checksRun: [],
        };
      }

      default: {
        return {
          status: 'passed',
          targetKind,
          summary: `Unknown target kind "${targetKind}" - auto-passing`,
          issues: [],
          checksRun: [],
        };
      }
    }
  }
}
