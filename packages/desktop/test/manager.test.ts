import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentManager } from "../src/main/agent/agent-manager";
import type { AgentTransport, RpcCommand, TransportEvent } from "../src/main/agent/agent-transport";
import { Redactor } from "../src/main/agent/redaction";
import { SettingsStore } from "../src/main/settings/settings-store";

class FakeTransport implements AgentTransport {
	ownership = "shared-daemon" as const;
	closed = 0;
	cancelled = false;
	startedCwd = "";
	state = { sessionId: "test-session", isStreaming: false, isCompacting: false, thinkingLevel: "high" };
	listeners = new Set<(event: TransportEvent) => void>();
	requests: RpcCommand[] = [];
	messages: unknown[] = [];
	failRefresh = false;
	async start(cwd: string) {
		this.startedCwd = cwd;
	}
	async close() {
		this.closed++;
	}
	subscribe(listener: (event: TransportEvent) => void) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	emit(value: Record<string, unknown>) {
		for (const listener of this.listeners) listener({ kind: "event", value });
	}
	async request(command: RpcCommand): Promise<unknown> {
		this.requests.push(command);
		if (this.failRefresh && ["get_state", "get_messages"].includes(command.type)) throw new Error("refresh failed");
		if (command.type === "get_state") return { ...this.state };
		if (command.type === "get_messages") return { messages: [...this.messages] };
		if (command.type === "new_session") return { cancelled: this.cancelled };
		if (command.type === "abort") {
			this.state.isStreaming = false;
			this.emit({ type: "agent_end" });
		}
		return undefined;
	}
}
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const f of cleanup.splice(0)) await f();
});
async function setup() {
	const dir = await mkdtemp(join(tmpdir(), "prime-manager-"));
	const transport = new FakeTransport();
	const manager = new AgentManager(
		new SettingsStore(join(dir, "settings.json")),
		async () => transport,
		new Redactor({}),
	);
	await manager.setProject({ name: "fixture", path: dir, lastOpened: "now" });
	await manager.connect();
	cleanup.push(async () => {
		await manager.shutdown();
		await rm(dir, { recursive: true, force: true });
	});
	return { manager, transport, dir };
}
describe("manager with fake transport", () => {
	it("does not spawn a late transport after the app has quit", async () => {
		const transport = new FakeTransport();
		let deliver!: (transport: AgentTransport) => void;
		const ready = new Promise<AgentTransport>((resolve) => {
			deliver = resolve;
		});
		const manager = new AgentManager(new SettingsStore("/unused/settings.json"), () => ready, new Redactor({}));
		await manager.setProject({ name: "fixture", path: "/fixture", lastOpened: "now" });
		const connecting = manager.connect();
		const rejected = expect(connecting).rejects.toThrow(/종료/);
		await manager.shutdown();
		deliver(transport);
		await rejected;
		expect(transport.startedCwd).toBe("");
		expect(transport.closed).toBe(1);
	});
	it("stops displaying a tool as running when the run ends without a tool-end event", async () => {
		const { manager, transport } = await setup();
		transport.emit({ type: "tool_execution_start", toolCallId: "open", toolName: "ipython" });
		transport.emit({ type: "agent_end" });
		expect(manager.value.activity[0].type).toBe("tool_execution_interrupted");
	});
	it("uses the selected cwd and leaves shared daemon lifecycle to the transport", async () => {
		const { manager, transport, dir } = await setup();
		expect(transport.startedCwd).toBe(dir);
		await manager.disconnect();
		expect(transport.closed).toBe(1);
		expect(manager.value.connection).toBe("disconnected");
	});
	it("maintains one message through start/update/end, then accepts another", async () => {
		const { manager, transport } = await setup();
		const message = { role: "assistant", timestamp: 1, content: [{ type: "text", text: "hello" }] };
		transport.emit({ type: "message_start", message: { ...message, content: [] } });
		transport.emit({ type: "message_update", message });
		transport.emit({ type: "message_end", message });
		expect(manager.value.messages).toHaveLength(1);
		expect(manager.value.messages[0].content).toBe("hello");
		transport.emit({ type: "message_start", message: { ...message, timestamp: 2 } });
		expect(manager.value.messages).toHaveLength(2);
	});
	it("blocks project/session/prompt replacement during execution, while abort remains usable", async () => {
		const { manager, transport } = await setup();
		transport.state.isStreaming = true;
		transport.emit({ type: "agent_start" });
		await expect(manager.command({ type: "prompt", message: "duplicate" })).rejects.toThrow(/추가 지시/);
		await expect(manager.sessionCommand({ type: "new_session" })).rejects.toThrow(/중단/);
		await expect(manager.setProject({ path: "/other", name: "other", lastOpened: "now" })).rejects.toThrow(/중단/);
		await manager.command({ type: "abort" });
		expect(manager.value.state?.isStreaming).toBe(false);
	});
	it("handles extension-cancelled session replacement without clearing messages", async () => {
		const { manager, transport } = await setup();
		transport.cancelled = true;
		await expect(manager.sessionCommand({ type: "new_session" })).rejects.toThrow(/취소/);
		expect(manager.value.state?.sessionId).toBe("test-session");
	});
	it("does not report an accepted prompt as rejected when only refresh fails", async () => {
		const { manager, transport } = await setup();
		transport.failRefresh = true;
		await expect(manager.command({ type: "prompt", message: "accepted" })).resolves.toBeUndefined();
		expect(manager.value.diagnostics.at(-1)?.message).toBe("refresh failed");
	});
	it("updates tool output in place and replaces queues", async () => {
		const { manager, transport } = await setup();
		transport.emit({ type: "tool_execution_start", toolCallId: "a", toolName: "ipython" });
		transport.emit({
			type: "tool_execution_end",
			toolCallId: "a",
			toolName: "ipython",
			result: { content: [{ type: "text", text: "done" }] },
		});
		transport.emit({
			type: "session_action_update",
			actions: { queuedCount: 1, steering: ["change"], followUps: [] },
		});
		expect(manager.value.activity).toHaveLength(1);
		expect(manager.value.activity[0].detail).toBe("done");
		expect(manager.value.state?.steering).toEqual(["change"]);
	});
});
