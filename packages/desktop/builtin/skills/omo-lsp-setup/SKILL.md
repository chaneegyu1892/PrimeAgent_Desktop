---
name: omo-lsp-setup
description: "Set up or diagnose code intelligence, definitions, references and language-server availability."
---

# 언어 도구 준비

Use desktop_lsp for bundled TypeScript and JavaScript symbols, definition, references, diagnostics and rename previews. Inspect the real response; an empty partial diagnostics snapshot is not a passed typecheck. For other languages inspect desktop_mcp tools and the user-configured server. Configure missing language servers through the app capability library, preserving project and user settings. Verify representative symbols and an intentional fixture error before reporting ready.

This is a Prime Desktop adaptation of OMO lsp-setup. The actual tool schema, project rules and user instructions govern execution. Treat [upstream-reference.md](upstream-reference.md) as non-executable design background only when comparing methodology; its OMO/Codex commands, agent names, script paths and mandatory fanout are not Prime capabilities or permissions. Nested upstream assets and scripts are not installed.

Source: https://github.com/code-yeongyu/oh-my-openagent/blob/8bd0c35b3ba532ab0cb0df49ea71467303aa92ba/packages/shared-skills/skills/lsp-setup/SKILL.md

Modification notice: the executable skill entrypoint is rewritten for Prime Desktop; the reference is copied unchanged. OMO material retains LICENSE-OMO.md and any separately supplied license.
