# Transport decision

## Decision

Use `RpcAgentTransport`, launching an externally installed `prime-agent --mode rpc`
with the chosen project as its process cwd. The renderer depends only on the typed
desktop API; the main-process manager depends on `AgentTransport`.

Reviewed upstream revision: `9c8230df67b378aaedc032f90e1ae8ba687cfe4a` (0.9.3).

## Why RPC for the MVP

`DaemonAgentConnection` and `DaemonClient` are public exports, but daemon bootstrap
(`ensureInteractiveDaemonRunning`) is not exported. Its launcher uses
`process.execPath`, `process.execArgv`, and `process.argv[1]` as the CLI entry point.
Those describe Electron inside a packaged app. Importing internals, cloning daemon
bootstrap/recovery, or expanding core exports would add unnecessary coupling.

The installed CLI already composes daemon startup, version negotiation, session
creation, and `DaemonAgentConnection`. RPC therefore still uses the existing agent
engine and daemon. We do not implement daemon wire commands or agent execution.

The exported RpcClient assumes `node <cliPath>`, writes raw stderr to the parent,
and does not reject all requests on process exit. A small strict JSONL adapter is
used instead, with executable discovery, bounded diagnostics, redaction, readiness
via get_state, response validation, and explicit process cleanup.

## Ownership

Current upstream creates RPC sessions as client-owned. Closing this app stops its
RPC child; the CLI disposes its own session worker. The app never kills a shared
daemon, process group, or unrelated worker. Resident sessions promoted by Prime's
scheduling features retain the CLI's existing lifecycle policy. This MVP does not
promise that an ordinary interactive task keeps running after quitting.

## Runtime and packaging

No agent runtime or authentication files are bundled. Find the CLI in PATH and
common macOS installation locations (including nvm); allow native file selection.
For a Node shebang CLI, resolve the external Node beside it and construct PATH for
Finder launches. Never execute the CLI with Electron's process.execPath.
The same discovery code runs in development and the unsigned arm64 .app.

## Boundaries and follow-up

Preserve upstream RPC command/event names, projecting only display fields to the
renderer. Full model records can contain headers and are never forwarded. Unknown
extension dialogs are cancelled with a visible diagnostic instead of hanging.
No credentials or paid model calls are used in tests. Fake CLI fixtures cover the
protocol and actual Electron packaging. A real conversation remains a user-run
acceptance check. Saved-session catalog, resident attach, and full resync UI are
follow-up work; RPC commands already available may be exposed without core changes.

Sources: upstream architecture.md, agent-connection.md, rpc.md, main.ts, index.ts,
package.json, cli/daemon-launch.ts, agent-connection adapter, and RPC implementation.
