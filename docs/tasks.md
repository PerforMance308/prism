# Adapter Abstraction Tasks

## Problem

agent-core has 12 direct `fetch()` calls to external services instead of using adapter abstractions.
This means switching datasources (Prometheus → VictoriaMetrics → Thanos) or search providers
requires changing agent code instead of just swapping adapters.

LLM calls are properly abstracted through `LLMGateway` — only metrics and web search need fixing.

## Task 1: Create IMetricsAdapter interface and implement for Prometheus

**Goal:** Replace all 11 direct Prometheus `fetch()` calls with a generic `IMetricsAdapter` interface.

**Create:** `packages/agent-core/src/adapters/metrics-adapter.ts`

```typescript
export interface MetricSample {
  labels: Record<string, string>;
  value: number;
  timestamp: number;
}

export interface IMetricsAdapter {
  /** List all metric names */
  listMetricNames(): Promise<string[]>;
  /** List label names for a metric */
  listLabels(metric: string): Promise<string[]>;
  /** List label values for a specific label */
  listLabelValues(label: string): Promise<string[]>;
  /** Find series matching patterns (server-side filtering) */
  findSeries(matchers: string[]): Promise<string[]>;
  /** Execute an instant query */
  instantQuery(expr: string): Promise<MetricSample[]>;
  /** Execute a range query */
  rangeQuery(expr: string, start: Date, end: Date, step: string): Promise<{ metric: Record<string,string>; values: [number,string][] }[]>;
  /** Test if a query is valid (without returning full data) */
  testQuery(expr: string): Promise<{ ok: boolean; error?: string }>;
  /** Health check */
  isHealthy(): Promise<boolean>;
}
```

**Create:** `packages/adapters/src/prometheus/metrics-adapter.ts`
- Implement `IMetricsAdapter` using existing `PrometheusHttpClient`
- Wrap all Prometheus API specifics here

**Update these 7 files** to inject `IMetricsAdapter` instead of `prometheusUrl + fetch()`:
1. `dashboard-agents/discovery-agent.ts` (4 fetch calls)
2. `dashboard-agents/investigation-agent.ts` (2 fetch calls)
3. `dashboard-agents/alert-rule-agent.ts` (2 fetch calls)
4. `dashboard-agents/panel-validator.ts` (1 fetch call)
5. `dashboard-agents/phases/generation-phase.ts` (1 fetch call)
6. `verification/prometheus-tester.ts` (1 fetch call)
7. All orchestrator/service code that constructs these agents — pass adapter instead of URL+headers

## Task 2: Create IWebSearchAdapter and implement for DuckDuckGo

**Goal:** Replace the direct DuckDuckGo `fetch()` in research-agent.ts with an adapter.

**Create:** `packages/agent-core/src/adapters/web-search-adapter.ts`

```typescript
export interface WebSearchResult {
  title?: string;
  snippet: string;
  url?: string;
}

export interface IWebSearchAdapter {
  search(query: string, maxResults?: number): Promise<WebSearchResult[]>;
}
```

**Create:** `packages/adapters/src/web-search/duckduckgo-adapter.ts`
- Move the DuckDuckGo HTML scraping logic from research-agent.ts here

**Update:**
- `dashboard-agents/research-agent.ts` — inject `IWebSearchAdapter` instead of doing `fetch(duckduckgo...)`

## Task 3: Wire adapters through dependency injection

**Goal:** Orchestrator and services create adapters once and inject them.

**Update:** `packages/api-gateway/src/services/dashboard-service.ts`
- Create `IMetricsAdapter` from datasource config
- Create `IWebSearchAdapter`
- Pass to orchestrator → agents

**Update:** `packages/agent-core/src/dashboard-agents/orchestrator-agent.ts`
- `OrchestratorDeps`: replace `prometheusUrl + prometheusHeaders` with `metricsAdapter?: IMetricsAdapter`
- Pass adapter down to sub-agents

**Update all agent constructors:**
- Replace `prometheusUrl: string, headers: Record<string,string>` with `metrics?: IMetricsAdapter`

## Task 4: Remove all direct fetch() from agent-core

**Verify:** After tasks 1-3, agent-core should have ZERO direct `fetch()` calls.
All external I/O goes through:
- `LLMGateway` for LLM calls ✅ (already done)
- `IMetricsAdapter` for metrics/queries
- `IWebSearchAdapter` for web search
