import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { _electron } from "playwright";
import { waitForAsync } from "./smoke-wait.mjs";

const run = promisify(execFile);
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const baseline = resolve(process.env.PRIME_DESKTOP_UPDATE_BASELINE || ".smoke/update-baseline/Prime Desktop.app");
const bundleVersion = async (app) =>
	(
		await run("/usr/libexec/PlistBuddy", [
			"-c",
			"Print :CFBundleShortVersionString",
			join(app, "Contents/Info.plist"),
		])
	).stdout.trim();
const baselineVersion = await bundleVersion(baseline);
assert.notEqual(baselineVersion, version, "Baseline must differ from release");
const root = await realpath(await mkdtemp(resolve(".smoke/update-")));
const target = join(root, "Prime Desktop.app");
await run("/usr/bin/ditto", [baseline, target]);
const bin = join(root, "bin"),
	userData = join(root, "user-data"),
	home = join(root, "home"),
	sessions = join(home, ".prime/agent/sessions");
await Promise.all([mkdir(bin), mkdir(userData), mkdir(sessions, { recursive: true })]);
await copyFile("test/fixtures/fake-cli.mjs", join(bin, "prime-agent"));
await chmod(join(bin, "prime-agent"), 0o755);
await symlink(process.execPath, join(bin, "node"));
await writeFile(
	join(userData, "desktop-settings.json"),
	JSON.stringify({ cliPath: join(bin, "prime-agent"), recent: [] }),
);
const env = {
	PATH: `${bin}:/usr/bin:/bin`,
	HOME: home,
	TMPDIR: process.env.TMPDIR ?? "/tmp",
	LANG: "en_US.UTF-8",
	PRIME_DESKTOP_USER_DATA: userData,
	PRIME_TEST_SESSION_DIR: sessions,
	PRIME_AGENT_SESSION_DIR: sessions,
};
const executablePath = join(target, "Contents/MacOS/Prime Desktop");
let application;
const launch = () => _electron.launch({ executablePath, env, chromiumSandbox: true, timeout: 30_000 });
const asset = resolve(`.release/${version}/Prime-Desktop-${version}-arm64.zip`);
const manifest = resolve(`.release/${version}/desktop-update.json`);
async function installFixtureFetch(app) {
	await app.evaluate(
		(_, paths) => {
			const fs = process.getBuiltinModule("fs");
			const { Readable } = process.getBuiltinModule("stream");
			globalThis.updateFixtureRequests = [];
			globalThis.fetch = async (input) => {
				const url = String(input);
				globalThis.updateFixtureRequests.push(url);
				if (url.endsWith("desktop-update.json")) return new Response(fs.readFileSync(paths.manifest));
				if (url.endsWith(`Prime-Desktop-${paths.version}-arm64.zip`))
					return new Response(Readable.toWeb(fs.createReadStream(paths.asset)));
				throw new Error("Network disabled in update smoke");
			};
		},
		{ asset, manifest, version },
	);
}
try {
	application = await launch();
	await installFixtureFetch(application);
	let page = await application.firstWindow();
	await waitForAsync(page, async () => {
		const r = await window.primeDesktop.request("app.snapshot", undefined);
		return r.ok && r.value.connection === "connected" && !r.value.initializing;
	});
	await page.getByRole("button", { name: "앱 업데이트", exact: true }).click();
	await page.getByRole("button", { name: "업데이트 확인", exact: true }).click();
	await page.getByRole("button", { name: "업데이트 다운로드", exact: true }).waitFor();
	assert.equal(
		(await application.evaluate(() => globalThis.updateFixtureRequests)).filter((url) => url.endsWith(".zip")).length,
		0,
	);
	await page.screenshot({ path: join(root, "update-available.png") });
	await page.getByRole("button", { name: "업데이트 다운로드", exact: true }).click();
	await page.getByRole("button", { name: "재시작하여 설치", exact: true }).waitFor({ timeout: 60_000 });
	await page.getByRole("button", { name: "나중에", exact: true }).click();
	// Downloading then closing the app must never replace it.
	await application.close();
	application = undefined;
	assert.equal(await bundleVersion(target), baselineVersion);
	application = await launch();
	await installFixtureFetch(application);
	page = await application.firstWindow();
	await waitForAsync(page, async () => {
		const r = await window.primeDesktop.request("app.snapshot", undefined);
		return r.ok && r.value.connection === "connected" && !r.value.initializing;
	});
	await page.getByRole("button", { name: "앱 업데이트", exact: true }).click();
	await page.getByRole("button", { name: "업데이트 확인", exact: true }).click();
	await page.getByRole("button", { name: "업데이트 다운로드", exact: true }).click();
	await page.getByRole("button", { name: "재시작하여 설치", exact: true }).waitFor({ timeout: 60_000 });
	await page.getByRole("button", { name: "나중에", exact: true }).click();
	await page.getByLabel("메시지 입력", { exact: true }).fill("업데이트 중에도 작업 보호");
	await page.getByLabel("메시지 입력", { exact: true }).press("Enter");
	await page.locator(".message.assistant").waitFor();
	await page.getByRole("button", { name: "업데이트 설치 준비됨", exact: true }).click();
	await page.waitForFunction(() => document.querySelector(".update-blockers")?.textContent.includes("에이전트"));
	assert.equal(await page.getByRole("button", { name: "재시작하여 설치", exact: true }).isEnabled(), false);
	await page.screenshot({ path: join(root, "update-work-protected.png") });
	await page.getByRole("button", { name: "나중에", exact: true }).click();
	await page.getByRole("button", { name: "중단", exact: true }).click();
	await page.getByLabel("메시지 입력", { exact: true }).fill("업데이트 후에도 남아야 하는 초안");
	await page.getByRole("button", { name: "업데이트 설치 준비됨", exact: true }).click();
	await page.waitForFunction(() => !document.querySelector(".update-blockers"));
	await page.screenshot({ path: join(root, "update-ready.png") });
	await page.getByRole("button", { name: "재시작하여 설치", exact: true }).click();
	const receiptPath = join(userData, "updates/install-result.json");
	let receipt;
	for (let i = 0; i < 300; i++) {
		receipt = await readFile(receiptPath, "utf8")
			.then(JSON.parse)
			.catch(() => null);
		if (receipt) break;
		if (!page.isClosed() && i % 30 === 0) {
			const state = await page.evaluate(() => window.primeDesktop.request("update.status", undefined));
			if (state.ok && state.value.error) {
				const debug = await page.evaluate(() => window.primeDesktop.request("app.snapshot", undefined));
				throw new Error(JSON.stringify({ state, diagnostics: debug.value?.diagnostics }));
			}
		}
		await delay(300);
	}
	assert.equal(receipt?.success, true, "Installer must replace only the isolated test app and launch it");
	assert.equal(await bundleVersion(target), version);
	assert.equal(await bundleVersion(receipt.backup), baselineVersion);
	// Stop only the auto-relaunched test app by its unique executable path, then inspect restoration with Playwright.
	await delay(2000);
	const processes = (await run("/bin/ps", ["-axo", "pid=,command="])).stdout.split("\n");
	for (const line of processes) {
		const match = line.trim().match(/^(\d+) (.+)$/);
		if (match && match[2] === executablePath) process.kill(Number(match[1]), "SIGTERM");
	}
	application = undefined;
	await delay(1500);
	application = await launch();
	page = await application.firstWindow();
	await page.waitForFunction(
		() => document.querySelector(".prompt-input")?.value === "업데이트 후에도 남아야 하는 초안",
	);
	assert.equal(
		(await page.evaluate(() => window.primeDesktop.request("update.status", undefined))).value.currentVersion,
		version,
	);
	await page.locator(".message.user").filter({ hasText: "업데이트 중에도 작업 보호" }).waitFor();
	await page.screenshot({ path: join(root, "update-restored.png") });
	await writeFile(
		join(root, "report.json"),
		JSON.stringify(
			{
				passed: true,
				baseline: baselineVersion,
				installed: version,
				appPathPreserved: true,
				actualBundleReplacement: true,
				mainWorkProtected: true,
				normalQuitDoesNotInstall: true,
				draftAndConversationRestored: true,
				receipt,
				fixtureNetwork: true,
			},
			null,
			2,
		),
	);
	console.log(`Update smoke passed: ${root}`);
} catch (error) {
	if (application) {
		const page = application.windows()[0];
		if (page && !page.isClosed()) {
			await page.screenshot({ path: join(root, "failure.png") }).catch(() => {});
			await writeFile(join(root, "failure.txt"), await page.locator("body").innerText()).catch(() => {});
		}
	}
	console.error(`Update smoke artifacts: ${root}`);
	throw error;
} finally {
	if (application) await application.close().catch(() => {});
}
