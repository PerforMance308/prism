import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type {
  IAlertRuleRepository,
  IGatewayFeedStore,
  IGatewayInvestigationStore,
  IInvestigationReportRepository,
} from '@agentic-obs/data-layer';
import type { IGatewayDashboardStore, IConversationStore } from '../repositories/types.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { hasPermission } from '../middleware/rbac.js';
import { AgentChatService, type AgentChatContext } from '../services/agent-chat-service.js';

export interface AgentRouterDeps {
  dashboardStore: IGatewayDashboardStore;
  conversationStore: IConversationStore;
  investigationReportStore: IInvestigationReportRepository;
  alertRuleStore: IAlertRuleRepository;
  investigationStore?: IGatewayInvestigationStore;
  feedStore?: IGatewayFeedStore;
}

export function createAgentRouter(deps: AgentRouterDeps): Router {
  const router = Router();
  const service = new AgentChatService({
    dashboardStore: deps.dashboardStore,
    conversationStore: deps.conversationStore,
    investigationReportStore: deps.investigationReportStore,
    alertRuleStore: deps.alertRuleStore,
    investigationStore: deps.investigationStore,
    feedStore: deps.feedStore,
  });

  router.use((req: Request, res: Response, next: NextFunction) => {
    authMiddleware(req as AuthenticatedRequest, res, next);
  });

  router.post('/chat', async (req: Request, res: Response, _next: NextFunction) => {
    const body = req.body as {
      message?: string;
      sessionId?: string;
      context?: AgentChatContext;
      timeRange?: { start?: string; end?: string; timezone?: string };
    };
    if (!body?.message || typeof body.message !== 'string' || body.message.trim() === '') {
      res.status(400).json({ code: 'INVALID_INPUT', message: 'message is required' });
      return;
    }
    if (!body.context || typeof body.context !== 'object' || typeof body.context.kind !== 'string') {
      res.status(400).json({ code: 'INVALID_INPUT', message: 'context is required' });
      return;
    }

    const permissions = (req as AuthenticatedRequest).auth?.permissions ?? [];
    const requiredPermission = (
      body.context.kind === 'investigation'
        ? 'investigation:read'
        : body.context.kind === 'dashboard'
          ? 'dashboard:write'
          : 'dashboard:write'
    );
    if (!hasPermission(permissions, requiredPermission)) {
      res.status(403).json({
        code: 'FORBIDDEN',
        message: `Insufficient permissions: requires ${requiredPermission}`,
      });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (type: string, data: unknown) => {
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await service.chat(
        body.message.trim(),
        body.context,
        (event) => {
          if ('data' in event) {
            send(event.type, event.data);
            return;
          }
          send(event.type, event);
        },
        body.timeRange,
        body.sessionId,
      );
      send('done', result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      send('error', { message });
    } finally {
      res.end();
    }
  });

  return router;
}
