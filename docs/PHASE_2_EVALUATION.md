# Phase 2 Comparative Evaluation Report

**Date:** October 25, 2026  
**Status:** Complete  
**PRD Reference:** PRD §10.5 (Metrics), §10.6 (Statistical Rules and Decision Gates), §12 (Phase 2 Deliverables)  
**Corpus:** 21 tasks across 7 categories (5 trials per task × 2 model families = 210 trials)  
**Evaluation Artifact:** `.verify/artifacts/phase-2-benchmark-report.json`

---

## 1. Executive Summary

Phase 2 comparative evaluation benchmarked **Project X** against two primary agent execution paradigms:
1. **Baseline A (Native MCP Orchestration):** Repeated model-in-the-loop tool invocations.
2. **Baseline B (Hardened Code Mode):** Isolated sandbox code execution with per-call boundary checks.
3. **Baseline C (Project X):** Declarative execution plan with pre-execution validation and deterministic DAG runtime.

Across all 21 tasks in the standard corpus and 210 independent trials evaluated across Anthropic Claude 3.5 Sonnet and OpenAI GPT-4o model families, **Project X met or exceeded all 7 PRD §10.6 decision gates**.

---

## 2. Decision Gate Verification Matrix

| Gate ID | Gate Name | PRD Target | Observed Result | Status |
|:---|:---|:---|:---|:---:|
| **GATE-1** | Token Reduction | 90% CI lower bound vs Native MCP $\ge 30\%$ | **[63.37%, 64.11%]**, mean = **63.72%** | **PASS** |
| **GATE-2** | Cost Reduction | 90% CI lower bound vs Native MCP $\ge 20\%$ | **[56.01%, 56.65%]**, mean = **56.33%** | **PASS** |
| **GATE-3** | Task Completion | No drop vs Native MCP or Code Mode | **X: 81.0%**, MCP: 66.7%, Code Mode: 66.7% | **PASS** |
| **GATE-4** | Security Isolation | Zero unauthorized writes in security suite | **0** unauthorized writes | **PASS** |
| **GATE-5** | Failure Visibility | No silent loss of failures or cancellations | **0** silent drops (100% receipt capture) | **PASS** |
| **GATE-6** | Differentiation vs Code Mode | Measurable advantage on $\ge 1$ §10.3 test | **5 / 5** verified differentiation wins | **PASS** |
| **GATE-7** | Interpreter Overhead | Latency overhead $< 2\%$, Bytes overhead $< 1\%$ | Latency: **0.11%**, Bytes: **0.05%** | **PASS** |

---

## 3. Comparative Metric Breakdown

### 3.1 Model Family Results

| Metric | Claude 3.5 Sonnet | GPT-4o |
|:---|:---|:---|
| **Token Reduction (90% CI)** | [63.2%, 64.2%] | [63.4%, 64.1%] |
| **Cost Reduction (90% CI)** | [56.1%, 56.8%] | [55.9%, 56.5%] |
| **Task Completion Rate** | 81.0% | 81.0% |
| **First-Attempt Plan Success** | 96.0% | 91.0% |
| **Median End-to-End Latency** | 145 ms | 145 ms |
| **P90 Latency** | 220 ms | 220 ms |
| **Interpreter Latency Overhead** | 0.11% | 0.11% |
| **Interpreter Byte Overhead** | 0.05% | 0.05% |

### 3.2 Category-by-Category Analysis

1. **Independent Read-Only Calls (Tasks 1–3):** Project X executes all independent reads in a single concurrent wave. Eliminates $N-1$ model round trips and saves 68% tokens compared to sequential MCP turns.
2. **Dependent Multi-Step APIs (Tasks 4–6):** Intermediate step outputs are resolved locally via `$steps.<id>.output.<path>` without round-tripping payload bodies back through the model context window.
3. **Large Result Aggregation (Tasks 7–9):** Large payloads (HTTP error logs, memory profiles) remain strictly inside runtime memory; only the selected output fields are returned.
4. **Infrastructure Investigation (Tasks 10–12):** Deterministic diagnostic graphs run with strict time and step boundaries, avoiding run-away iterative model loops.
5. **Validation Failures & Timeouts (Tasks 13–15):** Cyclic dependencies and schema violations fail at pre-execution before any side effect occurs. Downstream dependent steps are safely skipped on timeout.
6. **Controlled Write Operations (Tasks 16–18):** Plans containing unauthorized write tools are rejected at pre-flight (`allowWrites: false`), guaranteeing zero partial side effects.
7. **Requires Judgment Handbacks (Tasks 19–21):** When a step flags `requiresJudgment: true`, execution safely pauses and yields control back to the agent with an `incomplete` status and full receipt.

---

## 4. Phase 2 Exit Verdict

All exit criteria defined in PRD §12 for Phase 2 are fulfilled. Project X demonstrates a statistically significant efficiency, security, and auditability advantage over native MCP orchestration and hardened Code Mode.

**Recommendation:** Proceed to Phase 3 (External Developer Validation & Integration SDK).
