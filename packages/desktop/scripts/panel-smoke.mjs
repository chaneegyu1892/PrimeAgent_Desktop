import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

export async function preparePanels(root, project) {
	const git = (...args) => promisify(execFile)("/usr/bin/git", ["-C", project, ...args]);
	await git("init", "-q");
	await writeFile(join(project, "hello.txt"), "Original content\n");
	await git("add", "hello.txt");
	await git(
		"-c",
		"user.name=Offline Test",
		"-c",
		"user.email=test@example.invalid",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"-qm",
		"Fixture",
	);
	await writeFile(join(project, "hello.txt"), "Updated panel content\n");
	const bin = join(root, "home/.local/bin");
	await mkdir(bin, { recursive: true });
	await writeFile(
		join(bin, "aside"),
		`#!/usr/bin/env node
const code = process.argv.at(-1);
const result = code.includes('listBrowserTabs') ? [{id:'fixture-tab',title:'Offline browser fixture',url:'https://example.invalid/',active:true}] : code.includes('attachBrowserTab') ? 'Offline page content for panel verification' : null;
console.log('PRIME_PANEL_JSON:' + JSON.stringify(result));
`,
	);
	await chmod(join(bin, "aside"), 0o755);
}

export async function verifyPanels(page, app, root, project) {
	const request = async (name, input) => {
		const result = await page.evaluate(([name, input]) => window.primeDesktop.request(name, input), [name, input]);
		assert.ok(result.ok, result.error);
		return result.value;
	};
	const mainInput = page.getByLabel("메시지 입력", { exact: true });
	await mainInput.fill("본 대화 초안 유지");
	const before = await request("app.snapshot", undefined);
	await page.getByRole("button", { name: "작업 패널", exact: true }).click();
	const panel = page.getByRole("complementary", { name: "작업 패널", exact: true });
	assert.equal(await panel.locator(".panel-launch").count(), 5);
	await page.screenshot({ path: join(root, "workspace-panel.png") });
	await panel.getByRole("button", { name: "패널을 아래로 이동" }).click();
	assert.equal(await page.locator(".tools-bottom").count(), 1);
	await panel.getByRole("button", { name: "패널 확대" }).click();
	assert.equal(await mainInput.isVisible(), false);
	await panel.getByRole("button", { name: "패널 크기 복원" }).click();
	assert.equal(await mainInput.isVisible(), true);
	await panel.getByRole("button", { name: "패널을 오른쪽으로 이동" }).click();
	await panel.getByRole("button", { name: "작업 패널 닫기" }).click();
	assert.equal(await mainInput.inputValue(), "본 대화 초안 유지");
	await page.keyboard.press("Meta+p");
	await panel.getByRole("button", { name: "hello.txt", exact: true }).click();
	await panel.getByText("Updated panel content", { exact: true }).waitFor();
	await panel.getByRole("button", { name: "대화에 넣기" }).click();
	assert.ok((await mainInput.inputValue()).includes(join(project, "hello.txt")));
	await panel
		.getByRole("navigation", { name: "패널 도구" })
		.getByRole("button", { name: "검토", exact: true })
		.click();
	await panel.locator(".diff-preview").filter({ hasText: "+Updated panel content" }).waitFor();
	await page.screenshot({ path: join(root, "review-panel.png") });
	await panel
		.getByRole("navigation", { name: "패널 도구" })
		.getByRole("button", { name: "터미널", exact: true })
		.click();
	await panel.getByText("zsh · 실행 중", { exact: true }).waitFor();
	assert.match(
		await panel.locator(".xterm-rows").evaluate((element) => getComputedStyle(element).fontFamily),
		/SFMono|Menlo/,
	);
	await panel.locator(".xterm-helper-textarea").focus();
	await page.keyboard.type("printf '\\nPANEL_PTY_OK:%s\\n' \"$PWD\"");
	await page.keyboard.press("Enter");
	await page.waitForFunction(async (projectPath) => {
		const result = await window.primeDesktop.request("panel.terminalOpen", { projectPath });
		return result.ok && result.value.output.includes(`PANEL_PTY_OK:${projectPath}`);
	}, project);
	const terminal = await request("panel.terminalOpen", { projectPath: project });
	await panel.getByRole("button", { name: "작업 패널 닫기" }).click();
	await page.getByRole("button", { name: "작업 패널", exact: true }).click();
	assert.equal((await request("panel.terminalOpen", { projectPath: project })).id, terminal.id);
	await panel.getByRole("button", { name: "패널을 아래로 이동" }).click();
	await page.screenshot({ path: join(root, "terminal-panel.png") });
	await panel.getByRole("button", { name: "패널을 오른쪽으로 이동" }).click();
	await panel.getByRole("button", { name: "터미널 종료" }).click();
	await panel.getByText("zsh · 종료됨", { exact: true }).waitFor();
	await panel.getByRole("button", { name: "새 터미널" }).click();
	await panel.getByText("zsh · 실행 중", { exact: true }).waitFor();
	assert.notEqual((await request("panel.terminalOpen", { projectPath: project })).id, terminal.id);
	await page.keyboard.press("Meta+t");
	await panel.getByRole("button", { name: /Offline browser fixture/ }).click();
	await panel.getByText("Offline page content for panel verification", { exact: true }).waitFor();
	await panel.getByRole("region", { name: "페이지 내용" }).getByRole("button", { name: "대화에 넣기" }).click();
	assert.ok((await mainInput.inputValue()).includes("Offline page content"));
	await panel.getByLabel("웹 주소").fill("https://example.invalid/test");
	await panel.getByRole("button", { name: "열기", exact: true }).click();
	await panel.getByRole("button", { name: /Offline browser fixture/ }).waitFor();
	assert.equal(await panel.getByRole("alert").count(), 0);
	await page.keyboard.press("Alt+Meta+s");
	const sideInput = panel.getByLabel("사이드 채팅 메시지", { exact: true });
	await sideInput.fill("독립된 사이드 질문");
	await sideInput.press("Meta+Enter");
	await panel.locator(".side-message.assistant").filter({ hasText: "한글 테스트" }).waitFor();
	await panel.getByRole("button", { name: "사이드 채팅 중단" }).click();
	await panel.locator(".flow-status").filter({ hasText: "작업 중단됨" }).waitFor();
	const side = await request("panel.chatState", { projectPath: project });
	const after = await request("app.snapshot", undefined);
	assert.notEqual(side.state.sessionId, before.state.sessionId);
	assert.deepEqual(after.messages, before.messages);
	assert.equal(after.state.sessionId, before.state.sessionId);
	await page.screenshot({ path: join(root, "side-chat-panel.png") });
	await panel.getByRole("button", { name: "새 사이드 채팅" }).click();
	await panel.getByRole("heading", { name: "옆에서 이어가는 대화" }).waitFor();
	await panel.getByRole("button", { name: "작업 패널 닫기" }).click();
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 740));
	await page.getByRole("button", { name: "작업 패널", exact: true }).click();
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
	await page.screenshot({ path: join(root, "compact-panel.png") });
	await panel.getByRole("button", { name: "작업 패널 닫기" }).click();
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1320, 880));
}
