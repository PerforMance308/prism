# Agent Governance Plan

## Goal

This document captures the next architectural step for Prism's agent system:

1. Formalize `AgentDefinition`
2. Introduce an independent `Verifier`
3. Defer heavier `hooks / skills / prompt caching` work until the first two are stable

The intent is to improve safety, determinism, and evolvability without rewriting the existing agent flows.

## Why Now

The current codebase already has strong agentic building blocks:

- orchestration in [packages/agent-core/src/dashboard-agents/orchestrator-agent.ts](/C:/Users/shiqi/Documents/prism/packages/agent-core/src/dashboard-agents/orchestrator-agent.ts)
- staged generation in [packages/agent-core/src/dashboard-agents/dashboard-generator-agent.ts](/C:/Users/shiqi/Documents/prism/packages/agent-core/src/dashboard-agents/dashboard-generator-agent.ts)
- investigation reasoning in [packages/agent-core/src/dashboard-agents/investigation-agent.ts](/C:/Users/shiqi/Documents/prism/packages/agent-core/src/dashboard-agents/investigation-agent.ts)
- guarded execution in [packages/agent-core/src/execution/execution-agent.ts](/C:/Users/shiqi/Documents/prism/packages/agent-core/src/execution/execution-agent.ts)

What is still missing is the governance layer around those agents:

- explicit capability boundaries
- explicit input/output contracts
- explicit permission modes
- a unified definition of "done"

Today, many of those constraints exist only implicitly in code paths and prompts.

## Scope

This plan covers:

- a formal runtime definition object for each agent class
- a central registry of agent capabilities
- a standalone verifier that evaluates agent outputs
- phased integration into existing dashboard, investigation, and alert-rule flows

This plan does not yet cover:

- project-level `.claude/skills`
- local Claude hooks
- prompt caching optimizations
- full background task runtime

## Design Principles

- Keep existing agent flows working while introducing governance incrementally
- Prefer additive runtime contracts over rewriting working domain logic
- Put verification in one place instead of scattering "done" logic across many pipelines
- Make permissions check agent intent and mutation scope, not just user auth
- Standardize shape first, then optimize behavior

## Phase 1: Formalize AgentDefinition

### Outcome

Each agent becomes a formally declared runtime unit rather than an ad hoc class with hidden permissions.

### Proposed Types

Suggested location:

- [packages/agent-core/src/runtime](/C:/Users/shiqi/Documents/prism/packages/agent-core/src/runtime)

Suggested files:

- `agent-definition.ts`
- `agent-registry.ts`
- `agent-types.ts`

Suggested base model:

```ts
export type AgentType =
  | 'intent-router'
  | 'dashboard-builder'
  | 'dashboard-editor'
  | 'investigation-runner'
  | 'alert-rule-builder'
  | 'execution'
  | 'verification'

export type AgentToolName =
  | 'generate_dashboard'
  | 'add_panels'
  | 'investigate'
  | 'create_alert_rule'
  | 'modify_panel'
  | 'remove_panels'
  | 'rearrange'
  | 'add_variable'
  | 'set_title'
  | 'prometheus.query'
  | 'prometheus.labels'
  | 'web.search'
  | 'llm.complete'
  | 'adapter.validate'
  | 'adapter.dryRun'
  | 'adapter.execute'
  | 'verifier.run'

export type ArtifactKind =
  | 'dashboard'
  | 'panel'
  | 'dashboard_variable'
  | 'investigation_report'
  | 'evidence_panel'
  | 'alert_rule'
  | 'execution_plan'
  | 'execution_result'

export type AgentPermissionMode =
  | 'read_only'
  | 'artifact_mutation'
  | 'propose_only'
  | 'approval_required'
  | 'guarded_execution'

export type AgentDefinition = {
  type: AgentType
  description: string
  allowedTools: AgentToolName[]
  inputKinds: ArtifactKind[]
  outputKinds: ArtifactKind[]
  permissionMode: AgentPermissionMode
  maxIterations?: number
  canRunInBackground?: boolean
}
```

### Initial Registry

The first cut should cover the agents already present in the codebase.

#### `intent-router`

- Maps to the orchestration behavior in [packages/agent-core/src/dashboard-agents/orchestrator-agent.ts](/C:/Users/shiqi/Documents/prism/packages/agent-core/src/dashboard-agents/orchestrator-agent.ts)
- Allowed tools:
  - `generate_dashboard`
  - `add_panels`
  - `investigate`
  - `create_alert_rule`
  - `modify_panel`
  - `remove_panels`
  - `rearrange`
  - `add_variable`
  - `set_title`
- Input kinds:
  - `dashboard`
- Output kinds:
  - `dashboard`
  - `investigation_report`
  - `alert_rule`
- Permission mode:
  - `artifact_mutation`

#### `dashboard-builder`

- Maps to [packages/agent-core/src/dashboard-agents/dashboard-generator-agent.ts](/C:/Users/shiqi/Documents/prism/packages/agent-core/src/dashboard-agents/dashboard-generator-agent.ts)
- Allowed tools:
  - `web.search`
  - `prometheus.labels`
  - `prometheus.query`
  - `llm.complete`
- Input kinds:
  - `dashboard`
- Output kinds:
  - `panel`
  - `dashboard_variable`
  - `dashboard`
- Permission mode:
  - `artifact_mutation`

#### `investigation-runner`

- Maps to [packages/agent-core/src/dashboard-agents/investigation-agent.ts](/C:/Users/shiqi/Documents/prism/packages/agent-core/src/dashboard-agents/investigation-agent.ts)
- Allowed tools:
  - `prometheus.labels`
  - `prometheus.query`
  - `llm.complete`
- Input kinds:
  - `dashboard`
- Output kinds:
  - `investigation_report`
  - `evidence_panel`
- Permission mode:
  - `read_only`

#### `alert-rule-builder`

- Maps to the alert-rule generation flow in agent-core/api-gateway
- Allowed tools:
  - `prometheus.labels`
  - `prometheus.query`
  - `llm.complete`
- Input kinds:
  - `dashboard`
  - `alert_rule`
- Output kinds:
  - `alert_rule`
- Permission mode:
  - `approval_required`

#### `execution`

- Maps to [packages/agent-core/src/execution/execution-agent.ts](/C:/Users/shiqi/Documents/prism/packages/agent-core/src/execution/execution-agent.ts)
- Allowed tools:
  - `adapter.validate`
  - `adapter.dryRun`
  - `adapter.execute`
  - `llm.complete`
- Input kinds:
  - `execution_plan`
- Output kinds:
  - `execution_result`
- Permission mode:
  - `guarded_execution`

#### `verification`

- New agent introduced in Phase 2
- Allowed tools:
  - `prometheus.query`
  - `verifier.run`
  - `llm.complete`
- Input kinds:
  - `dashboard`
  - `investigation_report`
  - `alert_rule`
- Output kinds:
  - `execution_result`
- Permission mode:
  - `read_only`

### Integration Approach

Do not refactor the current agents into a new abstraction immediately.

Instead:

1. Add the definition types and registry
2. Attach a definition to each existing agent class
3. Start using definitions for runtime checks and observability

Suggested near-term pattern:

```ts
export class DashboardGeneratorAgent {
  static readonly definition = agentRegistry.get('dashboard-builder')
}
```

### Acceptance Criteria

- Every first-class agent has a registered definition
- Allowed tools and permission mode are declared in one place
- Orchestration code can inspect agent metadata without hardcoding class names
- Existing behavior remains unchanged

## Phase 2: Add an Independent Verifier

### Outcome

Verification becomes a first-class runtime step instead of being partially embedded in generation logic.

### Why This Matters

Current validation exists, but it is fragmented:

- dashboard query validation in [packages/agent-core/src/dashboard-agents/phases/generation-phase.ts](/C:/Users/shiqi/Documents/prism/packages/agent-core/src/dashboard-agents/phases/generation-phase.ts)
- investigation query and analysis quality checks inside [packages/agent-core/src/dashboard-agents/investigation-agent.ts](/C:/Users/shiqi/Documents/prism/packages/agent-core/src/dashboard-agents/investigation-agent.ts)
- execution validation / dry run / audit in [packages/agent-core/src/execution/execution-agent.ts](/C:/Users/shiqi/Documents/prism/packages/agent-core/src/execution/execution-agent.ts)

Those checks are useful, but they do not yet answer one central question:

"Is this artifact acceptable enough to ship or present as done?"

### Proposed Structure

Suggested location:

- [packages/agent-core/src/verification](/C:/Users/shiqi/Documents/prism/packages/agent-core/src/verification)

Suggested files:

- `types.ts`
- `verifier-agent.ts`
- `dashboard-verifier.ts`
- `investigation-verifier.ts`
- `alert-rule-verifier.ts`
- `index.ts`

### Proposed Types

```ts
export type VerificationTargetKind =
  | 'dashboard'
  | 'investigation_report'
  | 'alert_rule'

export type VerificationStatus =
  | 'passed'
  | 'failed'
  | 'warning'

export type VerificationIssue = {
  code: string
  severity: 'error' | 'warning'
  message: string
  artifactKind: VerificationTargetKind
  artifactId?: string
}

export type VerificationReport = {
  status: VerificationStatus
  targetKind: VerificationTargetKind
  summary: string
  issues: VerificationIssue[]
  checksRun: string[]
}
```

### Minimum Verification Rules

#### Dashboard

Checks:

- panel count is non-zero
- each panel has at least one query
- PromQL parses or executes successfully where applicable
- variable references are resolvable
- no obviously duplicated panels
- optional warning for too many dropped panels after validation

Initial data sources:

- existing dashboard object
- optional Prometheus endpoint

#### Investigation Report

Checks:

- report has a non-empty summary
- report has at least one section
- evidence panels, if present, have valid queries
- investigation is not entirely based on failed queries
- explanation is present even when evidence is sparse

#### Alert Rule

Checks:

- title / condition / severity fields are present
- PromQL query is executable
- threshold semantics are coherent
- severity is within allowed enum
- optional policy check for auto-enable behavior

### Verifier Composition

The first implementation should be deterministic-first:

- schema checks
- completeness checks
- query execution checks

LLM-based critique can be added as a secondary pass later for:

- dashboard quality
- investigation explanation quality
- alert wording clarity

### Integration Points

#### Dashboard Flow

Current flow:

- generate
- validate queries
- persist / stream result

Target flow:

- generate
- local validation
- verifier run
- persist only if report is `passed` or acceptable `warning`

#### Investigation Flow

Current flow:

- plan
- execute queries
- analyze evidence
- build report

Target flow:

- build report
- verifier run
- attach verification report to response and store

#### Alert Rule Flow

Current flow:

- generate rule
- maybe validate query

Target flow:

- generate rule
- verifier run
- block publish if failed

### Storage and API Shape

The verifier should produce a structured artifact that can be:

- returned to API clients
- stored alongside generated assets
- shown in UI as pass / warning / fail

Suggested future extension:

- `verificationReport` field on generated artifact responses
- durable verification history per revision

### Acceptance Criteria

- A single verifier entry point can evaluate dashboard, investigation report, or alert rule
- Each artifact type has deterministic checks
- Failure/warning state is structured, not stringly typed
- Generation flows can call verifier without duplicating logic

## Phase 3: Runtime Enforcement

This phase starts using `AgentDefinition` and `Verifier` as runtime policy, not just metadata.

### Goals

- prevent agents from using tools outside their declared scope
- gate artifact mutation based on permission mode
- emit consistent runtime events

### Suggested Runtime Checks

- if agent attempts undeclared tool use, fail closed
- if permission mode is `read_only`, reject mutations
- if permission mode is `approval_required`, emit pending state rather than applying changes
- if verifier returns `failed`, prevent "done" state

### Suggested Event Model

Suggested future event names:

- `agent.started`
- `agent.tool_called`
- `agent.tool_completed`
- `agent.artifact_proposed`
- `agent.artifact_verified`
- `agent.completed`
- `agent.failed`

This can evolve from the current `sendEvent(...)` model already used by dashboard orchestration.

## Why Hooks / Skills / Prompt Caching Come Later

These are valuable, but they should not come first.

### Hooks

Hooks are strongest when:

- mutation boundaries are already explicit
- verification checks are already formal

Otherwise hooks become ad hoc patches around unclear system behavior.

### Skills

Skills are strongest when:

- common workflows are stable
- tool boundaries are explicit
- verifier rules already define what "good output" means

Otherwise skills become large prompt files without system guarantees.

### Prompt Caching

Prompt caching work matters after:

- prompt layout is more stable
- tool definitions stop changing frequently
- runtime boundaries are formalized

Right now correctness and governance will return more value than prompt-cost optimization.

## Recommended Delivery Order

### Milestone 1

- add `AgentType`, `ArtifactKind`, `AgentPermissionMode`
- add `AgentDefinition`
- add `agent-registry`
- register existing first-class agents

### Milestone 2

- add verification types
- implement `DashboardVerifier`
- wire dashboard generation through verifier

### Milestone 3

- implement `InvestigationVerifier`
- implement `AlertRuleVerifier`
- return structured verification reports from API flows

### Milestone 4

- enforce declared tool boundaries
- enforce permission modes
- normalize runtime progress events

## Open Questions

- Should `verification` live in `agent-core` or a new `application` layer?
- Should failed verification block persistence, or allow draft persistence with warning?
- Should alert rules be verified before draft creation, before publish, or both?
- Should execution verifier be the same system as artifact verifier, or a sibling system?

## Recommendation

Start inside `packages/agent-core`.

That keeps the first implementation close to existing agent code and avoids introducing a new package too early. Once `AgentDefinition` and `Verifier` are stable, we can decide whether runtime orchestration should move into a dedicated `packages/application` or `packages/agent-runtime`.
