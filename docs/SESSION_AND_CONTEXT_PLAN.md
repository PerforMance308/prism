# Session, Context Management & UX Redesign — Implementation Plan

## Overview

Transform the app from "agent tied to a dashboard" to "session-based agent that creates artifacts and manages context across turns". The UX follows the Stitch/Claude pattern: full-screen chat on Home, then workspace view with sidebar chat after artifact creation.

---

## Phase 1: Session Model

**Goal**: Every conversation is a session. Artifacts (dashboards, investigations, alerts) link back to their session.

### Tasks

#### 1.1 Database schema — add session table and sessionId to artifacts
- **File**: `packages/data-layer/src/db/sqlite-schema.ts`
- Create `chat_sessions` table:
  ```sql
  chat_sessions (
    id TEXT PRIMARY KEY,
    title TEXT,              -- auto-generated or user-set
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
  ```
- Create `chat_messages` table (independent of dashboards):
  ```sql
  chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id),
    role TEXT NOT NULL,       -- 'user' | 'assistant' | 'system'
    content TEXT NOT NULL,
    actions TEXT (json),
    timestamp TEXT NOT NULL
  )
  ```
- Add `session_id TEXT` column to `dashboards` table
- Add `session_id TEXT` column to `investigations` table
- Add `session_id TEXT` column to `alert_rules` table

#### 1.2 Repository interfaces and implementations
- **File**: `packages/data-layer/src/repository/interfaces.ts`
- Add `IChatSessionRepository`:
  ```typescript
  interface IChatSessionRepository {
    create(session: { id: string; title?: string }): MaybeAsync<ChatSession>;
    findById(id: string): MaybeAsync<ChatSession | undefined>;
    findAll(limit?: number): MaybeAsync<ChatSession[]>;
    delete(id: string): MaybeAsync<boolean>;
  }
  ```
- Add `IChatMessageRepository`:
  ```typescript
  interface IChatMessageRepository {
    addMessage(sessionId: string, message: ChatMessage): MaybeAsync<void>;
    getMessages(sessionId: string, limit?: number): MaybeAsync<ChatMessage[]>;
    getMessageCount(sessionId: string): MaybeAsync<number>;
    deleteBySession(sessionId: string): MaybeAsync<void>;
  }
  ```
- Implement SQLite versions in `packages/data-layer/src/repository/sqlite/`

#### 1.3 Agent stores artifacts with sessionId
- **File**: `packages/agent-core/src/agent/orchestrator-action-handlers.ts`
- `handleDashboardCreate` — store `sessionId` on the created dashboard
- `handleInvestigationCreate` — store `sessionId` on the created investigation
- `handleCreateAlertRule` — store `sessionId` on the created alert rule
- Pass `sessionId` from OrchestratorAgent into ActionContext

#### 1.4 API endpoints for sessions
- **File**: `packages/api-gateway/src/routes/chat.ts`
- `GET /chat/sessions` — list recent sessions
- `GET /chat/sessions/:id` — get session with linked artifacts
- `DELETE /chat/sessions/:id` — delete session and messages
- Update `POST /chat` to create session if new, use `chat_messages` table instead of `dashboard_messages`

#### 1.5 API: load session for artifact
- `GET /dashboards/:id` response should include `sessionId`
- `GET /investigations/:id` response should include `sessionId`
- Frontend can then load the session's chat history

---

## Phase 2: Home Page Full-Screen Chat

**Goal**: Home page is a Claude-style full-screen chat interface. After agent creates an artifact, auto-navigate to the workspace.

### Tasks

#### 2.1 Home page redesign
- **File**: `packages/web/src/pages/Home.tsx`
- Replace current welcome page with full-screen chat layout:
  ```
  ┌──────────────────────────────────────────────┐
  │         OpenObs — What are you working on?    │
  │                                                │
  │  [Message history area — scrollable]           │
  │                                                │
  │  User: Create a kubernetes dashboard           │
  │  Agent: [tool calls, thinking...]              │
  │  Agent: Created dashboard with 8 panels.       │
  │                                                │
  │  ┌──────────────────────────────────────────┐  │
  │  │ Ask anything...                    [Send] │  │
  │  └──────────────────────────────────────────┘  │
  │                                                │
  │  Quick actions: [K8s Dashboard] [Investigate]  │
  └──────────────────────────────────────────────┘
  ```
- Quick action cards below input (only shown when no messages yet)
- Recent sessions list below quick actions

#### 2.2 Hide global ChatPanel on Home page
- **File**: `packages/web/src/components/Layout.tsx`
- When route is `/` (Home), don't render ChatPanel on the right
- Home has its own full-screen chat that uses the same `useChat` hook
- Detect route via `useLocation()` and conditionally render

#### 2.3 Session continuity
- When user starts a new conversation on Home → new sessionId
- When user navigates to a workspace (dashboard/investigation) → ChatPanel shows same session
- When user opens an existing dashboard → ChatPanel loads that dashboard's sessionId
- **File**: `packages/web/src/hooks/useChat.ts`
  - Add `loadSession(sessionId: string)` — fetch history from `GET /chat/sessions/:id/messages`
  - Add `startNewSession()` — clear state, generate new sessionId

---

## Phase 3: Context Compaction

**Goal**: Keep conversation context within token budget by summarizing old messages. Based on Claude Code's compaction system.

### Tasks

#### 3.1 Token estimation utility
- **File**: `packages/agent-core/src/agent/token-utils.ts` (new)
- `estimateTokens(text: string): number` — rough estimate: `Math.ceil(text.length / 4)`
- `estimateMessagesTokens(messages: CompletionMessage[]): number` — sum of all message content tokens
- Constants:
  ```typescript
  const CONTEXT_WINDOW = 128_000        // conservative default
  const COMPACTION_THRESHOLD = 100_000  // trigger compaction at 78% of window
  const COMPACTION_BUFFER = 20_000      // keep this much headroom after compaction
  const KEEP_RECENT_MESSAGES = 10       // always keep last N messages in full
  ```

#### 3.2 Compaction service
- **File**: `packages/agent-core/src/agent/context-compaction.ts` (new)
- `shouldCompact(systemPrompt, messages, observations): boolean`
  - Estimate total tokens
  - Return true if > COMPACTION_THRESHOLD
- `compactContext(gateway, model, messages, observations): CompactedContext`
  - Separate messages into: old (to summarize) + recent (to keep)
  - Send old messages to LLM with summarization prompt:
    ```
    Summarize the following conversation history. Preserve:
    1. What the user asked for and what was accomplished
    2. IDs of any created artifacts (dashboardId, investigationId)
    3. Key metric names and query patterns discovered
    4. Current state of the work (what's done, what's pending)
    Keep the summary concise but don't lose critical details like IDs and metric names.
    ```
  - Return: `{ summary: string, recentMessages: Message[] }`
- `CompactedContext` stored in session for reuse across turns

#### 3.3 Integrate compaction into ReActLoop
- **File**: `packages/agent-core/src/agent/react-loop.ts`
- In `buildMessages()`:
  1. Start with system prompt + user message + observations
  2. If `estimateMessagesTokens(all) > COMPACTION_THRESHOLD`:
     - Compact older observations into a summary observation
     - Keep recent observations in full
  3. Prepend conversation history summary (from session) if available
- Add `conversationSummary?: string` to ReActDeps — injected from session

#### 3.4 Persist compaction state
- In chat-service, after each agent turn:
  - Check if context was compacted
  - If so, store the summary in the session (new field: `context_summary TEXT` on `chat_sessions`)
  - Next turn, load summary and inject as first message

#### 3.5 Token budget awareness
- **File**: `packages/agent-core/src/agent/orchestrator-prompt.ts`
- Add to System section:
  ```
  The system will automatically compress prior conversation history when approaching
  context limits. Important information (artifact IDs, metric names, user goals) is
  preserved in the summary. You may see a [Conversation Summary] block — treat it
  as authoritative context for what happened before.
  ```

---

## Phase 4: Session History in Workspace

**Goal**: When opening an existing dashboard/investigation, the ChatPanel shows the session that created it.

### Tasks

#### 4.1 Frontend: Load session on artifact open
- **File**: `packages/web/src/pages/DashboardWorkspace.tsx`
- On mount: read `dashboard.sessionId` from API response
- Call `globalChat.loadSession(dashboard.sessionId)` to populate chat history
- **File**: `packages/web/src/pages/InvestigationDetail.tsx`
- Same pattern: load investigation's sessionId, populate chat

#### 4.2 Frontend: Session switcher
- When navigating between artifacts with different sessionIds, chat switches context
- When navigating to Home, start fresh or show session list
- **File**: `packages/web/src/hooks/useChat.ts`
  - Track `currentSessionId`
  - `loadSession(id)` fetches messages from API, replaces current chat state
  - `startNewSession()` clears chat, generates new ID

#### 4.3 Session title auto-generation
- After the first assistant response in a new session, use LLM to generate a short title
- Store in `chat_sessions.title`
- Display in session list on Home page and in ChatPanel header

#### 4.4 Session list on Home page
- Show recent sessions below the chat input (when no active conversation)
- Each session card shows: title, timestamp, linked artifacts (dashboard/investigation icons)
- Click to load that session's chat

---

## Phase 5: Polish & Edge Cases

### Tasks

#### 5.1 Handle session conflicts
- User opens Dashboard A (session 1), then navigates to Dashboard B (session 2)
- ChatPanel should switch to session 2's history
- If user types in ChatPanel while on Dashboard B, message goes to session 2

#### 5.2 Orphan sessions
- Sessions with no linked artifacts (user asked a question, got a reply, no artifact created)
- These should still be listed in session history
- Auto-cleanup: delete sessions older than 30 days with no artifacts

#### 5.3 Cross-session references
- User in session 2 says "update the dashboard I created earlier" — agent won't know about session 1's dashboard
- Solution: include linked artifact IDs in the session context summary
- When loading session, also include a brief list of all user's dashboards/investigations

#### 5.4 Compaction edge cases
- Very long investigation (30+ steps) — ensure compaction preserves investigation state
- Multiple artifacts in one session — ensure all IDs survive compaction
- Agent should never say "I don't have context" after compaction — the summary should be good enough

---

## Execution Order

```
Phase 1 (Session Model)     → 1.1, 1.2, 1.3, 1.4, 1.5  (backend first)
Phase 2 (Home Full Chat)    → 2.1, 2.2, 2.3             (frontend, parallel with Phase 1)
Phase 3 (Context Compaction) → 3.1, 3.2, 3.3, 3.4, 3.5  (after Phase 1)
Phase 4 (Session in Workspace) → 4.1, 4.2, 4.3, 4.4     (after Phase 1 + 2)
Phase 5 (Polish)            → 5.1, 5.2, 5.3, 5.4        (after all above)
```

Parallelization:
- Phase 1 (backend) and Phase 2 (frontend) can run in parallel
- Phase 3 depends on Phase 1 (needs session store)
- Phase 4 depends on Phase 1 + 2

---

## Key Design Decisions

1. **Session ≠ Dashboard**: A session can create multiple artifacts. An artifact links back to exactly one session.
2. **Compaction is LLM-based**: Not just truncation — use LLM to summarize while preserving critical IDs and context.
3. **Chat history is per-session, not per-artifact**: Opening an artifact loads its session's full chat history.
4. **Home = Chat, Workspace = Chat + Artifact**: Same chat, different layout.
5. **Compaction threshold**: ~78% of context window to leave room for system prompt + new messages.
