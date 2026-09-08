import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentManager } from "../src/main/agent/agent-manager";
import type { RpcCommand } from "../src/main/agent/agent-transport";
import { InteractionStore } from "../src/main/agent/interaction-store";
import { Redactor } from "../src/main/agent/redaction";
import { RpcAgentTransport } from "../src/main/agent/rpc-agent-transport";
import { SettingsStore } from "../src/main/settings/settings-store";
import { validateRequest } from "../src/shared/ipc-contract";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function setup(mode = "") {
	const dir = await mkdtemp(join(tmpdir(), "prime-interaction-"));
	const manager = new AgentManager(
		new SettingsStore(join(dir, "settings.json")),
		async () =>
			new RpcAgentTransport(
				{
					executable: process.execPath,
					args: [resolve("test/fixtures/fake-cli.mjs")],
					env: { PATH: "/usr/bin:/bin", PRIME_TEST_MODE: mode },
				},
				undefined,
				250,
			),
	);
	await manager.setProject({ path: dir, name: "fixture", lastOpened: "now" });
	cleanups.push(async () => {
		await manager.shutdown();
		await rm(dir, { recursive: true, force: true });
	});
	if (mode !== "startup-dialog") await manager.connect();
	return manager;
}
async function pending(manager: AgentManager, method: string) {
	await expect
		.poll(() => manager.value.interactions.some((item) => item.method === method && item.status === "pending"))
		.toBe(true);
	return manager.value.interactions.find((item) => item.method === method && item.status === "pending")!;
}
describe("human interaction lifecycle", () => {
	it("preserves original option values privately and rejects forged, duplicate and mismatched responses", async () => {
		const sent: RpcCommand[] = [];
		const store = new InteractionStore(
			async (reply) => {
				sent.push(reply);
			},
			() => {},
			new Redactor({}),
		);
		store.accept({
			id: "server-id",
			method: "select",
			title: "choose",
			options: ["api_key=sk-FAKE_TEST_SECRET_123456", "B"],
		});
		const view = store.value[0];
		expect(view.id).not.toBe("server-id");
		expect(view.options[0]).not.toContain("FAKE_TEST");
		await expect(store.respond({ id: view.id, action: "choose", option: 20 })).rejects.toThrow();
		await expect(store.respond({ id: view.id, action: "confirm", confirmed: true })).rejects.toThrow();
		await store.respond({ id: view.id, action: "choose", option: 0 });
		expect(sent).toEqual([
			{ type: "extension_ui_response", id: "server-id", value: "api_key=sk-FAKE_TEST_SECRET_123456" },
		]);
		await expect(store.respond({ id: view.id, action: "choose", option: 0 })).rejects.toThrow(/이미/);
	});
	it("completes select, decline, text and editor responses without an RPC response ACK", async () => {
		const manager = await setup();
		await manager.command({ type: "prompt", message: "[interaction:all]" });
		const select = await pending(manager, "select");
		await manager.respond({ id: select.id, action: "choose", option: 1 });
		const confirm = await pending(manager, "confirm");
		await manager.respond({ id: confirm.id, action: "confirm", confirmed: false });
		const input = await pending(manager, "input");
		await manager.respond({ id: input.id, action: "submit", text: "한글 답변" });
		const editor = await pending(manager, "editor");
		await manager.respond({ id: editor.id, action: "submit", text: "수정된 내용\n둘째 줄" });
		await expect.poll(() => manager.value.runStatus).toBe("completed");
		expect(manager.value.interactions.map((item) => item.status)).toEqual([
			"answered",
			"answered",
			"answered",
			"answered",
		]);
		expect(manager.value.interactions.map((item) => item.answer)).toEqual([
			"원인부터 분석",
			"거절",
			"한글 답변",
			"수정된 내용\n둘째 줄",
		]);
		expect(manager.value.notices.map((item) => item.kind)).toEqual(["notify", "draft"]);
	});
	it("keeps a session-change command alive while the human takes longer than the RPC timeout", async () => {
		const manager = await setup("blocking-session");
		const work = manager.sessionCommand({ type: "new_session" });
		const checked = expect(work).resolves.toBeUndefined();
		const item = await pending(manager, "confirm");
		await new Promise((resolve) => setTimeout(resolve, 400));
		expect(manager.value.connection).toBe("connected");
		await manager.respond({ id: item.id, action: "confirm", confirmed: true });
		await checked;
	});
	it("can answer during connection readiness before a session exists", async () => {
		const manager = await setup("startup-dialog");
		const connecting = manager.connect();
		const checked = expect(connecting).resolves.toBeUndefined();
		const item = await pending(manager, "confirm");
		expect(manager.value.connection).toBe("connecting");
		await manager.respond({ id: item.id, action: "confirm", confirmed: true });
		await checked;
		expect(manager.value.connection).toBe("connected");
	});
	it("expires timed dialogs and refuses a late answer", async () => {
		const sent = vi.fn(async () => {});
		const store = new InteractionStore(sent, () => {}, new Redactor({}));
		store.accept({ id: "timeout", method: "input", title: "deadline", timeout: 30 });
		const item = store.value[0];
		await expect.poll(() => store.value[0].status).toBe("expired");
		await expect(store.respond({ id: item.id, action: "submit", text: "late" })).rejects.toThrow();
		expect(sent).toHaveBeenCalledExactlyOnceWith({ type: "extension_ui_response", id: "timeout", cancelled: true });
	});
	it("closes every simultaneous request on abort and still accepts the next prompt", async () => {
		const manager = await setup();
		await manager.command({ type: "prompt", message: "[interaction:parallel]" });
		await expect.poll(() => manager.value.interactions.length).toBe(2);
		const old = manager.value.interactions[0];
		await manager.command({ type: "abort" });
		expect(manager.value.interactions.every((item) => item.status === "closed")).toBe(true);
		expect(manager.value.runStatus).toBe("stopped");
		await expect(manager.respond({ id: old.id, action: "cancel" })).rejects.toThrow();
		await manager.command({ type: "prompt", message: "다음 작업" });
		await expect.poll(() => manager.value.state?.isStreaming).toBe(true);
		await manager.command({ type: "abort" });
	});
	it("invalidates pending replies on process exit and keeps error state visible", async () => {
		const manager = await setup();
		await manager.command({ type: "prompt", message: "[interaction:crash]" });
		const item = await pending(manager, "input");
		await expect.poll(() => manager.value.connection).toBe("error");
		expect(manager.value.interactions[0].status).toBe("closed");
		await expect(manager.respond({ id: item.id, action: "submit", text: "too late" })).rejects.toThrow();
	});
	it("validates main and side reply payloads without exposing arbitrary RPC writes", () => {
		for (const reply of [
			{ id: "valid", action: "confirm", confirmed: "true" },
			{ id: "valid", action: "choose", option: -1 },
			{ id: "valid", action: "cancel", extra: true },
			{ id: "valid", action: "submit", text: "x".repeat(100_001) },
		])
			expect(() => validateRequest("agent.respond", reply)).toThrow();
		expect(() =>
			validateRequest("panel.chatRespond", {
				projectPath: "/project",
				reply: { id: "valid", action: "confirm", confirmed: false },
			}),
		).not.toThrow();
	});
});
