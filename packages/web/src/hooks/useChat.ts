import { useState, useCallback, useRef, useEffect } from 'react';
import { apiClient } from '../api/client.js';
import type { ChatMessage, ChatEvent } from './useDashboardChat.js';

/** Page context — tells the agent what the user is currently looking at. */
export interface PageContext {
  /** e.g., "dashboard", "investigation", "alerts", "home" */
  kind: string;
  /** Resource ID (dashboardId, investigationId, etc.) */
  id?: string;
  /** Selected time range on the dashboard (e.g., "1h", "6h", "24h", "7d") */
  timeRange?: string;
}

export interface UseChatResult {
  messages: ChatMessage[];
  events: ChatEvent[];
  isGenerating: boolean;
  sendMessage: (content: string) => Promise<void>;
  stopGeneration: () => void;
  /** Set by the backend when the agent creates a resource and emits a navigate SSE event. */
  pendingNavigation: string | null;
  clearPendingNavigation: () => void;
  /** Set the current page context — agent uses this to know which resource the user is viewing. */
  setPageContext: (ctx: PageContext | null) => void;
  /** Current session ID (readonly). */
  currentSessionId: string;
  /** Clear messages/events, generate a new sessionId, persist to localStorage. */
  startNewSession: () => void;
  /** Load a session's messages from the backend. Handles 404 gracefully. */
  loadSession: (sessionId: string) => Promise<void>;
}

/**
 * Global chat hook — not tied to any specific dashboard.
 * Calls POST /api/chat and handles SSE events the same way useDashboardChat does.
 */
export function useChat(): UseChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const pageContextRef = useRef<PageContext | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string>(
    () => localStorage.getItem('chat_session_id') ?? `ses_${crypto.randomUUID()}`,
  );
  const sessionIdRef = useRef<string>(currentSessionId);

  // Keep ref in sync with state
  useEffect(() => {
    sessionIdRef.current = currentSessionId;
    localStorage.setItem('chat_session_id', currentSessionId);
  }, [currentSessionId]);

  const appendEvent = useCallback((evt: ChatEvent) => {
    setEvents((prev) => [...prev, evt]);
  }, []);

  const clearPendingNavigation = useCallback(() => {
    setPendingNavigation(null);
  }, []);

  const handleSSEEvent = useCallback(
    (eventType: string, rawData: string) => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(rawData) as Record<string, unknown>;
      } catch {
        parsed = { content: rawData };
      }

      const resolvedType =
        eventType === 'message' && typeof parsed.type === 'string'
          ? parsed.type
          : eventType;

      const id = crypto.randomUUID();

      switch (resolvedType) {
        case 'thinking': {
          appendEvent({
            id,
            kind: 'thinking',
            content: (parsed.content as string) ?? 'Thinking...',
          });
          break;
        }

        case 'tool_call': {
          appendEvent({
            id,
            kind: 'tool_call',
            tool: parsed.tool as string | undefined,
            content: (parsed.displayText as string) ?? (parsed.content as string) ?? '',
          });
          break;
        }

        case 'tool_result': {
          appendEvent({
            id,
            kind: 'tool_result',
            tool: parsed.tool as string | undefined,
            content: (parsed.summary as string) ?? (parsed.content as string) ?? '',
            success: parsed.success !== false,
          });
          break;
        }

        case 'panel_added': {
          appendEvent({ id, kind: 'panel_added', panel: parsed.panel as ChatEvent['panel'] });
          break;
        }

        case 'panel_removed': {
          appendEvent({ id, kind: 'panel_removed', panelId: parsed.panelId as string | undefined });
          break;
        }

        case 'panel_modified': {
          appendEvent({ id, kind: 'panel_modified', panelId: parsed.panelId as string | undefined });
          break;
        }

        case 'navigate': {
          const path = (parsed.path as string) ?? '';
          if (path) {
            setPendingNavigation(path);
          }
          break;
        }

        case 'reply': {
          const content = (parsed.content as string) ?? '';
          const aiMsg: ChatMessage = {
            id,
            role: 'assistant',
            content,
            timestamp: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, aiMsg]);
          appendEvent({ id, kind: 'message', message: aiMsg });
          break;
        }

        case 'done': {
          // Check if done carries a navigate directive as well
          const navigateTo = parsed.navigate as string | undefined;
          if (navigateTo) {
            setPendingNavigation(navigateTo);
          }
          appendEvent({ id, kind: 'done', content: 'Generation complete' });
          break;
        }

        case 'error': {
          const content =
            (parsed.message as string) ?? (parsed.content as string) ?? 'An error occurred';
          appendEvent({ id, kind: 'error', content });
          break;
        }

        default:
          break;
      }
    },
    [appendEvent],
  );

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isGenerating) return;

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      appendEvent({ id: userMsg.id, kind: 'message', message: userMsg });
      setIsGenerating(true);

      try {
        await apiClient.postStream(
          '/chat',
          {
            message: content,
            sessionId: sessionIdRef.current,
            ...(pageContextRef.current ? { pageContext: pageContextRef.current } : {}),
          },
          handleSSEEvent,
          abortRef.current.signal,
        );
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          const id = crypto.randomUUID();
          // Provide a friendlier message when the endpoint doesn't exist yet
          const is404 = err.message.includes('404');
          appendEvent({
            id,
            kind: 'error',
            content: is404
              ? 'The /api/chat endpoint is not available yet. The backend team is still working on it.'
              : err.message,
          });
        }
      } finally {
        setIsGenerating(false);
      }
    },
    [isGenerating, handleSSEEvent, appendEvent],
  );

  const setPageContext = useCallback((ctx: PageContext | null) => {
    pageContextRef.current = ctx;
  }, []);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsGenerating(false);
    appendEvent({
      id: crypto.randomUUID(),
      kind: 'message',
      message: {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Stopped.',
        timestamp: new Date().toISOString(),
      },
    });
  }, [appendEvent]);

  const startNewSession = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setEvents([]);
    setIsGenerating(false);
    setPendingNavigation(null);
    const newId = `ses_${crypto.randomUUID()}`;
    setCurrentSessionId(newId);
  }, []);

  const loadSession = useCallback(async (sessionId: string) => {
    // Switch to the requested session
    setCurrentSessionId(sessionId);
    setMessages([]);
    setEvents([]);
    setIsGenerating(false);
    setPendingNavigation(null);

    try {
      const res = await apiClient.get<{ sessionId: string; messages: ChatMessage[] }>(
        `/chat/sessions/${sessionId}/messages`,
      );
      if (res.error || !res.data?.messages) return;

      const loaded = res.data.messages;
      setMessages(loaded);
      // Rebuild events from loaded messages so the UI renders them
      const rebuilt: ChatEvent[] = loaded.map((msg) => ({
        id: msg.id,
        kind: 'message' as const,
        message: msg,
      }));
      setEvents(rebuilt);
    } catch {
      // Backend may not exist yet (Phase 1) — silently ignore 404s and network errors
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return {
    messages,
    events,
    isGenerating,
    sendMessage,
    stopGeneration,
    pendingNavigation,
    clearPendingNavigation,
    setPageContext,
    currentSessionId,
    startNewSession,
    loadSession,
  };
}
