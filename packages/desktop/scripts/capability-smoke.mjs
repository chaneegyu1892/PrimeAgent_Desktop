import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
export async function verifyCapabilities(app, page, root) {
	await page.getByRole("button", { name: "확장 라이브러리", exact: true }).click();
	const library = page.getByRole("dialog", { name: "확장 라이브러리" });
	await library.getByRole("heading", { name: "작업을 위한 기본 Skills" }).waitFor();
	await page.waitForFunction(() => document.querySelectorAll(".capability-library .skill-tile").length === 32);
	assert.equal(await library.locator(".skill-tile").count(), 32);
	await page.screenshot({ path: join(root, "capability-skills.png") });
	await library.getByLabel("확장 검색").fill("코딩");
	await library
		.locator(".skill-tile")
		.filter({ hasText: "코딩과 구현" })
		.getByRole("button", { name: "내용 보기", exact: true })
		.click();
	await library.getByRole("heading", { name: "코딩과 구현", exact: true }).first().waitFor();
	await library
		.locator(".skill-document")
		.getByText(/repository/, { exact: false })
		.first()
		.waitFor();
	await library.getByRole("button", { name: "← Skills 목록" }).click();
	await library.getByLabel("코딩과 구현 활성화").click();
	await page.waitForFunction(() => !document.querySelector('input[aria-label="코딩과 구현 활성화"]')?.checked);
	await library.getByRole("button", { name: "지금 적용" }).waitFor();
	await library.getByLabel("코딩과 구현 활성화").click();
	await page.waitForFunction(() => document.querySelector('input[aria-label="코딩과 구현 활성화"]')?.checked);
	await library.getByRole("button", { name: "지금 적용" }).click();
	await library.getByText(/현재 대화에 변경을 적용했습니다/).waitFor();
	await library.getByRole("button", { name: /MCP 연결/ }).click();
	await page.screenshot({ path: join(root, "capability-mcp-catalog.png") });
	await library.getByRole("button", { name: "직접 연결", exact: true }).click();
	await library.getByLabel("연결 이름", { exact: true }).fill("검증용 로컬 MCP");
	await library.getByLabel("연결 ID", { exact: true }).fill("offline-fixture");
	await library.getByLabel("연결 방식", { exact: true }).selectOption("stdio");
	await library.getByLabel("실행 파일", { exact: true }).fill(process.execPath);
	await library
		.getByLabel("명령 인자", { exact: true })
		.fill(JSON.stringify([resolve("test/fixtures/mcp-server.mjs")]));
	await library.getByRole("button", { name: "연결 저장", exact: true }).click();
	const row = library.locator(".connection-row").filter({ hasText: "검증용 로컬 MCP" });
	await row.getByRole("button", { name: "연결 검사", exact: true }).click();
	await library.getByRole("heading", { name: "검증용 로컬 MCP · 도구 2개" }).waitFor();
	await page.screenshot({ path: join(root, "capability-mcp-tools.png") });
	await library.getByRole("button", { name: "← MCP 연결" }).click();
	await library
		.getByRole("button", { name: /플러그인/ })
		.first()
		.click();
	const plugin = join(root, "plugin");
	await mkdir(join(plugin, "skill"), { recursive: true });
	await writeFile(
		join(plugin, "package.json"),
		JSON.stringify({ name: "검증용 플러그인", version: "1.0.0", pi: { skills: ["skill"] } }),
	);
	await writeFile(
		join(plugin, "skill/SKILL.md"),
		"---\nname: smoke-plugin-skill\ndescription: Offline import verification\n---\nVerify the local file.",
	);
	await app.evaluate(({ dialog }, folder) => {
		dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
	}, plugin);
	await library.getByRole("button", { name: "폴더에서 가져오기", exact: true }).click();
	await library.getByText("검증용 플러그인", { exact: true }).waitFor();
	await page.screenshot({ path: join(root, "capability-plugins.png") });
	await library.getByRole("button", { name: "내용을 검토했으며 켜기", exact: true }).click();
	await library.getByRole("button", { name: "지금 적용", exact: true }).click();
	await library.getByText(/현재 대화에 변경을 적용했습니다/).waitFor();
	await library.getByRole("button", { name: "라이브러리 닫기", exact: true }).click();
}
