# Free desktop updates

## Implemented flow

- Packaged app checks the desktop release channel 15 seconds after startup, every six hours and on manual request.
- A quiet notification appears at the bottom of the left sidebar. Detection does not download or install anything.
- The user chooses **업데이트 다운로드**, then **재시작하여 설치**. Normal app quit never approves installation.
- Main-process checks block installation while main/side conversations, queued messages, human replies, native requests, open terminals or unsent attachment selections remain. The install latch prevents new work from racing the restart.
- The app verifies an Ed25519-signed manifest with its pinned public key, then verifies the ZIP's exact size and SHA-512. It rechecks the cached ZIP before extraction, rejects unexpected archive paths, checks symlinks, bundle ID, version and macOS code-signature integrity.
- A separate installer waits for the current app process to exit naturally. Only an explicit approval marker authorizes replacement. It renames bundles on the same volume, keeps a hidden backup of the previous app, and restores it if replacement or launch fails. It never kills the user's agent process, asks for sudo, strips quarantine or disables Gatekeeper.
- Replacement keeps the installed app path unchanged, so a Dock shortcut to that path continues opening the updated app. Do not replace it with a new version-specific folder.
- The existing conversation and text drafts are saved before restart. An install result and backup path are retained in the app's `updates/install-result.json`.

## Cost and distribution

This implementation does not require an Apple Developer subscription. The release identity is a locally generated Ed25519 key; the app bundle uses free ad-hoc macOS signing. This verifies publisher continuity for updates but is not Apple notarization. The first installation may require the user's normal macOS approval. The app must be in a folder writable by the current user. Locked, translocated or read-only installations fail before quitting; moving the app to a user-owned Applications folder resolves that case.

Repository: https://github.com/chaneegyu1892/PrimeAgent_Desktop (public fork).
The `desktop` git remote points to this fork. `origin` remains the original Prime CLI repository.

Git commits are source changes, not installable versions. A published desktop release supplies the ZIP and signed metadata. The app never pulls or executes arbitrary git changes and never checks upstream CLI releases.

Channel metadata:
`https://github.com/chaneegyu1892/PrimeAgent_Desktop/releases/download/desktop-stable/desktop-update.json`

Each signed payload binds a stable version, macOS/arm64 platform, exact immutable release URL, byte count, SHA-512 and bounded release notes. ZIP URLs must match this fork's `desktop-vVERSION/Prime-Desktop-VERSION-arm64.zip`. Prerelease versions, same/older versions and unrelated repositories are rejected.

## Maintainer release steps

From `packages/desktop`:

```sh
# First setup only. Re-running verifies the existing identity; it does not rotate it.
npm run release:init
# Bump package.json/package-lock.json and update docs/release-notes.md before each release.
npm run check
npm test
npm run build
npm run package
npm run release:artifacts
```

If a built app is currently running, copy it to a separate staging folder and pass `PRIME_DESKTOP_RELEASE_APP="out/release-staging/Prime Desktop.app"` to `npm run release:artifacts`. Never sign or overwrite the running bundle.

`release:artifacts` ad-hoc signs and verifies the app, checks bundle/package version agreement, creates the ZIP, and signs the manifest under `.release/VERSION/`. `release:init` generates `.release-keys/ed25519-private.pem` (0600) and the public key source. **Privately back up the key directory. Never commit, attach, or publish it.** Losing it prevents existing installations from trusting future releases. A key rotation needs an update signed with the old key first. This repo ignores the private key directory, runtime data, test data and release output.

Publish the versioned ZIP first, verify it is available, then advance the small `desktop-stable` channel manifest. Do not overwrite an existing versioned ZIP. Keep this channel separate from upstream CLI tags/workflows. Release commands use a reviewed commit pushed to the `desktop` fork:

```sh
gh release create desktop-vVERSION '.release/VERSION/Prime-Desktop-VERSION-arm64.zip' --repo chaneegyu1892/PrimeAgent_Desktop --target REVIEWED_COMMIT --title 'Prime Desktop VERSION' --notes-file .release/VERSION/release-notes.md
# Create desktop-stable once, then replace only its channel metadata:
gh release upload desktop-stable .release/VERSION/desktop-update.json --repo chaneegyu1892/PrimeAgent_Desktop --clobber
```

The fork runs `.github/workflows/desktop-ci.yml` for Desktop build, formatting/types and tests. Original CLI CI and release jobs are restricted to the upstream repository. Desktop CI does not publish or install updates.

A future CI can use the same scripts with the release key in a GitHub Actions secret. The current flow deliberately requires the maintainer to publish a release; arbitrary pushes do not publish binaries. Optional paid signing remains available in package.mjs with PRIME_DESKTOP_RELEASE=1 and keychain-based Developer ID/notary settings, but is not needed for this updater.

## Limits and recovery

The old bundle is retained at a unique hidden `.Prime-Desktop-previous-UUID.app` path beside the installed app; the receipt records it. File/launch failure rollback is tested. An accepted macOS launch is not proof of every future app behavior; retain the backup until the new version is checked. Current backups are not automatically deleted. If the app is force-killed or the computer loses power between the two renames, recover from the backup path; the installer does not provide a crash-proof system-wide package transaction.

Free updates do not alter Prime CLI, its global daemon, credentials, plugins outside the app or system settings. Text drafts use existing local storage; native attachment selections must be sent or removed before installation. An idle terminal is conservatively treated as active until explicitly closed. No prompt is replayed after restart.

## Background work and subagent management

Prime RPC exposes observe/unobserve for active session/subagent streams (`packages/coding-agent/src/modes/rpc/rpc-types.ts`). Its session runtime includes child-agent state, messaging and daemon-hosted sessions. A detailed agent tree, status/log/usage view, attention routing and per-agent controls can be built on these interfaces, gated by negotiated runtime support. The current desktop owns child RPC processes and shuts them down on app quit. Running through app closure requires a daemon connection and a persistent task registry with reconnection/cancellation. These features are separate from this update implementation.

## Research sources

- Electron's built-in macOS updater requires signing: https://www.electronjs.org/docs/latest/api/auto-updater/
- Electron distribution and signing: https://www.electronjs.org/docs/latest/tutorial/code-signing
- Node.js Ed25519 signing and verification API: https://nodejs.org/api/crypto.html#cryptoverifyalgorithm-data-key-signature-callback
