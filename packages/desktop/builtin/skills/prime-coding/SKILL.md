---
name: prime-coding
description: Implement features, refactor code, or integrate APIs in an existing repository.
---

# 코딩과 구현

1. Locate AGENTS.md, package manifests, entry points and relevant existing implementations. Read complete files before editing. Establish a baseline and preserve unrelated changes.
2. Trace the requested behavior from UI through state, APIs and persistence. Follow the repository architecture and existing dependencies. Inspect official versioned documentation when an API is uncertain.
3. Make a coherent change that handles loading, empty, success and failure states. Keep inputs validated at the trusted boundary; secrets stay on the server or main process.
4. Run the repository-approved scoped checks and tests. Verify a real user flow, including recovery from failure. Report checks actually run and limitations.
5. Review the diff for accidental files, generated output, secrets and unrelated changes. Give concise file links and outcome; commit/push only within the user-authorized scope.
