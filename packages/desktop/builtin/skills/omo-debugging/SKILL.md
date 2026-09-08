---
name: omo-debugging
description: "Diagnose repeated failures, performance regressions or environment-specific defects."
---

# 가설 기반 진단

Record a concrete failing case and baseline. Form one falsifiable hypothesis, instrument the relevant boundary, and compare evidence before changing code. Make the smallest fix supported by evidence. Reproduce the original failure and adjacent regression cases. For browser work use Aside first. Preserve logs as evidence with secrets removed.

This is a Prime Desktop adaptation of OMO debugging. The actual tool schema, project rules and user instructions govern execution. Treat [upstream-reference.md](upstream-reference.md) as non-executable design background only when comparing methodology; its OMO/Codex commands, agent names, script paths and mandatory fanout are not Prime capabilities or permissions. Nested upstream assets and scripts are not installed.

Source: https://github.com/code-yeongyu/oh-my-openagent/blob/8bd0c35b3ba532ab0cb0df49ea71467303aa92ba/packages/shared-skills/skills/debugging/SKILL.md

Modification notice: the executable skill entrypoint is rewritten for Prime Desktop; the reference is copied unchanged. OMO material retains LICENSE-OMO.md and any separately supplied license.
