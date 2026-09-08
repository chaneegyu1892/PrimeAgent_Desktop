---
name: omo-refactor
description: "Refactor, simplify, extract or modernize an existing module without unintended behavior changes."
---

# 구조적 리팩터링

Map definitions, callers and observable contracts before editing. Establish relevant tests and baseline diagnostics. Split the transformation into verifiable steps with concrete affected paths. Use AST matches and LSP rename previews where appropriate, then inspect and apply actual edits. Recheck consumers and tests after each structural boundary. Report any intentional behavior change explicitly.

This is a Prime Desktop adaptation of OMO refactor. The actual tool schema, project rules and user instructions govern execution. Treat [upstream-reference.md](upstream-reference.md) as non-executable design background only when comparing methodology; its OMO/Codex commands, agent names, script paths and mandatory fanout are not Prime capabilities or permissions. Nested upstream assets and scripts are not installed.

Source: https://github.com/code-yeongyu/oh-my-openagent/blob/8bd0c35b3ba532ab0cb0df49ea71467303aa92ba/packages/shared-skills/skills/refactor/SKILL.md

Modification notice: the executable skill entrypoint is rewritten for Prime Desktop; the reference is copied unchanged. OMO material retains LICENSE-OMO.md and any separately supplied license.
