import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
export async function verifyInteractions(page, root, project) {
	const main = page.locator("main.workspace");
	const input = page.getByLabel("메시지 입력", { exact: true });
	const request = async (name, input) => {
		const result = await page.evaluate(([name, input]) => window.primeDesktop.request(name, input), [name, input]);
		assert.ok(result.ok, result.error);
		return result.value;
	};
	await page.getByLabel("전송 방식", { exact: true }).selectOption("prompt");
	await input.fill("[interaction:all]");
	await input.press("Meta+Enter");
	const select = main.getByRole("region", { name: "작업 확인 · select" });
	await select.getByRole("button", { name: "원인부터 분석" }).waitFor();
	await input.fill("본 요청의 초안은 유지");
	await page
		.getByRole("navigation", { name: "답변 대기 알림" })
		.getByRole("button", { name: /본 대화/ })
		.click();
	await select.scrollIntoViewIfNeeded();
	await page.screenshot({ path: join(root, "interaction-select.png") });
	await select.getByRole("button", { name: "원인부터 분석" }).click();
	const confirm = main.getByRole("region", { name: "작업 확인 · confirm" });
	await confirm.getByRole("button", { name: "거절", exact: true }).click();
	const question = main.getByRole("region", { name: "작업 확인 · input" });
	await question.getByLabel("답변 입력").fill("한글 답변 — 사용자 선택");
	await question.getByRole("button", { name: "답변 보내기" }).click();
	const editor = main.getByRole("region", { name: "작업 확인 · editor" });
	assert.equal(await editor.getByLabel("내용 편집").inputValue(), "기존 초안");
	await editor.getByLabel("내용 편집").fill("수정한 계획\n둘째 줄");
	await editor.getByRole("button", { name: "답변 보내기" }).click();
	await main.locator(".flow-status").filter({ hasText: "작업 완료" }).waitFor();
	assert.equal(await input.inputValue(), "본 요청의 초안은 유지");
	assert.equal(await main.locator(".interaction-card.answered").count(), 4);
	const logs = (await readFile(join(root, "ui-responses.jsonl"), "utf8"))
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	assert.deepEqual(
		logs.slice(0, 4).map((entry) => entry.value ?? entry.confirmed),
		["원인부터 분석", false, "한글 답변 — 사용자 선택", "수정한 계획\n둘째 줄"],
	);
	await page.screenshot({ path: join(root, "interaction-completed.png") });
	await input.fill("[interaction:confirm]");
	await input.press("Meta+Enter");
	await main.locator(".interaction-card.pending").getByRole("button", { name: "승인", exact: true }).click();
	await main.locator(".flow-status").filter({ hasText: "작업 완료" }).waitFor();
	await input.fill("[interaction:input]");
	await input.press("Meta+Enter");
	await main.locator(".interaction-card.pending").getByRole("button", { name: "요청 취소" }).click();
	await main.locator(".interaction-card.cancelled").waitFor();
	await main.locator(".flow-status").filter({ hasText: "작업 완료" }).waitFor();
	await input.fill("[interaction:timeout]");
	await input.press("Meta+Enter");
	await main.locator(".interaction-card.expired").waitFor();
	await main.locator(".flow-status").filter({ hasText: "작업 완료" }).waitFor();
	await input.fill("[interaction:parallel]");
	await input.press("Meta+Enter");
	await main.locator(".interaction-card.pending").first().waitFor();
	await main.getByRole("button", { name: "중단", exact: true }).click();
	await main.locator(".flow-status").filter({ hasText: "작업 중단됨" }).waitFor();
	assert.equal(await main.locator(".interaction-card.pending").count(), 0);
	await input.fill("일반 작업 시작");
	await input.press("Meta+Enter");
	await main.locator(".flow-status").filter({ hasText: "Prime Agent 실행 중" }).waitFor();
	await input.fill("실행 중 자동 추가 지시");
	await input.press("Meta+Enter");
	await page.getByRole("status").filter({ hasText: "추가 지시를 전달했습니다" }).waitFor();
	await main.getByRole("button", { name: "중단", exact: true }).click();
	await main.locator(".flow-status").filter({ hasText: "작업 중단됨" }).waitFor();
	const before = await request("app.snapshot", undefined);
	await page.keyboard.press("Alt+Meta+s");
	const side = page.getByRole("complementary", { name: "작업 패널", exact: true });
	await side.getByLabel("사이드 채팅 메시지", { exact: true }).fill("[interaction:confirm]");
	await side.getByLabel("사이드 채팅 메시지", { exact: true }).press("Meta+Enter");
	await side.getByRole("region", { name: "작업 확인 · confirm" }).waitFor();
	await side.getByRole("button", { name: "작업 패널 닫기" }).click();
	await page
		.getByRole("navigation", { name: "답변 대기 알림" })
		.getByRole("button", { name: /사이드 채팅/ })
		.click();
	const dialog = page.getByRole("dialog", { name: "사이드 채팅 답변" });
	await dialog.getByRole("button", { name: "승인", exact: true }).click();
	await dialog.getByText("응답 전달됨", { exact: true }).waitFor();
	await page.screenshot({ path: join(root, "side-interaction.png") });
	await dialog.getByRole("button", { name: "닫기", exact: true }).click();
	const after = await request("app.snapshot", undefined);
	assert.equal(after.state.sessionId, before.state.sessionId);
	assert.deepEqual(after.interactions, before.interactions);
	await input.fill("[interaction:crash]");
	await input.press("Meta+Enter");
	await main.getByRole("button", { name: "다시 연결", exact: true }).waitFor();
	assert.equal(await main.locator(".interaction-card.pending").count(), 0);
	await main.getByRole("button", { name: "다시 연결", exact: true }).click();
	await page.getByText("준비됨", { exact: true }).waitFor();
	const restored = await request("app.snapshot", undefined);
	assert.equal(restored.state.sessionId, before.state.sessionId);
	assert.equal(restored.interactions.length, 0);
	assert.equal(restored.project.path, project);
	assert.ok(restored.messages.some((message) => message.content === "[interaction:crash]"));
}
