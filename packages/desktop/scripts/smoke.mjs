import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import electron from "electron";
import { _electron } from "playwright";
import { verifyCapabilities } from "./capability-smoke.mjs";
import { verifyInteractions } from "./interaction-smoke.mjs";
import { preparePanels, verifyPanels } from "./panel-smoke.mjs";

const packaged = process.argv.includes("--packaged");
await mkdir(".smoke", { recursive: true });
const root = await realpath(await mkdtemp(resolve(".smoke/run-")));
const project = join(root, "fixture-project");
const userData = join(root, "user-data");
const secondProject = join(root, "reference-project");
const sessionsDir = join(root, "home/.prime/agent/sessions");
const bin = join(root, "bin");
await Promise.all([mkdir(project), mkdir(userData), mkdir(bin), mkdir(join(root, "home"))]);
await mkdir(secondProject);
await preparePanels(root, project);
await mkdir(sessionsDir, { recursive: true });
const fixtureSession = async (id, cwd, title, minutesAgo) => {
	const timestamp = Date.now() - minutesAgo * 60_000;
	await writeFile(
		join(sessionsDir, `${id}.jsonl`),
		`${[
			{ type: "session", id, cwd, timestamp: new Date(timestamp).toISOString() },
			{ type: "session_info", name: title },
			{ type: "message", message: { role: "user", content: `${title} 요청`, timestamp } },
			{
				type: "message",
				message: { role: "assistant", content: "이전에 저장한 대화입니다.", timestamp: timestamp + 1 },
			},
		]
			.map((entry) => JSON.stringify(entry))
			.join("\n")}\n`,
	);
};
await fixtureSession("saved-input", project, "입력 동작 점검", 12);
await fixtureSession("saved-layout", project, "앱 화면 다듬기", 70);
await fixtureSession("saved-notes", secondProject, "문서 정리", 40);
const fixture = join(bin, "prime-agent");
await copyFile("test/fixtures/fake-cli.mjs", fixture);
await chmod(fixture, 0o755);
await symlink(process.execPath, join(bin, "node"));
await writeFile(join(userData, "desktop-settings.json"), JSON.stringify({ cliPath: fixture, recent: [] }));
const marker = join(root, "child-closed");
const env = {
	PATH: `${bin}:/usr/bin:/bin`,
	HOME: join(root, "home"),
	TMPDIR: process.env.TMPDIR ?? "/tmp",
	LANG: "en_US.UTF-8",
	PRIME_DESKTOP_USER_DATA: userData,
	PRIME_TEST_EXIT_MARKER: marker,
	PRIME_TEST_MARKDOWN: "1",
	PRIME_TEST_REQUIRE_QUESTION_TOOL: "1",
	PRIME_TEST_UI_LOG: join(root, "ui-responses.jsonl"),
	PRIME_TEST_SESSION_DIR: sessionsDir,
	PRIME_AGENT_SESSION_DIR: sessionsDir,
};
const executablePath = packaged
	? resolve("out/Prime Desktop-darwin-arm64/Prime Desktop.app/Contents/MacOS/Prime Desktop")
	: electron;
const errors = [];
const launch = () =>
	_electron.launch({
		executablePath,
		args: packaged ? [] : ["."],
		env,
		cwd: process.cwd(),
		chromiumSandbox: true,
		timeout: 30_000,
	});
let app;
let screenshot;
try {
	app = await launch();
	const page = await app.firstWindow();
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	await page.getByRole("heading", { name: "무엇을 함께 해볼까요?" }).waitFor();
	await page.getByRole("img", { name: "Prime Intellect", exact: true }).waitFor();
	await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0));
	assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), "dark");
	await page.screenshot({ path: join(root, "branded-start.png") });
	if (packaged) {
		const contents = dirname(dirname(executablePath));
		const plist = await readFile(join(contents, "Info.plist"), "utf8");
		const iconName = plist.match(/<key>CFBundleIconFile<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
		assert.ok(iconName, "Packaged app must declare its icon");
		const icon = await readFile(join(contents, "Resources", iconName));
		assert.equal(icon.subarray(0, 4).toString(), "icns");
		assert.deepEqual(icon, await readFile("assets/prime-desktop.icns"));
	}
	const security = await page.evaluate(() => ({
		node: typeof window.require,
		process: typeof window.process,
		ipc: typeof window.ipcRenderer,
		api: Object.keys(window.primeDesktop ?? {}),
	}));
	assert.equal(security.node, "undefined");
	assert.equal(security.process, "undefined");
	assert.equal(security.ipc, "undefined");
	assert.deepEqual(security.api.sort(), ["request", "subscribe", "subscribePanel"]);
	const preferences = await app.evaluate(({ BrowserWindow }) => {
		const w = BrowserWindow.getAllWindows()[0];
		const p = w.webContents.getLastWebPreferences();
		return {
			sandbox: p.sandbox,
			contextIsolation: p.contextIsolation,
			nodeIntegration: p.nodeIntegration,
			url: w.webContents.getURL(),
		};
	});
	assert.equal(preferences.sandbox, true);
	assert.equal(preferences.contextIsolation, true);
	assert.equal(preferences.nodeIntegration, false);
	assert.equal(preferences.url, "prime-desktop://app/index.html");
	await page.waitForFunction(async () => {
		const r = await window.primeDesktop.request("app.snapshot", undefined);
		return r.ok && r.value.connection === "connected" && !r.value.initializing;
	});
	await verifyCapabilities(app, page, root);
	const general = await page.evaluate(() => window.primeDesktop.request("app.snapshot", undefined));
	assert.equal(general.value.project.kind, "personal");
	assert.equal(general.value.recent.length, 0);
	await page.getByLabel("메시지 입력", { exact: true }).fill("프로젝트 없이 아이디어 정리");
	await page.getByLabel("메시지 입력", { exact: true }).press("Enter");
	await page.locator(".message.assistant").filter({ hasText: "한글 테스트" }).waitFor();
	await page.getByRole("button", { name: "중단", exact: true }).click();
	await page.getByLabel("메시지 입력", { exact: true }).fill("일반 대화 초안");
	await page.screenshot({ path: join(root, "general-conversation.png") });
	await page.keyboard.press("Meta+n");
	await page.getByRole("heading", { name: "무엇을 함께 해볼까요?" }).waitFor();
	assert.equal(await page.getByLabel("메시지 입력", { exact: true }).inputValue(), "");
	await page.keyboard.press("Meta+k");
	await page.getByLabel("대화 검색").fill("아이디어 정리");
	const generalRow = page
		.getByRole("navigation", { name: "최근 세션" })
		.getByRole("button", { name: /프로젝트 없이 아이디어 정리/ });
	await generalRow.click();
	await page.waitForFunction(async (id) => {
		const r = await window.primeDesktop.request("app.snapshot", undefined);
		return r.ok && r.value.state?.sessionId === id;
	}, general.value.state.sessionId);
	await page.waitForFunction(() => document.querySelector(".prompt-input")?.value === "일반 대화 초안");
	assert.equal(await page.getByLabel("메시지 입력", { exact: true }).inputValue(), "일반 대화 초안");
	await page.getByRole("button", { name: "검색 지우기" }).click();
	await app.evaluate(({ dialog }, path) => {
		dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
	}, project);
	await page.getByRole("button", { name: "폴더 열기" }).click();
	await page.getByRole("heading", { name: "fixture-project" }).waitFor();
	const input = page.getByLabel("메시지 입력", { exact: true });
	await input.fill("연결 전 작성한 내용");
	await page.getByText("준비됨", { exact: true }).waitFor();
	assert.equal(await input.inputValue(), "연결 전 작성한 내용");
	const height = () => input.evaluate((element) => element.getBoundingClientRect().height);
	const initialHeight = await height();
	assert.equal(await input.evaluate((element) => getComputedStyle(element).resize), "none");
	await input.fill("첫 줄");
	await input.press("Shift+Enter");
	await input.press("A");
	assert.equal(await input.inputValue(), "첫 줄\nA");
	assert.equal(await page.locator(".message").count(), 0);
	assert.equal(await height(), initialHeight + 24);
	await input.fill(Array.from({ length: 20 }, (_, index) => `긴 입력 ${index}`).join("\n"));
	assert.equal(await height(), initialHeight + 7 * 24);
	assert.equal(await input.evaluate((element) => getComputedStyle(element).overflowY), "auto");
	await input.fill("줄바꿈 없는 긴 문장 ".repeat(100));
	assert.ok((await height()) > initialHeight);
	await input.fill("유료 호출 없는 패키지 검증");
	assert.equal(await height(), initialHeight);
	await input.press("Enter");
	await page.getByText("한글 테스트", { exact: false }).waitFor();
	assert.equal(await input.inputValue(), "");
	assert.equal(await height(), initialHeight);
	await page.getByRole("heading", { name: "프로젝트 구조", exact: true }).waitFor();
	assert.equal(await page.getByRole("table").count(), 1);
	assert.match(await page.locator(".markdown-body pre code").innerText(), /├── main/);
	await page.getByLabel("전송 방식").selectOption("steer");
	await page.getByLabel("메시지 입력", { exact: true }).fill("추가 지시 테스트");
	await page.getByRole("button", { name: "전송", exact: true }).click();
	await page.getByRole("status").filter({ hasText: "추가 지시를 전달했습니다" }).waitFor();
	await page.getByLabel("전송 방식").selectOption("followUp");
	await page.getByLabel("메시지 입력", { exact: true }).fill("후속 작업 테스트");
	await page.getByRole("button", { name: "전송", exact: true }).click();
	await page.getByRole("status").filter({ hasText: "후속 작업을 전달했습니다" }).waitFor();
	await page.getByRole("button", { name: "중단", exact: true }).click();
	await page.getByText("Prime Agent 실행 중", { exact: true }).waitFor({ state: "hidden" });
	assert.equal(await page.locator(".message").count(), 2);
	assert.equal(await page.locator(".activity-item").count(), 1);
	await page.getByLabel("전송 방식").selectOption("prompt");
	await page.getByLabel("메시지 입력", { exact: true }).fill("다음 요청 준비");
	assert.equal(await page.getByRole("button", { name: "전송", exact: true }).isEnabled(), true);
	const snapshot = await page.evaluate(async () => window.primeDesktop.request("app.snapshot", undefined));
	assert.equal(snapshot.ok, true);
	assert.equal(snapshot.value.project.path, project);
	assert.equal(JSON.stringify(snapshot).includes("should-never-reach-renderer"), false);
	const blocked = await page.evaluate(async () => {
		try {
			await window.primeDesktop.request("agent.bash", { command: "bad" });
			return false;
		} catch {
			return true;
		}
	});
	assert.equal(blocked, true);
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 740));
	await page.waitForFunction(() => innerWidth === 980);
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
	await input.fill("창 너비에 맞춰 자동으로 줄이 바뀌는 입력입니다. ".repeat(12));
	assert.ok((await height()) <= initialHeight + 7 * 24);
	assert.equal(await page.getByRole("button", { name: "전송", exact: true }).isVisible(), true);
	await page.screenshot({ path: join(root, "compact-composer.png") });
	await input.fill("다음 요청 준비");
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1320, 880));
	await page.waitForFunction(() => innerWidth === 1320);
	screenshot = join(root, packaged ? "packaged-conversation.png" : "development-conversation.png");
	await page.locator(".conversation").evaluate((element) => {
		element.scrollTop = 0;
	});
	await page.screenshot({ path: screenshot });
	await page.getByRole("button", { name: "실행 내역", exact: true }).click();
	await page.getByRole("heading", { name: "실행 내역", exact: true }).waitFor();
	await page.screenshot({ path: join(root, "activity-panel.png") });
	await page.getByRole("button", { name: "실행 내역 닫기" }).click();
	await page.getByRole("button", { name: "프로젝트 목록", exact: true }).click();
	assert.equal(await input.inputValue(), "다음 요청 준비");
	await page.getByRole("button", { name: "프로젝트 목록", exact: true }).click();
	await page.getByRole("button", { name: "설정", exact: true }).click();
	await page.getByLabel("전송 단축키", { exact: true }).selectOption("modifierEnter");
	await page.getByRole("button", { name: "모델 목록 불러오기" }).click();
	await page.getByLabel("모델", { exact: true }).waitFor();
	await page.getByLabel("Thinking level", { exact: true }).selectOption("medium");
	await page.getByRole("button", { name: "닫기", exact: true }).click();
	await input.fill("단축키 확인");
	await input.press("Enter");
	assert.equal(await input.inputValue(), "단축키 확인\n");
	await input.fill("");
	await page.getByText("Offline fixture · medium", { exact: true }).waitFor();
	await page.getByRole("button", { name: "새 세션", exact: true }).click();
	await page.getByRole("heading", { name: "무엇을 함께 해볼까요?" }).waitFor();
	const sessionFile = join(project, "saved.jsonl");
	await writeFile(sessionFile, `${JSON.stringify({ type: "session", id: "saved", cwd: project })}\n`);
	await app.evaluate(({ dialog }, path) => {
		dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
	}, sessionFile);
	await page.getByRole("button", { name: "세션 열기", exact: true }).click();
	await page.getByRole("button", { name: "실행 내역", exact: true }).click();
	await page.getByText("saved", { exact: true }).waitFor();
	await page.getByRole("button", { name: "실행 내역 닫기" }).click();
	await app.evaluate(({ dialog }, path) => {
		dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
	}, secondProject);
	await page.getByRole("button", { name: "폴더 열기", exact: true }).click();
	await page.getByRole("heading", { name: "reference-project", exact: true }).waitFor();
	const recent = page.getByRole("navigation", { name: "최근 세션", exact: true });
	await recent.getByRole("button", { name: /문서 정리/ }).click();
	await page.getByText("준비됨", { exact: true }).waitFor();
	await page.locator(".message.assistant").filter({ hasText: "이전에 저장한 대화입니다." }).waitFor();
	await recent.getByRole("button", { name: /입력 동작 점검/ }).click();
	await page.getByRole("heading", { name: "fixture-project", exact: true }).waitFor();
	await page.locator(".message.assistant").filter({ hasText: "이전에 저장한 대화입니다." }).waitFor();
	assert.equal(await page.locator(".project-group").count(), 2);
	const resumed = await page.evaluate(() => window.primeDesktop.request("app.snapshot", undefined));
	assert.equal(resumed.value.state.sessionId, "saved-input");
	assert.equal(resumed.value.project.path, project);
	await page.getByRole("button", { name: "fixture-project 세션 접기" }).click();
	assert.equal(
		await page
			.getByRole("navigation", { name: "프로젝트별 세션" })
			.getByRole("button", { name: /입력 동작 점검/ })
			.count(),
		0,
	);
	await page.getByRole("button", { name: "fixture-project 세션 펼치기" }).click();
	const attachmentImage = join(project, "design.png");
	const attachmentDoc = join(project, "requirements.txt");
	const imageBytes = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4fcAAAAASUVORK5CYII=",
		"base64",
	);
	await writeFile(attachmentImage, imageBytes);
	await writeFile(attachmentDoc, "Offline attachment fixture");
	await app.evaluate(
		({ dialog }, paths) => {
			dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
		},
		[attachmentImage, attachmentDoc],
	);
	await page.getByRole("button", { name: "파일 첨부" }).click();
	await page.getByText("design.png", { exact: true }).waitFor();
	await page.getByText("requirements.txt", { exact: true }).waitFor();
	await input.fill("첨부한 디자인과 요구사항을 확인해줘");
	await page.screenshot({ path: join(root, "sidebar-and-attachments.png") });
	await recent.getByRole("button", { name: /문서 정리/ }).click();
	await page.getByRole("heading", { name: "reference-project", exact: true }).waitFor();
	assert.equal(await input.inputValue(), "");
	assert.equal(await page.locator(".attachment-chip").count(), 0);
	await recent.getByRole("button", { name: /입력 동작 점검/ }).click();
	await page.getByRole("heading", { name: "fixture-project", exact: true }).waitFor();
	await page.getByText("design.png", { exact: true }).waitFor();
	assert.equal(await input.inputValue(), "첨부한 디자인과 요구사항을 확인해줘");
	await page.getByRole("button", { name: "requirements.txt 첨부 제거" }).click();
	await page.getByText("requirements.txt", { exact: true }).waitFor({ state: "hidden" });
	await app.evaluate(({ dialog }, path) => {
		dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
	}, attachmentDoc);
	await page.getByRole("button", { name: "파일 첨부" }).click();
	await page.getByText("requirements.txt", { exact: true }).waitFor();
	await input.fill("");
	await input.press("Meta+Enter");
	await page.waitForFunction(() => document.querySelectorAll(".attachment-chip").length === 0);
	await page.locator(".message.user").filter({ hasText: "requirements.txt" }).waitFor();
	await page.getByRole("button", { name: "중단", exact: true }).click();
	await page.getByText("Prime Agent 실행 중", { exact: true }).waitFor({ state: "hidden" });
	const persistedEntries = (await readFile(join(sessionsDir, "saved-input.jsonl"), "utf8"))
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	const imageMessage = persistedEntries.findLast((entry) => entry.type === "message" && entry.message.role === "user");
	assert.ok(imageMessage.message.content.some((part) => part.type === "text" && part.text.includes(attachmentDoc)));
	assert.ok(
		imageMessage.message.content.some((part) => part.type === "image" && part.data === imageBytes.toString("base64")),
	);
	await verifyPanels(page, app, root, project);
	await verifyInteractions(page, root, project);
	await input.fill("다시 열면 남는 초안");
	const beforeRestart = await page.evaluate(() => window.primeDesktop.request("app.snapshot", undefined));
	await app.close();
	app = undefined;
	assert.equal(await readFile(marker, "utf8"), "closed");
	app = await launch();
	const reopened = await app.firstWindow();
	await reopened
		.getByRole("button", { name: /^fixture-project/ })
		.first()
		.waitFor();
	await reopened.waitForFunction(async () => {
		const r = await window.primeDesktop.request("app.snapshot", undefined);
		return r.ok && r.value.connection === "connected" && !r.value.initializing;
	});
	const restored = await reopened.evaluate(async () => window.primeDesktop.request("app.snapshot", undefined));
	assert.ok(restored.value.recent.some((entry) => entry.path === project));
	const restoredSessions = await reopened.evaluate(() => window.primeDesktop.request("session.list", undefined));
	assert.ok(restoredSessions.ok && restoredSessions.value.some((entry) => entry.id === "saved-input"));
	assert.equal(restored.value.connection, "connected");
	assert.equal(restored.value.state.sessionId, beforeRestart.value.state.sessionId);
	await reopened.waitForFunction(() => document.querySelector(".prompt-input")?.value === "다시 열면 남는 초안");
	assert.equal(await reopened.getByLabel("메시지 입력", { exact: true }).inputValue(), "다시 열면 남는 초안");
	await reopened.screenshot({ path: join(root, "restored-conversation.png") });
	await reopened.getByRole("button", { name: "설정", exact: true }).click();
	assert.equal(await reopened.getByLabel("전송 단축키", { exact: true }).inputValue(), "modifierEnter");
	assert.deepEqual(errors, []);
	const report = {
		passed: true,
		packaged,
		executablePath,
		screenshot,
		security,
		preferences,
		scenarios: [
			"15 bundled Skills: browse/read/toggle/apply; local plugin import/enable and real stdio MCP discovery",
			"automatic startup without a project, general conversations, title search and configurable navigation shortcuts",
			"general/project draft isolation, last conversation restoration and persisted text drafts",
			"select/confirm/decline/input/editor replies, cancel, expiry and simultaneous abort",
			"automatic steering, hidden-side-chat attention, and crash/reconnect session restore",
			"five-tool panel, collapse, expand, bottom dock and compact layout",
			"project file preview and Git diff",
			"native PTY command, retained shell, stop and restart",
			"Aside CLI adapter with offline tab/read/open fixture",
			"independent side chat send, abort, new session and main conversation isolation",
			"folder selection through native-dialog result",
			"RPC readiness",
			"official SVG logos load offline and dark theme renders",
			"packaged ICNS matches the generated official-symbol icon",
			"Enter send and Shift+Enter newline",
			"one-line growth, eight-line cap, long text wrapping and shrink after send",
			"collapsible panels preserve draft",
			"compact window layout and input reflow",
			"send shortcut preference persists after restart",
			"Unicode streaming",
			"Markdown headings, tables and code blocks",
			"next prompt enabled after abort",
			"steer",
			"follow-up",
			"abort",
			"model catalog redaction",
			"thinking selection",
			"new session",
			"resume file",
			"IPC rejection",
			"owned child EOF cleanup",
			"recent-project persistence",
			"saved sessions grouped by project and sorted in recent",
			"cross-project session resume and per-session draft isolation",
			"native file selection, attachment removal and attachment-only send",
			"image bytes and document path received by offline CLI",
			"session catalog persists across app restart",
		],
	};
	await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report, null, 2));
} catch (error) {
	if (app) {
		const windows = app.windows();
		if (windows[0]) {
			await windows[0].screenshot({ path: join(root, "failure.png") }).catch(() => {});
			await writeFile(join(root, "failure.txt"), await windows[0].locator("body").innerText()).catch(() => {});
		}
	}
	console.error(`Smoke artifacts: ${root}`);
	throw error;
} finally {
	if (app) await app.close();
}
