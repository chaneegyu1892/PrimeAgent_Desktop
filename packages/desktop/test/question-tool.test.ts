import { describe, expect, it, vi } from "vitest";
import desktopQuestions, { askUserTool, type Question, type QuestionContext } from "../src/extension/desktop-ask-user";

function context(): QuestionContext {
	return {
		hasUI: true,
		ui: {
			select: vi.fn().mockResolvedValue("분석부터"),
			confirm: vi.fn().mockResolvedValue(false),
			input: vi.fn().mockResolvedValue("사용자 답변"),
			editor: vi.fn().mockResolvedValue("수정한 초안"),
		},
	};
}
const run = (params: Question, ctx: QuestionContext, signal?: AbortSignal) =>
	askUserTool.execute("tool-id", params, signal, undefined, ctx);

describe("bundled agent question tool", () => {
	it("registers an agent-callable sequential tool", () => {
		const registerTool = vi.fn();
		desktopQuestions({ registerTool });
		expect(registerTool).toHaveBeenCalledWith(askUserTool);
		expect(askUserTool.executionMode).toBe("sequential");
	});
	it("waits for a choice and supports a non-colliding free-text alternative", async () => {
		const ctx = context();
		vi.mocked(ctx.ui.select).mockResolvedValueOnce("직접 입력…");
		const signal = new AbortController().signal;
		expect(
			(
				await run(
					{ kind: "select", question: "어떻게 진행할까요?", options: ["직접 입력", "분석부터"] },
					ctx,
					signal,
				)
			).details,
		).toEqual({ status: "answered", answer: "사용자 답변" });
		expect(ctx.ui.select).toHaveBeenCalledWith("어떻게 진행할까요?", ["직접 입력", "분석부터", "직접 입력…"], {
			signal,
		});
		expect(ctx.ui.input).toHaveBeenCalledOnce();
	});
	it("never treats cancellation or refusal as approval", async () => {
		const ctx = context();
		expect((await run({ kind: "confirm", question: "진행할까요?" }, ctx)).details).toEqual({
			status: "not_approved",
			confirmed: false,
		});
		vi.mocked(ctx.ui.confirm).mockResolvedValueOnce(true);
		expect((await run({ kind: "confirm", question: "진행할까요?" }, ctx)).details).toEqual({
			status: "answered",
			confirmed: true,
		});
		vi.mocked(ctx.ui.select).mockResolvedValueOnce(undefined);
		expect((await run({ kind: "select", question: "방향?", options: ["분석"] }, ctx)).details).toEqual({
			status: "cancelled",
		});
		expect(ctx.ui.input).not.toHaveBeenCalled();
	});
	it("returns only submitted input/editor text, including an intentionally empty answer", async () => {
		const ctx = context();
		vi.mocked(ctx.ui.input).mockResolvedValueOnce("");
		expect((await run({ kind: "input", question: "입력?" }, ctx)).details).toEqual({
			status: "answered",
			answer: "",
		});
		expect((await run({ kind: "editor", question: "편집?", prefill: "원본" }, ctx)).details).toEqual({
			status: "answered",
			answer: "수정한 초안",
		});
		expect(ctx.ui.editor).toHaveBeenCalledWith("편집?", "원본");
	});
	it("does not ask after abort or accept a late answer after abort", async () => {
		const ctx = context();
		const controller = new AbortController();
		vi.mocked(ctx.ui.input).mockImplementationOnce(async () => {
			controller.abort();
			return "too late";
		});
		expect((await run({ kind: "input", question: "답변?" }, ctx, controller.signal)).details.status).toBe(
			"cancelled",
		);
		await run({ kind: "confirm", question: "진행?" }, ctx, controller.signal);
		expect(ctx.ui.confirm).not.toHaveBeenCalled();
	});
	it("reports missing UI and invalid selections without inventing an answer", async () => {
		const ctx = context();
		ctx.hasUI = false;
		expect((await run({ kind: "input", question: "답변?" }, ctx)).details.status).toBe("unavailable");
		expect(ctx.ui.input).not.toHaveBeenCalled();
		ctx.hasUI = true;
		await expect(run({ kind: "select", question: "선택?", options: [] }, ctx)).rejects.toThrow("Select requires");
	});
});
