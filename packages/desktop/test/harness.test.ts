import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentManager } from "../src/main/agent/agent-manager";
import type { AgentTransport, RpcCommand, TransportEvent } from "../src/main/agent/agent-transport";
import { Redactor } from "../src/main/agent/redaction";
import { TaskBridge } from "../src/main/harness/task-bridge";
import { TaskService } from "../src/main/harness/task-service";
import { SettingsStore } from "../src/main/settings/settings-store";
import { type TaskSpec, validateHarnessRequest } from "../src/shared/harness-contract";

class Worker implements AgentTransport {
	ownership = "owned-child" as const;
	listeners = new Set<(event: TransportEvent) => void>();
	requests: RpcCommand[] = [];
	state = { sessionId: "worker", thinkingLevel: "high", isStreaming: false, isCompacting: false };
	messages: unknown[] = [];
	closed = false;
	startup = false;
	startupReply?: () => void;
	async start() {}
	async close() {
		this.closed = true;
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
	finish(text = "Verified fixture") {
		this.messages.push({ role: "assistant", timestamp: Date.now(), content: [{ type: "text", text }] });
		this.emit({ type: "message_end", message: this.messages.at(-1) });
		this.state.isStreaming = false;
		this.emit({ type: "agent_end" });
	}
	async request(command: RpcCommand) {
		this.requests.push(command);
		if (command.type === "extension_ui_response") this.startupReply?.();
		if (command.type === "get_state" && this.startup) {
			this.startup = false;
			const answer = new Promise<void>((resolve) => {
				this.startupReply = resolve;
			});
			this.emit({ type: "extension_ui_request", id: "startup", method: "confirm", title: "Startup?" });
			await answer;
		}
		if (command.type === "get_state") return this.state;
		if (command.type === "get_messages") return { messages: this.messages };
		if (command.type === "get_available_models")
			return { models: [{ provider: "fixture", id: "offline", name: "Fixture", reasoning: true }] };
		if (command.type === "prompt") {
			this.state.isStreaming = true;
			this.emit({ type: "agent_start" });
		}
		return {};
	}
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const spec: TaskSpec = {
	title: "Fixture",
	prompt: "Work offline",
	criteria: "Return fixture evidence",
	role: "implement",
	dependencies: [],
};
async function setup(startup = false) {
	const root = await realpath(await mkdtemp(join(tmpdir(), "prime-harness-")));
	const workers: Worker[] = [];
	const service = new TaskService(join(root, "tasks.json"), () => {
		const worker = new Worker();
		worker.startup = startup;
		workers.push(worker);
		return new AgentManager(new SettingsStore(join(root, "settings.json")), async () => worker, new Redactor({}));
	});
	await service.load();
	cleanups.push(async () => {
		await service.shutdown();
		await rm(root, { recursive: true, force: true });
	});
	return { root, service, workers };
}
const started = (worker: Worker | undefined) => worker?.requests.some((command) => command.type === "prompt");
describe("persistent Prime worker orchestration", () => {
	it("surfaces and answers a worker question while startup itself is blocked", async () => {
		const { root, service, workers } = await setup(true);
		const task = await service.create(root, spec);
		await vi.waitFor(() => expect(service.get(task.id).status).toBe("waiting"));
		expect(started(workers[0])).toBe(false);
		await service.respond(task.id, {
			id: service.detail(task.id).snapshot!.interactions[0].id,
			action: "confirm",
			confirmed: true,
		});
		await vi.waitFor(() => expect(started(workers[0])).toBe(true));
		workers[0].finish();
		await vi.waitFor(() => expect(service.get(task.id).status).toBe("completed"));
	});
	it("serializes a shared project, waits for dependencies and hands results to the next worker", async () => {
		const { root, service, workers } = await setup();
		const first = await service.create(root, spec);
		const second = await service.create(root, { ...spec, title: "Review", role: "review", dependencies: [first.id] });
		await vi.waitFor(() => expect(started(workers[0])).toBe(true));
		expect(workers).toHaveLength(1);
		expect(service.get(second.id).status).toBe("queued");
		workers[0].finish("first task evidence");
		await vi.waitFor(() => expect(started(workers[1])).toBe(true));
		expect(workers[0].closed).toBe(true);
		expect(workers[1].requests.find((command) => command.type === "prompt")).toMatchObject({
			message: expect.stringContaining("first task evidence"),
		});
		workers[1].finish();
		await vi.waitFor(() => expect(service.get(second.id).status).toBe("completed"));
		await vi.waitFor(() => expect(service.blockers()).toEqual([]));
		expect(JSON.parse(await readFile(join(root, "tasks.json"), "utf8")).tasks[1].result).toContain(
			"Verified fixture",
		);
	});
	it("runs different projects concurrently, routes models and preserves live user interaction", async () => {
		const { root, service, workers } = await setup();
		await mkdir(join(root, "other"));
		await service.configure({
			...service.snapshot().config,
			routes: { implement: { provider: "fixture", modelId: "offline", level: "high" } },
		});
		const first = await service.create(root, spec);
		await service.create(join(root, "other"), spec);
		await vi.waitFor(() => expect(workers.filter(started)).toHaveLength(2));
		expect(workers[0].requests).toContainEqual({ type: "set_model", provider: "fixture", modelId: "offline" });
		workers[0].emit({
			type: "extension_ui_request",
			id: "approval",
			method: "confirm",
			title: "Continue?",
			message: "Fixture",
		});
		await vi.waitFor(() => expect(service.get(first.id).status).toBe("waiting"));
		await service.respond(first.id, {
			id: service.detail(first.id).snapshot!.interactions[0].id,
			action: "confirm",
			confirmed: false,
		});
		expect(workers[0].requests).toContainEqual({ type: "extension_ui_response", id: "approval", confirmed: false });
		await service.message(first.id, "change scope");
		expect(workers[0].requests).toContainEqual({ type: "steer", message: "change scope" });
	});
	it("cancels a worker and queued descendants without running them, and allows explicit retry", async () => {
		const { root, service, workers } = await setup();
		const parent = await service.create(root, spec);
		await vi.waitFor(() => expect(started(workers[0])).toBe(true));
		const child = await service.create(root, { ...spec, title: "child" }, parent.id);
		await service.cancel(parent.id);
		await vi.waitFor(() => expect(service.blockers()).toEqual([]));
		expect(service.get(child.id).status).toBe("cancelled");
		expect(workers).toHaveLength(1);
		await service.resume(parent.id);
		await vi.waitFor(() => expect(started(workers[1])).toBe(true));
		expect(workers[1].requests.find((command) => command.type === "prompt")).toMatchObject({
			message: expect.stringContaining("explicitly resumed"),
		});
	});
	it("rehydrates interrupted work paused without replaying, and preserves invalid storage", async () => {
		const { root, service, workers } = await setup();
		const task = await service.create(root, spec);
		await vi.waitFor(() => expect(started(workers[0])).toBe(true));
		const clonePath = join(root, "recovered.json");
		await writeFile(clonePath, await readFile(join(root, "tasks.json")));
		const factory = vi.fn(() => {
			throw new Error("must not launch on load");
		});
		const recovered = new TaskService(clonePath, factory);
		await recovered.load();
		expect(recovered.get(task.id).status).toBe("interrupted");
		expect(recovered.snapshot().config.paused).toBe(true);
		expect(factory).not.toHaveBeenCalled();
		await writeFile(clonePath, "bad json");
		const broken = new TaskService(clonePath, factory);
		await broken.load();
		await expect(broken.create(root, spec)).rejects.toThrow("보존");
		expect(await readFile(clonePath, "utf8")).toBe("bad json");
	});
	it("rejects unavailable routing before prompt and holds dependent jobs", async () => {
		const { root, service, workers } = await setup();
		await service.configure({
			...service.snapshot().config,
			routes: { implement: { provider: "absent", modelId: "nope", level: "high" } },
		});
		const task = await service.create(root, spec);
		const dependent = await service.create(root, { ...spec, dependencies: [task.id] });
		await vi.waitFor(() => expect(service.get(task.id).status).toBe("failed"));
		expect(started(workers[0])).toBe(false);
		expect(service.get(dependent.id).status).toBe("queued");
	});
	it("enforces strict requests, task limits and ancestor dependency rejection", async () => {
		const { root, service } = await setup();
		await service.configure({ ...service.snapshot().config, paused: true, maxTasks: 1 });
		const task = await service.create(root, spec);
		await expect(service.create(root, spec)).rejects.toThrow("한도");
		await service.configure({ ...service.snapshot().config, maxTasks: 4 });
		await expect(service.create(root, { ...spec, dependencies: [task.id] }, task.id)).rejects.toThrow("의존성");
		expect(() =>
			validateHarnessRequest("harness.respond", {
				id: task.id,
				reply: { id: "q", action: "confirm", confirmed: "yes" },
			}),
		).toThrow();
		expect(() =>
			validateHarnessRequest("harness.configure", { ...service.snapshot().config, concurrency: 999 }),
		).toThrow();
	});
	it("bounds bridge access by project and worker ownership; agent cannot answer user approvals", async () => {
		const { root, service } = await setup();
		await service.configure({ ...service.snapshot().config, paused: true });
		const task = await service.create(root, spec);
		await mkdir(join(root, "other"));
		const foreign = await service.create(join(root, "other"), spec);
		const bridge = new TaskBridge(service);
		await bridge.start();
		cleanups.push(() => bridge.shutdown());
		const grant = bridge.grant(() => root, task.id);
		const request = async (body: unknown, origin?: string) =>
			fetch(grant.PRIME_DESKTOP_TASK_URL, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${grant.PRIME_DESKTOP_TASK_TOKEN}`,
					...(origin ? { Origin: origin } : {}),
				},
				body: JSON.stringify(body),
			});
		expect((await request({ action: "list" }, "https://evil.invalid")).status).toBe(403);
		expect(await (await request({ action: "detail", id: foreign.id })).json()).toMatchObject({ ok: false });
		expect(await (await request({ action: "respond", id: task.id })).json()).toMatchObject({ ok: false });
		expect(await (await request({ action: "cancel", id: task.id })).json()).toMatchObject({ ok: false });
		expect(await (await request({ action: "list" })).json()).toMatchObject({
			ok: true,
			value: { tasks: [{ id: task.id }] },
		});
	});
});
