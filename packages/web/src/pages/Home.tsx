import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { apiClient } from '../api/client.js';
import { fadeIn } from '../animations.js';
import ConfirmDialog from '../components/ConfirmDialog.js';
import { relativeTime } from '../utils/time.js';
import { useGlobalChat } from '../contexts/ChatContext.js';
import { groupEvents } from '../components/chat/event-processing.js';
import type { Block } from '../components/chat/event-processing.js';
import { UserMessage, AssistantMessage, ErrorMessage } from '../components/chat/MessageComponents.js';
import AgentActivityBlock from '../components/chat/AgentActivityBlock.js';
import { OpenObsLogo } from '../components/OpenObsLogo.js';

// Types

interface Dashboard {
  id: string;
  title: string;
  panels: unknown[];
  status: 'generating' | 'ready' | 'error';
  createdAt: string;
  updatedAt?: string;
}

interface FeedPage {
  total: number;
  items: unknown[];
}

// Quick action cards

const QUICK_ACTIONS = [
  {
    category: 'Performance',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    colorClass: 'text-primary',
    prompt: 'Analyze CPU spike in checkout-service',
    label: '"Analyze CPU spike in checkout-service"',
  },
  {
    category: 'Dashboards',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18M7 16l4-4 4 4 4-4" />
      </svg>
    ),
    colorClass: 'text-tertiary',
    prompt: 'Create a dashboard for user login latency',
    label: '"Create a dashboard for user login latency"',
  },
  {
    category: 'Incident',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
    ),
    colorClass: 'text-error',
    prompt: 'Explain the recent 5xx error surge',
    label: '"Explain the recent 5xx error surge"',
  },
];

// Main

export default function Home() {
  const navigate = useNavigate();
  const globalChat = useGlobalChat();
  const { events, isGenerating, sendMessage, stopGeneration } = globalChat;

  const [input, setInput] = useState('');
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [alertCount, setAlertCount] = useState<number | null>(null);
  const [deletingDashId, setDeletingDashId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const hasMessages = events.length > 0;

  const blocks = useMemo(() => groupEvents(events), [events]);
  const lastAgentBlockId = useMemo(() => {
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      if (blocks[i]!.type === 'agent') return (blocks[i] as Extract<Block, { type: 'agent' }>).id;
    }
    return null;
  }, [blocks]);

  const handleDeleteDashboard = useCallback(async (id: string) => {
    const res = await apiClient.delete(`/dashboards/${id}`);
    if (!res.error) {
      setDashboards((prev) => prev.filter((d) => d.id !== id));
    }
  }, []);

  useEffect(() => {
    void apiClient.get<Dashboard[]>(`/dashboards?limit=6`).then((res) => {
      if (!res.error && Array.isArray(res.data)) setDashboards(res.data.slice(0, 6));
    });
  }, []);

  useEffect(() => {
    void apiClient.get<FeedPage>(`/feed?limit=1`).then((res) => {
      if (!res.error) setAlertCount(res.data.total);
    });
  }, []);

  // Auto-scroll on new events
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isGenerating) return;
    void sendMessage(trimmed);
    setInput('');
  }, [input, isGenerating, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickAction = (actionPrompt: string) => {
    void sendMessage(actionPrompt);
  };

  return (
    <div className="h-full bg-surface-container flex flex-col">
      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 w-full">
          {/* When no messages: centered hero + quick actions + recent */}
          {!hasMessages && (
            <div className="flex flex-col items-center pt-[15vh]">
              {/* Logo & headline */}
              <motion.div
                className="mb-12 text-center"
                variants={fadeIn}
                initial="hidden"
                animate="visible"
              >
                <div className="flex items-center justify-center gap-3 mb-6">
                  <OpenObsLogo className="w-10 h-10 text-tertiary" size={40} />
                  <span className="text-2xl font-bold text-tertiary tracking-tight">OpenObs</span>
                </div>
                <h1 className="font-[Manrope] text-4xl font-extrabold tracking-tight text-white mb-4 leading-tight">
                  What are we{' '}
                  <span className="text-primary italic">investigating</span> today?
                </h1>
                <p className="text-on-surface-variant text-lg">
                  Ask me to build dashboards, investigate issues, or create alerts.
                </p>
              </motion.div>
            </div>
          )}

          {/* Chat messages area */}
          {hasMessages && (
            <div className="pt-6 pb-4">
              {blocks.map((block) => {
                if (block.type === 'message') {
                  const evt = block.event;
                  if (evt.kind === 'error') {
                    return <ErrorMessage key={evt.id} content={evt.content ?? 'An error occurred'} />;
                  }
                  if (evt.message?.role === 'user') {
                    return <UserMessage key={evt.id} content={evt.message.content} />;
                  }
                  if (evt.message?.role === 'assistant') {
                    return <AssistantMessage key={evt.id} content={evt.message.content} />;
                  }
                  return null;
                }

                if (block.type === 'agent') {
                  return (
                    <AgentActivityBlock
                      key={block.id}
                      events={block.events}
                      isLive={isGenerating && block.id === lastAgentBlockId}
                    />
                  );
                }

                return null;
              })}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </div>

      {/* Bottom input + optional sections */}
      <div className="shrink-0 pb-6">
        <div className="max-w-3xl mx-auto px-6 w-full">
          {/* Input area */}
          <div className="relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything..."
              rows={1}
              disabled={isGenerating}
              className="w-full bg-surface-bright ring-1 ring-white/5 focus:ring-tertiary/50 rounded-xl py-4 pl-5 pr-14 text-sm text-on-surface placeholder-on-surface-variant outline-none resize-none transition-all disabled:opacity-50"
              style={{ minHeight: '52px', maxHeight: '120px' }}
              onInput={(e) => {
                const el = e.target as HTMLTextAreaElement;
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
              }}
            />
            {isGenerating && (
              <button
                type="button"
                onClick={stopGeneration}
                className="absolute right-12 bottom-3 w-8 h-8 rounded-lg bg-surface-highest hover:bg-error/20 text-on-surface-variant hover:text-error flex items-center justify-center transition-colors"
                title="Stop"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <rect x="5" y="5" width="10" height="10" rx="1" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim()}
              className="absolute right-3 bottom-3 w-8 h-8 bg-tertiary rounded-lg flex items-center justify-center text-white shadow-lg shadow-tertiary/20 hover:scale-105 active:scale-95 transition-all disabled:opacity-30"
              title="Send"
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M14.707 10.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L12.586 11H3a1 1 0 110-2h9.586l-3.293-3.293a1 1 0 011.414-1.414l4 4z" clipRule="evenodd" transform="rotate(-90 10 10)" />
              </svg>
            </button>
          </div>

          {!isGenerating && !hasMessages && (
            <p className="mt-2 text-[10px] text-center text-on-surface-variant/50">
              Press <kbd className="px-1.5 py-0.5 bg-surface-highest rounded text-on-surface-variant">Enter</kbd> to send
            </p>
          )}

          {/* Quick actions — only when no messages */}
          {!hasMessages && (
            <motion.div
              className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4 w-full"
              variants={fadeIn}
              initial="hidden"
              animate="visible"
              transition={{ delay: 0.1 }}
            >
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.category}
                  type="button"
                  onClick={() => handleQuickAction(action.prompt)}
                  className="p-5 bg-surface-low hover:bg-surface-high rounded-2xl text-left transition-all duration-200 group"
                >
                  <div className={`flex items-center gap-2 ${action.colorClass} mb-2`}>
                    {action.icon}
                    <span className="text-[10px] font-bold uppercase tracking-widest">
                      {action.category}
                    </span>
                  </div>
                  <p className="text-on-surface-variant text-sm leading-relaxed group-hover:text-white transition-colors">
                    {action.label}
                  </p>
                </button>
              ))}
            </motion.div>
          )}

          {/* Recent dashboards — only when no messages */}
          {!hasMessages && dashboards.length > 0 && (
            <motion.section
              className="mt-8 w-full"
              variants={fadeIn}
              initial="hidden"
              animate="visible"
              transition={{ delay: 0.15 }}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  Recent
                </h2>
                <Link
                  to="/dashboards"
                  className="text-xs text-primary hover:text-primary-container transition-colors"
                >
                  View all
                </Link>
              </div>

              <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
                {dashboards.map((dash) => (
                  <div key={dash.id} className="shrink-0 w-48 relative group/home-card">
                    <button
                      type="button"
                      onClick={() => navigate(`/dashboards/${dash.id}`)}
                      className="w-full text-left bg-surface-low hover:bg-surface-high rounded-xl p-3.5 cursor-pointer transition-all duration-200"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            dash.status === 'generating'
                              ? 'bg-amber-400 animate-pulse'
                              : dash.status === 'error'
                                ? 'bg-error'
                                : 'bg-emerald-500'
                          }`}
                        />
                        <span className="text-[10px] text-on-surface-variant/60">
                          {relativeTime(dash.updatedAt ?? dash.createdAt)}
                        </span>
                      </div>
                      <div className="text-sm font-medium text-on-surface line-clamp-2 mb-1.5">
                        {dash.title}
                      </div>
                      <div className="text-xs text-on-surface-variant/60">
                        {dash.panels.length} panel{dash.panels.length === 1 ? '' : 's'}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDeletingDashId(dash.id)}
                      className="absolute top-2 right-2 p-1.5 rounded-lg bg-surface/90 text-on-surface-variant hover:text-error opacity-0 group-hover/home-card:opacity-100 transition-all"
                      title="Delete"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                        <path
                          fillRule="evenodd"
                          d="M8.5 2a1 1 0 00-1 1V4H5a1 1 0 000 2h.293l.853 9.386A2 2 0 008.138 17h3.724a2 2 0 001.992-1.614L14.707 6H15a1 1 0 100-2h-2.5V3a1 1 0 00-1-1h-3zM9.5 4h1V3h-1v1z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </motion.section>
          )}

          {/* Alert status bar — only when no messages */}
          {!hasMessages && (
            <motion.div
              className="mt-6 w-full"
              variants={fadeIn}
              initial="hidden"
              animate="visible"
              transition={{ delay: 0.2 }}
            >
              <div className="flex items-center justify-between bg-surface-low rounded-xl px-5 py-3">
                <div className="flex items-center gap-3">
                  {alertCount !== null && alertCount > 0 ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-error animate-pulse" />
                      <span className="text-sm font-semibold text-on-surface">
                        {alertCount} anomaly{alertCount === 1 ? '' : 'ies'} detected
                      </span>
                    </>
                  ) : alertCount === 0 ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span className="text-sm text-on-surface-variant">No active anomalies</span>
                    </>
                  ) : (
                    <span className="text-sm text-on-surface-variant/60">Loading alerts...</span>
                  )}
                </div>
                <Link
                  to="/feed"
                  className="text-sm text-primary hover:text-primary-container transition-colors font-medium"
                >
                  View Feed
                </Link>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deletingDashId !== null}
        title="Delete dashboard?"
        message="This dashboard and all its panels will be permanently deleted."
        onConfirm={() => {
          if (deletingDashId) void handleDeleteDashboard(deletingDashId);
          setDeletingDashId(null);
        }}
        onCancel={() => setDeletingDashId(null)}
      />
    </div>
  );
}
