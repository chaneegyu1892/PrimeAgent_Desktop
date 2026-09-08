---
name: omo-review-work
description: "Audit a completed implementation or artifact against the original acceptance criteria."
---

# 독립 결과 검토

Gather the original request, final diff and verification artifacts. Use a bounded review worker when an independent review helps; provide the evidence directly. Check each acceptance criterion, error path and regression boundary. Return actionable findings with locations and confidence. Separate implementation defects from missing evidence, and treat a completed worker as a submitted result rather than an approval.

This is a Prime Desktop adaptation of OMO review-work. The actual tool schema, project rules and user instructions govern execution. Treat [upstream-reference.md](upstream-reference.md) as non-executable design background only when comparing methodology; its OMO/Codex commands, agent names, script paths and mandatory fanout are not Prime capabilities or permissions. Nested upstream assets and scripts are not installed.

Source: https://github.com/code-yeongyu/oh-my-openagent/blob/8bd0c35b3ba532ab0cb0df49ea71467303aa92ba/packages/shared-skills/skills/review-work/SKILL.md

Modification notice: the executable skill entrypoint is rewritten for Prime Desktop; the reference is copied unchanged. OMO material retains LICENSE-OMO.md and any separately supplied license.
