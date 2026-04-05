import { Router } from 'express';
import type { IGatewayInvestigationStore, IGatewayFeedStore, IGatewayShareStore } from '@agentic-obs/data-layer';
import type { OrchestratorRunner } from './orchestrator-runner.js';
interface InvestigationRouterDeps {
    store?: IGatewayInvestigationStore;
    feed?: IGatewayFeedStore;
    orchestrator?: OrchestratorRunner;
    shareRepo?: IGatewayShareStore;
}
export declare function createInvestigationRouter(deps?: InvestigationRouterDeps): Router;
export declare const InvestigationRouter: Router;
export declare const openApiRouter: import("express-serve-static-core").Router;
export {};
//# sourceMappingURL=router.d.ts.map