import assert from "node:assert/strict";
import { join } from "node:path";
import { waitForAsync } from "./smoke-wait.mjs";

const request = async (page, name, input) => {
	const result = await page.evaluate(([name, input]) => window.primeDesktop.request(name, input), [name, input]);
	assert.ok(result.ok, result.error);
	return result.value;
};
const status = (page, id, expected) =>
	waitForAsync(
		page,
		async ([id, expected]) => {
			const result = await window.primeDesktop.request("harness.list", undefined);
			return result.ok && result.value.tasks.find((task) => task.id === id)?.status === expected;
		},
		[id, expected],
	);

export async function verifyHarness(page, root, projectPath) {
	const before = await request(page, "app.snapshot", undefined);
	await page.keyboard.press("Meta+Shift+j");
	const panel = page.getByRole("complementary", { name: "작업 패널", exact: true });
	await panel.getByRole("button", { name: "새 작업", exact: true }).click();
	await panel.getByLabel("작업 이름", { exact: true }).fill("백그라운드 검증");
	await panel.getByLabel("작업 요청 내용").fill("[interaction:confirm]");
	await panel.getByLabel("작업 완료 기준").fill("사용자 답변을 받은 뒤 종료");
	await panel.getByRole("button", { name: "작업 등록", exact: true }).click();
	await waitForAsync(page, async () => {
		const result = await window.primeDesktop.request("harness.list", undefined);
		return result.ok && result.value.tasks.length === 1;
	});
	const task = (await request(page, "harness.list", undefined)).tasks[0];
	await status(page, task.id, "waiting");
	await panel.getByRole("region", { name: "작업 확인 · confirm" }).waitFor();
	await page.screenshot({ path: join(root, "harness-question.png") });
	await panel.getByRole("button", { name: "작업 패널 닫기" }).click();
	assert.equal((await request(page, "harness.detail", { id: task.id })).task.status, "waiting");
	const updates = await request(page, "update.status", undefined);
	assert.ok(updates.blockers.some((text) => text.includes("에이전트 작업")));
	const workerSession = (await request(page, "harness.detail", { id: task.id })).task.sessionFile;
	assert.ok(!(await request(page, "session.list", undefined)).some((session) => session.path === workerSession));
	await page.keyboard.press("Meta+Shift+j");
	await panel.getByLabel("작업 중 추가 지시").fill("답변에 따라 진행해 주세요");
	await panel.getByRole("button", { name: "지시 보내기" }).click();
	await panel
		.getByRole("region", { name: "작업 확인 · confirm" })
		.getByRole("button", { name: "승인", exact: true })
		.click();
	await status(page, task.id, "completed");
	const spec = {
		title: "선행 결과 검증",
		prompt: "Offline evidence",
		role: "verify",
		criteria: "Return offline result",
		dependencies: [task.id],
		projectPath,
	};
	const next = (await request(page, "harness.create", spec)).tasks.at(-1);
	await status(page, next.id, "completed");
	await panel.locator(".task-row").filter({ hasText: "선행 결과 검증" }).click();
	await panel.getByRole("button", { name: "대화에서 결과 검토" }).click();
	assert.match(await page.getByLabel("메시지 입력", { exact: true }).inputValue(), /선행 결과 검증/);
	assert.equal((await request(page, "app.snapshot", undefined)).state.sessionId, before.state.sessionId);

	await panel.getByRole("button", { name: "프로젝트 기억", exact: true }).click();
	await panel.getByLabel("기억 제목").fill("검증 규칙");
	await panel.getByLabel("기억 내용").fill("검증 결과를 기록한다");
	await panel.getByLabel("근거·출처").fill("offline fixture");
	await panel.getByRole("button", { name: "기억 저장" }).click();
	const memory = panel.locator(".project-memory details").filter({ hasText: "검증 규칙" });
	await memory.locator("summary").click();
	await memory.getByRole("button", { name: "편집", exact: true }).click();
	await panel.getByLabel("기억 내용").fill("변경한 검증 규칙");
	await panel.getByRole("button", { name: "기억 저장" }).click();
	await memory.getByText("변경한 검증 규칙", { exact: true }).waitFor();
	await memory.getByRole("button", { name: "잊기", exact: true }).click();
	await memory.waitFor({ state: "hidden" });
	await request(page, "harness.memorySave", {
		projectPath,
		key: "복원 기억",
		content: "재시작 후 유지",
		source: "offline fixture",
	});
	await panel.getByRole("button", { name: "프로젝트 기억", exact: true }).click();
	await page.screenshot({ path: join(root, "harness-tasks.png") });
	const held = (
		await request(page, "harness.create", {
			...spec,
			title: "취소 검증",
			prompt: "[interaction:confirm]",
			dependencies: [],
		})
	).tasks.at(-1);
	await status(page, held.id, "waiting");
	await request(page, "harness.cancel", { id: held.id });
	await status(page, held.id, "cancelled");
	const interrupted = (
		await request(page, "harness.create", {
			...spec,
			title: "복원 검증",
			prompt: "[interaction:confirm]",
			dependencies: [],
		})
	).tasks.at(-1);
	await status(page, interrupted.id, "waiting");
	await panel.getByRole("button", { name: "작업 패널 닫기" }).click();
	return { completed: next.id, interrupted: interrupted.id };
}

export async function verifyHarnessRestored(page, saved, projectPath) {
	const restored = await request(page, "harness.list", undefined);
	assert.equal(restored.config.paused, true);
	assert.equal(restored.tasks.find((task) => task.id === saved.completed).status, "completed");
	const interrupted = restored.tasks.find((task) => task.id === saved.interrupted);
	assert.equal(interrupted.status, "interrupted");
	assert.equal(interrupted.attempt, 1);
	assert.equal((await request(page, "harness.detail", { id: saved.interrupted })).snapshot, null);
	assert.deepEqual(
		(await request(page, "harness.memoryList", { projectPath, query: "복원" })).map((entry) => entry.content),
		["재시작 후 유지"],
	);
}
