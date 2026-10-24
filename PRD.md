# PRD: X, Declarative Execution Protocol for AI Agents

**Version:** 0.2
**Date:** October 24, 2026
**Status:** Proposed. Validation before implementation.
**Working name:** X
**Category:** Agent infrastructure / Tool orchestration

## Changelog from 0.1

- Added a feature admission rule to limit language growth (Section 8.0).
- Narrowed postconditions to tools that declare a verification operation (FR-6, Section 8).
- Defined what X must enforce that a hardened sandbox cannot, and made those the primary differentiation tests (Section 10.3).
- Replaced fixed improvement gates with variance-aware decision rules (Section 10.5).
- Added models as a benchmark dimension, with at least two model families.
- Set a target for interpreter overhead.
- Added phase durations and staffing assumptions as estimates.
- Specified when plans should be handed back to the model.

## 1. Executive Summary

AI agents frequently invoke tools through protocols such as MCP (Model Context Protocol). Multi-step tasks can require repeated model calls, large tool definitions in context, and intermediate tool results passed back to the model even when those results need no additional reasoning.

X explores a different execution model. The agent describes a bounded, declarative execution plan, and a lightweight runtime executes it against existing tools. The runtime handles deterministic orchestration, validates inputs and permissions before any side effect occurs, keeps intermediate results out of model context when possible, and returns a compact execution receipt.

X is not intended to replace MCP. MCP remains the tool connectivity and invocation mechanism. X operates above it as an optional execution layer.

The initial objective is to determine whether X provides a measurable advantage over native MCP orchestration and over code-execution approaches such as Code Mode, when both are given comparable safety controls.

**Core hypothesis:** For a defined class of multi-step tasks, a declarative execution plan reduces model-call overhead and intermediate context consumption, while matching task correctness and providing stronger pre-execution validation and structured evidence than an equivalently hardened code-execution baseline.

This hypothesis is unproven and is the primary subject of the MVP.

## 2. Problem Statement

Consider an agent investigating a deployment failure. It needs to:

1. List the application's deployments.
2. Fetch the failing deployment's details.
3. Retrieve recent logs.
4. Identify the relevant error.
5. Return a diagnosis with evidence.

With conventional tool orchestration, the model may need to receive each result and issue the next call. The exact number of calls depends on the agent, tool interface, and task. This introduces four potential inefficiencies:

- **Model round trips:** Deterministic transitions between tools may require another reasoning cycle that adds no judgment.
- **Context consumption:** Tool definitions and intermediate outputs occupy model input and output tokens.
- **Execution inconsistency:** Retries, timeouts, partial failures, and permissions are handled differently by each agent implementation.
- **Limited execution evidence:** A final answer may not provide a standardized, machine-verifiable record of the operations performed.

Not every task suffers from these problems. Tasks requiring judgment after each result should return control to the model. X optimizes deterministic execution within agent-directed workflows. It does not remove reasoning where reasoning is needed.

## 3. Product Vision

Provide a portable, declarative contract for executing bounded multi-tool workflows through existing tool infrastructure.

An agent should be able to express:

- Which operations to perform.
- Which operations depend on other operations.
- What data passes between operations.
- Which capabilities the execution requires.
- What resource limits and failure policies apply.
- What outputs and evidence are required.

The runtime determines whether the plan is valid and authorized, executes it under defined semantics, and returns a structured receipt. The authoring format may be YAML or JSON. The execution contract is independent of the authoring syntax.

## 4. Target Users

### Primary: Agent infrastructure engineers

Engineers building agents that interact with multiple APIs, MCP servers, infrastructure systems, or internal tools.

Their needs:
- Reduce model-call and context overhead.
- Reuse workflows across agent implementations.
- Bound tool execution and enforce permissions.
- Inspect and reproduce failures.

### Secondary: Platform and security engineers

Teams that need predictable tool execution, authorization boundaries, audit records, and consistent failure handling.

### Not initially targeted

- End users looking for a visual no-code workflow builder.
- Teams requiring a full distributed workflow orchestration platform.
- Arbitrary application programming through a new general-purpose language.
- Organizations needing long-running, durable workflows with complex scheduling or human approval processes.

## 5. Product Goals

- **G1. Reduce orchestration overhead.** Execute deterministic multi-step tool workflows without a model round trip between every operation.
- **G2. Preserve task correctness.** Match or exceed the outcomes of direct tool orchestration.
- **G3. Enforce execution boundaries.** Validate plans, constrain tool access, apply runtime limits, and distinguish requested permissions from granted ones.
- **G4. Produce standardized execution evidence.** Return a receipt describing the plan, executed steps, outcomes, failures, and relevant evidence.
- **G5. Minimize deployment complexity.** Begin as an embeddable library and reference interpreter, not a mandatory standalone service.
- **G6. Remain interoperable.** Support existing tools through adapters rather than requiring migration of MCP servers or APIs.

## 6. Non-Goals

The MVP will not:

- Replace MCP, HTTP APIs, or existing tool servers.
- Introduce a general-purpose programming language.
- Support loops, arbitrary code execution, recursion, or user-defined functions.
- Build a durable workflow engine for multi-day jobs.
- Guarantee that a tool's reported result reflects real-world truth.
- Retry side-effecting operations automatically.
- Provide a policy administration UI.
- Establish a public protocol standard before the execution model is validated.

## 7. Core User Experience

The agent authors a plan in a declarative format. Illustrative example:

```yaml
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan

metadata:
  name: investigate-deployment

spec:
  limits:
    maxSteps: 5
    timeoutMs: 15000
    maxResultBytes: 12000

  permissions:
    - deployments.read
    - logs.read

  steps:
    - id: deployment
      tool: kubernetes.get_deployment
      arguments:
        namespace: production
        name: payments-api

    - id: logs
      tool: kubernetes.get_logs
      dependsOn:
        - deployment
      arguments:
        namespace: production
        deployment:
          from: deployment
          path: name
        tailLines: 100

  output:
    include:
      - deployment
      - logs
```

This is illustrative syntax. Tool identifiers, reference semantics, and permission names require formal definitions before implementation.

### Execution lifecycle

1. **Parse:** Read the plan.
2. **Validate:** Check schema, tool signatures, dependencies, references, and limits. No side effect occurs in this phase.
3. **Authorize:** Resolve requested capabilities against trusted runtime policy and caller identity.
4. **Execute:** Run eligible steps under the defined dependency and failure semantics.
5. **Process:** Filter, select, or truncate results according to the plan's output specification.
6. **Verify:** Evaluate postconditions where the tool declares a verification operation.
7. **Return:** Produce the requested output and the execution receipt.

The runtime never treats a plan's self-declared permissions as authorization. Authorization comes from trusted runtime policy.

## 8. Functional Requirements

### 8.0 Feature admission rule

To prevent language drift (Risk R2), no feature enters the interpreter unless all three conditions hold:

1. A benchmark task in the Phase 0 corpus requires it.
2. At least one baseline (native MCP or the hardened Code Mode baseline) fails that task or costs materially more without it.
3. It does not introduce a new expression form beyond the core: no variables beyond step outputs, no loops, no user-defined functions, and no conditionals in v1.

Proposals that fail any condition are logged in a deferred-features list with the benchmark evidence that would justify reconsidering them. Changes to the admission rule itself require a PRD revision.

### FR-1: Plan schema

- Every plan declares a supported API version and kind.
- Unknown fields and unsupported versions produce explicit validation errors.
- Steps have stable identifiers.
- Schema changes are versioned and covered by compatibility tests.

### FR-2: Tool capability resolution

- Each step resolves to a registered tool.
- Arguments are validated against the tool's declared input schema before execution.
- Unknown tools and incompatible argument types are rejected.
- Tool capabilities are discoverable without placing every full tool definition in the model's prompt.
- The underlying tool's identity and source are preserved in the receipt.

### FR-3: Dependency execution

- Steps form a directed acyclic graph (DAG).
- Independent steps may run concurrently, subject to policy and runtime limits.
- References to previous results are typed and validated at plan time.
- Cycles, missing dependencies, and invalid references are rejected during validation.
- Behavior is defined for failed, skipped, timed-out, and cancelled steps. Downstream steps of a failed step are marked skipped, never executed with partial inputs.

### FR-4: Result handling

- Outputs are selected explicitly by the plan.
- Deterministic field extraction is supported for structured results. Arbitrary transformation is not.
- Size limits apply to intermediate and final results.
- Intermediate results are not returned to the model unless the plan requests them.
- Truncation and filtering are recorded in the receipt.

The runtime must not silently discard information needed to determine task success. If a result is truncated before a downstream step or the final output, the run is marked as incomplete, not successful.

### FR-5: Security and policy

- Tool allowlists and argument-level restrictions are enforced where supported.
- Budgets, deadlines, and result-size limits apply to every run.
- The caller's identity and existing tool authorization are respected.
- Read-only and side-effecting operations are distinguished in the tool registry.
- Writes require explicit policy authorization.
- Sensitive operations can require confirmation surfaced to the user, not to the model.
- Plans cannot escalate privileges or access secrets beyond their granted scope.
- Authorization is checked at the tool boundary wherever the adapter allows, not only at plan level.

### FR-6: Failure, retry, and verification semantics

- Each step has a timeout and defined cancellation behavior.
- Side-effecting operations are never retried automatically unless the tool declares idempotency support and the plan opts in.
- Idempotency keys are passed when the underlying tool supports them.
- Partial completion and uncertain outcomes (for example, a write whose response timed out) are recorded explicitly.
- Cancellation never implies rollback unless rollback is confirmed by the tool.
- **Postconditions in v1 are limited to tools that declare a verification operation** in the registry, such as a read-back call that returns the state written. Postconditions are expressed as an equality or hash comparison against that read-back result. Free-form assertions are not supported. Steps without a declared verification operation are recorded as `unverified` in the receipt, and the overall run status reflects that.

### FR-7: Execution receipt

Each execution returns a structured receipt containing:

- Plan identifier, schema version, and plan digest.
- Execution identifier and timestamps.
- Per-step status, timing, and attempt count.
- Tool identifiers and version information where available.
- Sanitized errors and retry information.
- Selected outputs or references to retained evidence.
- Policy decisions, including denied operations.
- Postcondition results, with `verified`, `failed`, or `unverified` per step.
- Overall execution status, which is `complete`, `incomplete`, or `failed`.

Sensitive arguments, credentials, and raw payloads are not exposed by default. Argument values are recorded as hashes unless the policy explicitly permits retention.

A receipt documents what the runtime observed and did. It is not, by itself, proof that an external system is truthful.

### FR-8: Observability

- Structured execution events are emitted for each lifecycle phase.
- Per-step latency and result-size metrics are recorded.
- Validation failures, authorization denials, timeouts, and cancellations are tracked as distinct events.
- Test fixtures are reproducible.
- Receipts can be correlated with existing logs and traces through shared identifiers.

## 9. Proposed Architecture

```text
Agent / Model
     |
     | ExecutionPlan
     v
X Plan Interface
     |
     v
Parser + Schema Validator   (no side effects)
     |
     v
Policy and Capability Resolver
     |
     v
DAG Scheduler / Reference Interpreter
     |
     +------ MCP Adapter ------ Existing MCP servers
     |
     +------ HTTP Adapter ----- Existing APIs
     |
     +------ SDK Adapter ------ Existing tool implementations
     |
     v
Result Processor + Verification Evaluator
     |
     v
Execution Receipt + Selected Output
     |
     v
Agent / Model
```

### Implementation principles

- **Embedded first.** The interpreter ships as a library in the host application. No separate execution server is required for the MVP.
- **Adapter-based.** Plan execution is independent of the underlying transport.
- **Typed execution.** Arguments, dependencies, and references are validated against known schemas before anything runs.
- **Bounded by default.** Step counts, time, and output size are finite and enforced.
- **Deterministic where possible.** Orchestration and extraction are predictable. External tools may not be.
- **Observable by design.** Events and receipts are part of the core contract.

### Deployment evolution

A standalone service, remote execution protocol, or shared multi-tenant runtime is introduced only with demonstrated demand for centralized policy, cross-agent reuse, isolation, or remote execution.

## 10. Performance and Evaluation

The principal comparison is not X against native MCP. It is X against the strongest simple alternative, which is code execution over existing tools. The code-execution baseline must be given the same policy controls as X, or the comparison is unfair.

### 10.1 Baselines

- **A. Native MCP.** The agent orchestrates individual tool calls, with the same tool-boundary authorization as X.
- **B. Hardened Code Mode.** The agent writes code executed in a sandbox. The sandbox enforces time, memory, and network limits. Tool calls pass through the same policy wrapper as X, so authorization is enforced at the tool boundary. Dry-run validation is not included for B, because it is a property X adds and is part of what the benchmark tests.
- **C. X.** The agent supplies a declarative plan executed by the reference interpreter.

### 10.2 Models

At least two model families are included in every benchmark run, chosen to differ in tool-use behavior. Results are reported per model. A result that holds for one model family and not another is reported as model-dependent, not as a general finding. First-attempt plan quality is measured separately for each model, because it is the variable most likely to differ.

### 10.3 Differentiation tests

X's claimed advantage over Code Mode rests on specific guarantees. Each is tested directly, and the security suite attempts to bypass both X and hardened Code Mode:

| Guarantee | Test | Expected result |
|---|---|---|
| Pre-execution validation | Submit a plan with a type error in step 4 of 5 | X rejects before any side effect. B may execute steps 1–3 first. |
| Per-call policy at the tool boundary | Attempt an out-of-scope write via a permitted tool | Both X and B are blocked. Records compared for clarity. |
| Write gating without execution | Plan contains a write without grant | X rejects at validation. Measure whether B's sandbox reaches the write first. |
| Structured, queryable record | Answer audit questions from the receipt alone | X should answer without reading generated code. Measure time and accuracy for both. |
| Bounded side effects on failure | Inject a timeout mid-workflow | Record which side effects occurred and whether each was reported accurately. |

If Code Mode matches X on a test, that is a finding. It should not be hidden.

### 10.4 Benchmark workload

Create 20–30 representative tasks across:

1. Independent read-only calls.
2. Dependent multi-step API calls.
3. Search, filtering, and aggregation over large tool results.
4. Infrastructure investigation.
5. Workflows containing validation failures or timeouts.
6. Controlled write operations with explicit authorization.
7. Tasks requiring model judgment between steps.

Category 7 is a required test of the thesis. For these tasks, X should either hand control back to the model at the judgment point or be shown to produce worse outcomes if it does not. The benchmark measures whether the handback behavior is correct.

**Handback rule:** A plan may include a step marked `requiresJudgment`. When execution reaches that step, the runtime stops, returns the results so far with a receipt, and passes control to the model. Plans that cannot be completed without judgment are not valid X workloads.

### 10.5 Metrics

| Metric | Purpose |
|---|---|
| Total model input tokens | Prompt and intermediate-context overhead |
| Total model output tokens | Planning and response overhead |
| Model round trips | Orchestration overhead |
| End-to-end latency | User-perceived speed |
| Cost per successful task | Economic value |
| Task completion rate | Correctness |
| Verified postcondition rate | Whether the intended outcome was achieved, for tasks with verifiable postconditions |
| Policy violation rate | Execution safety |
| Receipt completeness | Auditability |
| Runtime overhead | Cost introduced by X itself |
| First-attempt plan success | Quality of agent-authored plans |

### 10.6 Statistical rules and decision gates

- Each task runs at least 5 times per baseline and per model. Results report medians, 90th-percentile latency, and a bootstrap 90% confidence interval for each comparison.
- Run-to-run variance is measured for native MCP first. Any improvement claim must exceed that variance, not just a fixed percentage.
- Tool execution time and model wait time are reported separately.

Decision gates, to be confirmed after the Phase 0 pilot establishes baseline variance:

- **Token reduction:** The lower bound of the 90% interval for total model tokens versus native MCP is at least 30% lower, on the workload categories where X is intended to apply.
- **Cost per successful task:** At least 20% lower than native MCP, with the interval lower bound above zero.
- **Completion:** No statistically meaningful drop in task completion rate versus either baseline.
- **Security:** Zero unauthorized writes in the security suite for X. Any unauthorized write from any baseline is recorded as a finding.
- **Failure visibility:** No silent loss of failures or partial completions in any condition.
- **Versus Code Mode:** X must show a measurable advantage on at least one differentiation test in Section 10.3, or equivalent efficiency with a clear operational advantage. If X only beats native MCP, the team must establish whether its safety and auditability benefits justify adoption.
- **Interpreter overhead:** Runtime overhead, excluding model and tool time, is under 2% of end-to-end latency and under 1% of tool-result bytes processed.

## 11. MVP Scope

### Included

- Versioned YAML/JSON plan schema.
- Schema validator with no side effects.
- Reference interpreter.
- DAG dependency execution.
- Typed references to previous step outputs.
- MCP adapter.
- Capability registry with read-only and write classifications.
- Runtime-enforced step, time, and result-size limits.
- Read-only execution by default.
- Explicit write policy hooks.
- Verification operations for tools that declare them.
- `requiresJudgment` handback.
- Compact execution receipts.
- Structured execution events.
- Benchmark harness for native MCP, hardened Code Mode, and X.
- Security test suite covering the Section 10.3 tests.
- Example workflows and reproducible fixtures.

### Excluded

- Distributed execution.
- Durable scheduling and recovery across process restarts.
- Visual plan editor.
- Public hosted service.
- Embedded scripts or arbitrary code inside plans.
- Loops, conditionals, recursion, and user-defined functions.
- Protocols beyond those the first benchmarks require.
- Public standardization and governance.

## 12. Milestones and Resourcing

Durations and staffing are planning estimates, to be revised after Phase 0.

Assumed staffing: one engineer full-time on the interpreter, plus one engineer at roughly half time on the benchmark harness and evaluation.

### Phase 0: Research and benchmark design (about 3 weeks)

**Deliverables:** Task corpus of 20–30 tasks, baseline implementations for A and B, measurement methodology, variance measurement for native MCP, and selection of two model families.

**Exit criterion:** The team can identify concrete workflows where the problem is significant, and all three approaches can be compared on the same tasks with the same policy controls.

**Go/no-go checkpoint:** If Code Mode, given equal policy controls, matches native MCP on efficiency and correctness across the corpus, stop or pivot before building the interpreter.

### Phase 1: Minimal interpreter (about 4 weeks)

**Deliverables:** Schema, validator, DAG executor, MCP adapter, receipt format, and handback mechanism.

**Exit criterion:** Plans execute against fixture tools with correct dependency, failure, limit, and verification behavior. The admission rule in Section 8.0 has been applied to every feature added.

### Phase 2: Comparative evaluation (about 3 weeks)

**Deliverables:** Benchmark results for A, B, and C across both models, including the security suite and differentiation tests.

**Exit criterion:** X meets the decision gates in Section 10.6, or the results are documented as a negative finding with a scope recommendation.

### Phase 3: External developer validation (about 4 weeks)

**Deliverables:** Documentation, examples, a reference implementation, and feedback from at least three independent agent developers.

**Exit criterion:** Developers can integrate X into an existing system without substantial migration or infrastructure overhead.

### Phase 4: Protocol decision

**Deliverables:** A versioned protocol specification, or a decision to remain a library.

**Exit criterion:** Multiple independent implementations, or a clear interoperability requirement, justify a protocol-level commitment.

## 13. Risks and Mitigations

**R1. Code Mode already solves the main problem.**
Risk: X becomes another syntax for what code execution already does.
Mitigation: Benchmark against a hardened Code Mode baseline from the start. Differentiate on pre-execution validation, write gating, and structured receipts, tested directly in Section 10.3, not on YAML syntax.

**R2. Declarative language creep.**
Risk: Variables, loops, conditionals, and error handlers gradually turn X into an inferior programming language.
Mitigation: The feature admission rule in Section 8.0. Changes to it require a PRD revision.

**R3. Tool outputs remain untrusted.**
Risk: The runtime processes malicious or misleading tool output.
Mitigation: Treat outputs as data, validate schemas, isolate execution, and never interpret returned content as runtime instructions.

**R4. Incorrect authorization boundaries.**
Risk: Plan-declared permissions are mistaken for granted permissions, or indirect tool access bypasses policy.
Mitigation: Resolve permissions against trusted runtime policy and enforce at the tool boundary. The security suite tests bypass attempts against X and B.

**R5. Retries cause duplicate side effects.**
Risk: Retrying a timed-out write duplicates an operation that already succeeded.
Mitigation: No automatic retries for side-effecting calls by default. Idempotency keys where supported. Uncertain outcomes are represented explicitly.

**R6. Token savings do not translate into economic savings.**
Risk: Reduced tokens are offset by planning, interpreter overhead, retries, or failed runs.
Mitigation: Measure cost per successful task with confidence intervals, and set an interpreter overhead target.

**R7. Verification is narrower than it sounds.**
Risk: Postconditions appear to verify outcomes, but only for the small set of tools that declare a verification operation.
Mitigation: Receipts mark unverified steps explicitly. Documentation and the README state the coverage limit plainly.

**R8. Model dependence.**
Risk: Results reflect one model family's tool-use habits.
Mitigation: At least two model families in every benchmark, with results reported per model.

**R9. Adoption requires another ecosystem.**
Risk: Teams won't support another plan format and runtime.
Mitigation: Embeddable library, existing MCP tools, and minimal integration changes.

## 14. Open Questions

1. Which workloads benefit most from declarative execution rather than code execution? Phase 0 answers this with data.
2. Should plans be generated entirely by models, selected from reusable templates, or composed from both?
3. What is the minimum capability metadata needed for models to generate valid plans reliably? First-attempt success will indicate whether the current metadata is sufficient.
4. Should the receipt contain full outputs, selected outputs, content hashes, or external evidence references? The current default is hashes plus selected outputs, subject to policy.
5. How should human confirmation be represented across different host applications?
6. Which tools will declare verification operations, and who maintains those declarations?
7. Does the product need a formal wire protocol, or is a stable schema plus a library sufficient?

## 15. Success Criteria and Go/No-Go Decision

**Proceed** if X meets the decision gates in Section 10.6, including at least one measurable advantage over the hardened Code Mode baseline.

**Narrow the scope** if X wins only for specific workload classes, such as read-heavy aggregation or write-gated workflows. Position it as a specialized execution runtime rather than a general protocol.

**Stop or pivot** if hardened Code Mode provides equivalent efficiency, correctness, and auditability at acceptable operational cost, and users do not value X's additional guarantees.

## 16. Final Product Thesis

X should not become a new protocol simply because tool orchestration is inefficient.

It should prove that a small, declarative execution contract can combine three properties developers need:

1. **Efficiency:** avoid unnecessary model round trips and context consumption, measured against a fairly configured code-execution baseline.
2. **Control:** validate, authorize, and bound execution before side effects occur.
3. **Evidence:** provide a structured, queryable account of what happened and which outcomes were verified.

If those properties create a measurable advantage, standardization becomes a credible next step. Until then, X is an experiment in agent execution architecture, not a justified protocol ecosystem.
