import { describe, expect, it } from "vitest";
import { modelInfo, projectMessage, projectState } from "../src/main/agent/projection";
import { Redactor } from "../src/main/agent/redaction";
import { validateRequest } from "../src/shared/ipc-contract";

describe("renderer data boundary", () => {
	it("never projects model credentials or request headers", () => {
		const input = {
			id: "test",
			provider: "fake",
			name: "Test",
			headers: { authorization: "secret" },
			apiKey: "secret",
			baseUrl: "https://secret@host",
		};
		expect(Object.keys(modelInfo(input)!)).toEqual(["id", "provider", "name", "reasoning"]);
		expect(
			JSON.stringify(projectState({ sessionId: "id", isStreaming: false, model: input }, new Redactor({}))),
		).not.toContain("secret");
	});
	it("strips metadata and redacts known tokens in messages and errors", () => {
		const redact = new Redactor({ EXAMPLE_TOKEN: "FAKE_PRIVATE_VALUE" });
		const message = projectMessage(
			{
				role: "assistant",
				content: "FAKE_PRIVATE_VALUE",
				errorMessage: "Authorization: Bearer abcdefghijk",
				credentials: "secret",
				contentSignature: "private",
			},
			redact,
		);
		expect(message?.content).toBe("[REDACTED]");
		expect(message?.error).not.toContain("abcdefghijk");
		expect(JSON.stringify(message)).not.toContain("private");
	});
	it.each(["fs.read", "__proto__", "constructor", "agent.bash"])("rejects arbitrary IPC: %s", (name) =>
		expect(() => validateRequest(name, undefined)).toThrow(),
	);
	it("validates bounded arguments and rejects extra fields", () => {
		expect(() => validateRequest("agent.prompt", { message: "hello" })).not.toThrow();
		for (const input of [
			{ message: "" },
			{ message: "x", shell: true },
			{ message: "x".repeat(100_001) },
			{ message: "a\0b" },
			null,
		])
			expect(() => validateRequest("agent.prompt", input)).toThrow();
		expect(() => validateRequest("agent.abort", { path: "/" })).toThrow();
		expect(() => validateRequest("model.setThinkingLevel", { level: "made-up" })).toThrow();
	});
});
