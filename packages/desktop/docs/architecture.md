# Prime Desktop architecture

```text
React renderer (local assets, no Node, no network)
  └─ contextBridge: typed request + main/panel event subscriptions
      └─ Main IPC: exact window/frame/URL check + argument allowlist
          ├─ ProjectManager → native dialog selections and recent projects
          ├─ SettingsStore → app-owned local settings, atomic serialized writes
          └─ AgentManager → bounded display state, ordering, ownership
              └─ AgentTransport
                  └─ RpcAgentTransport → external Prime Agent CLI
                      └─ existing daemon/session/agent/kernel implementation
```

## Process boundary

Main and preload are separately bundled as CommonJS. A sandboxed preload only
imports Electron and exposes `request`, `subscribe`, and `subscribePanel`. Every request is checked
again in Main. The renderer receives no raw Electron event, shell API, arbitrary
file API, model headers, environment dump, or authentication file. Assistant replies
use react-markdown with remark-gfm for headings, lists, tables and code blocks.
Raw HTML stays escaped text; no HTML execution plugin is enabled. Links render as
text and images render as alt text, with no navigation or remote image requests.
User messages and tool output remain literal text. Completed reply components are
memoized while the active reply updates from streamed content.

The `prime-desktop://app` protocol serves only packaged renderer files. Requests
cannot escape that directory. CSP disallows remote scripts, frames, forms, and
network connections. Navigation, popups, webviews, and permission grants are denied.
Aside URL opening is handled by Main through the installed CLI, with HTTP(S)-only
validation and no embedded credentials. The renderer itself cannot navigate to a remote page.
Inline styles are permitted for xterm's runtime-generated cell geometry and ANSI theme;
inline scripts remain prohibited.

## State and events

The CLI receives upstream RPC commands unchanged: prompt, steer, follow_up, abort,
get_state, get_messages, new_session, switch_session, set_session_name,
get_available_models, set_model, set_thinking_level, extension_ui_response.
Interactive select/confirm/input/editor requests wait for explicit user responses.

Main projects upstream messages and events into display-only DTOs. Tool calls use
toolCallId for updates. Start/update/end messages update the current timeline entry.
Snapshot revisions prevent older IPC snapshots from replacing a newer renderer
state; event versions prevent a late get_messages response from undoing live events.
Snapshots are batched at 40 ms. History is bounded to the last 1,000 display messages,
100 activity entries, and 200 diagnostic lines; Prime retains its own full transcript.

Prompt acceptance is distinct from completion and display refresh. A failed display
refresh after acceptance produces a diagnostic, not a false prompt rejection.
Timeouts are treated as uncertain and commands are never automatically replayed.
Project/session transitions are serialized and blocked during execution. Abort can
be sent while a prompt request is waiting. Quitting during CLI discovery cannot
spawn a late child after shutdown begins.

## Automatic startup and general conversations

WorkspaceController creates a canonical app-owned `general-workspace` folder in Electron userData.
It represents a personal conversation context, excluded from the project sidebar but included in the
session catalog. It starts the external CLI automatically without invoking a model. Last-conversation
restoration only opens a registered project or this personal workspace, and validates the session cwd.
Missing paths fall back to personal chat with a visible notice. A rejected restoration blocks sends into
the replacement session until the user chooses an explicit navigation or retry.

Startup is a single shared promise. Lifecycle IPC waits for it; question replies and cancellation remain
available. User sends await readiness once, and cancellation invalidates sends waiting for startup.
No failed/uncertain prompt is replayed. Project selection automatically connects a fresh conversation.
Main uses an initializing flag so transient sessions created during restoration do not capture drafts.
Settled session changes persist the last pointer, excluding failed restoration and transient navigation.

The welcome screen centers the composer, navigation exposes general New Chat and title/project Search,
and connection management lives in Settings. App shortcuts and panel shortcuts reject collisions.
Empty welcome content does not share its horizontal layout with startup questions or recovery notices.

## User questions and intervention

Each CLI launch receives an explicit `--extension` pointing to Desktop's dependency-free
`desktop_ask_user` tool. The ESM extension is unpacked from ASAR so the external Node
process can read it. It registers a sequential tool using only public registerTool/ctx.ui
APIs. No global extensions, agent configuration, core code, or permission defaults change.
Select adds a free-text alternative; confirm false is returned as not_approved because
the CLI maps both denial and cancellation to false. Missing UI and abort never grant approval.

InteractionStore owns raw IDs/options; the renderer receives redacted text, random IDs,
and option indices. Responses validate method, index, status, and deadline. Duplicate and
stale replies fail. There are at most 16 pending requests and 50 retained cards per manager.
Requests close on abort/process exit/disconnect, not simply on agent_end: extensions may
ask after a turn ends. Timeouts expire cards and send best-effort cancellation.

Transport pauses pending RPC deadlines while dialogs await human input. UI responses use
the original request ID and resolve on stdin write, with no fabricated RPC acknowledgement.
Startup/session commands may themselves await input, so reply/abort IPC bypasses the
serialized lifecycle lock. Failed or uncertain commands are never automatically replayed.
Explicit main reconnect validates/restores the last saved session; reconnecting a side chat
also restores its own prior session before accepting the user's next message.

Running default sends become steering; explicit follow-ups remain queued. The UI shows
running/retrying/stopping/stopped/completed/error and waiting states. notify/status/widget/
title messages are bounded text notices; proposed editor text is applied only on user action.
An attention tray subscribes to hidden side chats, routing answers to an existing project
manager and its unique request ID even when another project is selected in the main view.
Request history is in memory, with older completed cards collapsed. Approvals are not
persisted or replayed. Custom TUI rendering and a universal tool permission gate are outside
the existing RPC integration; ordinary textual questions remain ordinary chat messages.

## Ownership and persistence

The app owns its RPC child, and only that process receives termination signals.
EOF requests normal CLI shutdown, followed by SIGTERM after 5 seconds and SIGKILL
after 10 seconds if needed. Main never sends daemon shutdown commands or signals
to a process group. A future shared daemon transport must define close as detach.

App settings contain recent projects, the CLI path, explicitly imported session paths, and the last conversation pointer. Saves are serialized,
written to a temporary file with mode 0600, then renamed. Corrupt settings are not
overwritten; the app reports a recovery error. Prime keeps authentication, model
settings, and session files in its original locations. Session opening uses a
native file picker or the saved-session catalog, and verifies that the selected file's header cwd resolves to
the target project (including macOS /var symlinks). Catalogued session activation selects
its registered project and connects the RPC child before switching sessions.

## Session navigation and attachments

SessionCatalog reads Prime's flat JSONL session directory, including the
PRIME_AGENT_SESSION_DIR / PRIME_AGENT_CODING_AGENT_SESSION_DIR overrides and the
PRIME_AGENT_CODING_AGENT_DIR agent root. Only registered projects appear in results.
Explicitly imported session paths are persisted separately. Metadata is cached by
inode, size and modification time. Scanning bounds each JSON line to 1MB; oversized
image/tool lines are skipped, while later session names are still read. A large
first user message can therefore appear as "새 세션" until the session is named.
The catalog refreshes on session, message-count and streaming-state changes, window
focus, or explicit refresh, with debouncing and stale-response protection.

Native picker selections receive opaque attachment IDs. The renderer receives only
ID, name, size and kind; it cannot request arbitrary file reads or send file paths as
attachment IDs. Main validates image sizes/signatures at send time and forwards
image blocks through the existing prompt/steer/follow_up RPC image field. Other
files become quoted local path references. Images are limited to 8MB each and 20MB
per prompt. The transport bounds response lines to 128MB to accommodate returned
image-bearing message history; projected snapshots omit the base64 payloads.

File preparation and project/session mutations are serialized. Attachment IDs are
revoked after successful message acceptance or explicit removal. Failed sends retain
them. Renderer drafts are keyed by project/session. Text from the latest 20 non-empty drafts is persisted locally (up to 100,000 characters each); attachment tokens remain in memory and must be selected again after restart.
No daemon commands or core protocol schemas were changed.

## Workspace panel services

PanelService validates the selected project against Main's current snapshot. Project file
listing and previews use realpath containment, reject traversal/symlink escapes, and cap
listings at 500 entries, text previews at 1MB, and images at 8MB. Git status/diff run as
fixed argument arrays with optional locks, external diff helpers and textconv disabled.
Nested projects translate repository-relative status paths into project-relative paths.
These read-only tools are separate from the agent's existing filesystem permissions.

TerminalManager owns up to eight node-pty zsh processes, one per project. Only known
terminal IDs belonging to the selected project accept input or resize requests. State has
an offset and a bounded 128KB buffer, with 30ms event batching. Hiding the UI retains the
PTY; closing it or quitting terminates it. The packaged native helper is unpacked from
ASAR and executable. No process-spawn API is exposed directly to the renderer.

AsideBrowser serializes installed-CLI `repl --host local` calls. Fixed scripts invoke
listBrowserTabs/openTab/attachBrowserTab/snapshot; URL and tab IDs are JSON-encoded argv
content, never shell interpolation. Only IDs from the latest listing can be read. Calls
have a 30-second timeout and 2MB output cap. The panel displays page text, not an embedded
browser; adding it to a prompt is explicit. Global Prime MCP settings are untouched.

Side chats use independent AgentManager/owned RPC instances per project. They initialize
only on send, have their own subscriptions, stream/abort/new-session lifecycle and do not
replace the primary session. Main context is included only through an explicit button.
All owned side chat processes are closed on app quit. Saved records use Prime's normal
session storage; side-panel selection/drafts are in-memory. Each project may have one side
chat instance, up to eight per app run.

## Diagnostics and verification limits

No raw model records or event metadata reach the renderer. Known secret-shaped
strings and secret environment values are redacted before display. Stderr is
buffered to complete lines to avoid exposing a secret split across pipe chunks;
overlong stderr lines are discarded. Arbitrary secrets embedded in ordinary text
cannot be universally identified; Prime provider authentication stores are never read by Desktop; app-owned MCP credentials are managed separately.

Unit and Electron smoke tests use offline fake transports/CLI processes and isolated
settings. They validate the desktop integration, not live model authentication,
real file edits, or Python kernel readiness. Native file picker return values are
stubbed in automated smoke tests; a separate native UI inspection can cover the OS
dialog itself. See verification.md for the checks actually performed.

Official references checked during implementation:
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron module formats](https://www.electronjs.org/docs/latest/tutorial/esm)
- [Electron Packager](https://github.com/electron/packager)

## App-owned capability library

CapabilityStore discovers the 15 bundled Skills, copies native-selected Skill/Prime package folders into userData, validates bounded trees and explicit in-package paths, and persists enabled state atomically. YAML metadata uses a patched parser with bounded aliases. Imports start disabled; preview exposes their instructions and extension source. Removed payloads survive the current process and are cleaned on next startup. Active CLI launches get explicit --skill/--extension arguments; built-ins are unpacked from ASAR for external Node/Python access.

CapabilityService owns an authenticated loopback HTTP bridge. Only random per-launch bearer grants can call it; browser Origin requests are rejected. The renderer cannot access that grant or raw saved credentials. The desktop_mcp extension discovers servers/tools and calls MCP tools/resources/prompts via the bridge; screenshot blocks remain images for the model. Shutdown closes bridge connections and owned MCP clients. MCP configuration remains entirely app-owned.

McpHub uses the official SDK for Streamable HTTP and stdio, lazy discovery, bounded timeouts and explicit close. Stdio runs argv without a shell and inherits only a small environment plus configured variable references. MCP content is external data; writes rely on the user's task authorization, not a fabricated blanket approval. Opaque secret storage uses Electron safeStorage. Tokens do not appear in snapshots or config plaintext; endpoint changes clear old credentials. MCP tool/server errors are distinct from successful results. No automatic replay follows an uncertain tool call.

McpOAuth implements public-client OAuth PKCE/DCR with a loopback callback, random state validation, browser login on explicit UI action, encrypted token/client persistence and refresh. Cancellation/logout invalidates pending providers to prevent late token resurrection. Confidential-client secrets/custom redirect URIs are not supported; providers requiring that setup can use user-provisioned bearer tokens. Live OAuth login requires the user's service account and is not covered by the offline credential-lifecycle tests.

The bundled Python Skill declares pinned authoring/data dependencies and structural inspection helpers. It is installed by Prime's existing managed-kernel setup, not by rewriting the global Python environment. Spreadsheet recalculation, OCR, office/PDF rendering and model quality remain separately verified capabilities; library installation alone is not visual QA.
