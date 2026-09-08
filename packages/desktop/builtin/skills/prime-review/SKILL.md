---
name: prime-review
description: Review changes for correctness, regressions, trust boundaries, data loss, and release readiness.
---

# 코드·보안 검토

1. Fix the review scope: working diff, commit or branch. Read the change plus callers, tests and relevant contracts.
2. Trace untrusted input, authorization, credentials, filesystem paths, subprocess arguments, database mutations and output rendering. Check cancellation and failure behavior.
3. Report only actionable findings supported by a concrete trigger and affected path. Give severity, exact file/line, impact and a practical remedy.
4. Separate reproducible defects from questions and missing evidence. Respect existing user scope; do not manufacture compliance requirements.
5. Summarize verification and residual limitations. A clean review is not proof of universal security.
