---
name: omo-visual-qa
description: "Verify rendered UI, interactions, responsive behavior and Korean text against a design reference."
---

# 실화면 품질 검증

Enumerate the relevant screens, states and viewports. Capture fresh actual screens using Aside or a native app harness. Exercise keyboard focus, forms, loading/errors, long content and resizing. Inspect Korean glyphs, wrapping, contrast, alignment and clipping. Compare settled reference and actual states. Record concrete screenshots and test steps; fix observed defects and recapture. A screenshot-only check does not prove behavior.

This is a Prime Desktop adaptation of OMO visual-qa. The actual tool schema, project rules and user instructions govern execution. Treat [upstream-reference.md](upstream-reference.md) as non-executable design background only when comparing methodology; its OMO/Codex commands, agent names, script paths and mandatory fanout are not Prime capabilities or permissions. Nested upstream assets and scripts are not installed.

Source: https://github.com/code-yeongyu/oh-my-openagent/blob/8bd0c35b3ba532ab0cb0df49ea71467303aa92ba/packages/shared-skills/skills/visual-qa/SKILL.md

Modification notice: the executable skill entrypoint is rewritten for Prime Desktop; the reference is copied unchanged. OMO material retains LICENSE-OMO.md and any separately supplied license.
