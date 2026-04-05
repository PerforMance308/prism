import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import type { IGatewayDashboardStore, IConversationStore } from '@agentic-obs/data-layer';
export interface DashboardRouterDeps {
    store?: IGatewayDashboardStore;
    conversationStore?: IConversationStore;
}
export declare function createDashboardRouter(deps?: DashboardRouterDeps): ExpressRouter;
export declare const dashboardRouter: Router;
//# sourceMappingURL=router.d.ts.map