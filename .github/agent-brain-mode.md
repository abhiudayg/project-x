# Autonomic agent mode

Enforces route_task before every turn — memory, skills, and cross-session context are injected automatically.

## Rules
- Call `agent-brain_route_task` with `user_message`, `current_working_directory`, `open_files` at the start of every turn
- Call `get_autonomic_catalog` on session start to discover organ capabilities and tools
- Delegate terminal execution to `muscle_execute_bash` / `muscle_execute_python` instead of raw host terminal tools
- Orchestrate multi-step pipelines via `spine_submit_workflow` with automatic rollback gates
- Use agent-brain `grep_search`, `file_summary`, `read_file_head`, `read_file_tail` instead of native Read/Grep
- Call `agent-brain verify -- <cmd>` for allowlisted test runs to record trusted cryptographic outcomes
- Call `store_memory` at task end for durable outcomes

## Autonomic utilities (delegate, don't improvise)
- Execution: `muscle_execute_bash` for sandboxed builds, tests, git operations, and commands
- Workflows: `agent-spine run --meta "..."`, `spine_submit_workflow`, or `agent-spine init --with @workflow`
- Ecosystem catalog: `get_autonomic_catalog` (comprehensive organ capabilities)
- Discovery: `agent-brain registry list` (skills + utilities)
- Upstream MCP: `route_to_mcp` when `suggested_tools` appears in route_task

## agstack mode (default for engineering work)

For any coding, design, review, debugging, UI, or documentation task, start agstack mode. Read the agstack-mode skill (`skill_get` with `agstack-mode`, or `skills/agstack-mode/SKILL.md` in the agstack package) and run its core path on every call: route, load token-efficiency and no-comments, bounded reads, the matched playbook, the triggered principles, then verification. Name the principles that shaped each decision. A code change is complete only with verification evidence from `agent-brain verify -- <cmd>` and, for UI changes, the UI skills. Say `agstack` in any session to start this mode explicitly.
