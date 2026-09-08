---
name: omo-ulw-execute
description: "Execute a multi-step plan, coordinate dependent tasks or resume interrupted work."
---

# 계획 실행과 인계

Read the accepted plan and existing task ledger. Use desktop_tasks list before creating work to avoid duplicate dispatch. Create concrete implementation tasks with criteria and dependencies; follow with a verify or review task that depends on implementation. Same-project workers are serial, so a worker must finish rather than wait for its own queued children. Inspect results and unresolved criteria. Resume failed work only after the user reviewed existing effects; never infer that a timed-out write did nothing.

This is a Prime Desktop adaptation of OMO ulw-execute. The actual tool schema, project rules and user instructions govern execution. Treat [upstream-reference.md](upstream-reference.md) as non-executable design background only when comparing methodology; its OMO/Codex commands, agent names, script paths and mandatory fanout are not Prime capabilities or permissions. Nested upstream assets and scripts are not installed.

Source: https://github.com/code-yeongyu/oh-my-openagent/blob/8bd0c35b3ba532ab0cb0df49ea71467303aa92ba/packages/shared-skills/skills/ulw-execute/SKILL.md

Modification notice: the executable skill entrypoint is rewritten for Prime Desktop; the reference is copied unchanged. OMO material retains LICENSE-OMO.md and any separately supplied license.
