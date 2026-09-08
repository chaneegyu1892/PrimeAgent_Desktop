---
name: prime-debugging
description: Diagnose reproducible bugs, intermittent failures, performance regressions, or stuck agent behavior.
---

# 문제 진단

1. Capture expected versus observed behavior, the smallest reproduction, timing and relevant redacted logs.
2. Trace the event/data lifecycle. Form a falsifiable hypothesis and select one measurement that would disprove it; record the result before changing direction.
3. Fix the root cause at the owning boundary, including cancellation, timeout, retries and duplicate dispatch when relevant. Preserve the original error rather than silently masking it.
4. Reproduce the original trigger after the fix and verify a nearby success case. Add a regression test for meaningful behavior, not implementation detail.
5. Report cause, fix, measured result and remaining uncertainty. Avoid claiming a production fix from only local tests.
