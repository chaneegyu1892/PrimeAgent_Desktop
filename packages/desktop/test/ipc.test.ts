import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RpcAgentTransport } from "../src/main/agent/rpc-agent-transport";

const mocks = vi.hoisted(() => ({ handle: vi.fn(), open: vi.fn(), copy: vi.fn() }));
vi.mock("electron", () => ({
	ipcMain: { handle: mocks.handle },
	dialog: { showOpenDialog: mocks.open },
	clipboard: { writeText: mocks.copy },
}));

import { AgentManager } from "../src/main/agent/agent-manager";
import type { AgentTransport, RpcCommand } from "../src/main/agent/agent-transport";
import { isTrustedSender, registerIpcHandlers, validateSessionFile } from "../src/main/ipc/register-ipc-handlers";
import { ProjectManager } from "../src/main/projects/project-manager";
import { WorkspaceController } from "../src/main/sessions/workspace-controller";
import { SettingsStore } from "../src/main/settings/settings-store";
import { APP_URL } from "../src/main/windows/main-window";
import type { Result } from "../src/shared/dto";

const dirs: string[] = [];
afterEach(async () => {
	vi.clearAllMocks();
	vi.unstubAllEnvs();
	await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
function sender() {
	const frame = { url: APP_URL };
	const contents = { mainFrame: frame };
	const window = { isDestroyed: () => false, webContents: contents } as unknown as BrowserWindow;
	const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
	return { window, event };
}
describe("IPC authorization", () => {
	it("does not dispatch into a replacement session after restoration is declined", async () => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "prime-restore-decline-")));
		dirs.push(root);
		const general = join(root, "general");
		await mkdir(general);
		const file = join(root, "saved.jsonl");
		await writeFile(file, `${JSON.stringify({ type: "session", id: "original", cwd: general })}\n`);
		const store = new SettingsStore(join(root, "settings.json"));
		await store.update((settings) => ({
			...settings,
			lastConversation: { projectPath: general, sessionFile: file },
		}));
		const manager = new AgentManager(
			store,
			async () =>
				new RpcAgentTransport({
					executable: process.execPath,
					args: [resolve("test/fixtures/fake-cli.mjs")],
					env: { PATH: "/usr/bin:/bin", PRIME_TEST_MODE: "reject-switch" },
				}),
		);
		const workspace = new WorkspaceController(
			manager,
			new ProjectManager(store),
			store,
			general,
			validateSessionFile,
		);
		try {
			await expect(workspace.start()).rejects.toThrow("취소");
			await expect(workspace.ensureReady()).rejects.toThrow("복원에 실패");
			await workspace.remember();
			expect(store.value.lastConversation?.sessionFile).toBe(file);
			expect(manager.value.messages).toHaveLength(0);
			await workspace.newGeneral();
			await expect(workspace.ensureReady()).resolves.toBeUndefined();
		} finally {
			await manager.shutdown();
		}
	});
	it("queues one startup send, accepts the startup question, and restores the general conversation on restart", async () => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "prime-general-")));
		dirs.push(root);
		const sessions = join(root, "sessions");
		await mkdir(sessions);
		vi.stubEnv("PRIME_AGENT_SESSION_DIR", sessions);
		const store = new SettingsStore(join(root, "settings.json"));
		const projects = new ProjectManager(store);
		const factory = (mode = "") =>
			new AgentManager(
				store,
				async () =>
					new RpcAgentTransport({
						executable: process.execPath,
						args: [resolve("test/fixtures/fake-cli.mjs")],
						env: { PATH: "/usr/bin:/bin", PRIME_TEST_MODE: mode, PRIME_TEST_SESSION_DIR: sessions },
					}),
			);
		const manager = factory("startup-dialog");
		const workspace = new WorkspaceController(manager, projects, store, join(root, "general"), validateSessionFile);
		const { window, event } = sender();
		registerIpcHandlers(() => window, manager, projects, store, undefined, workspace);
		const handler = mocks.handle.mock.calls.at(-1)![1] as (
			event: IpcMainInvokeEvent,
			name: string,
			input: unknown,
		) => Promise<Result<unknown>>;
		const startup = workspace.start();
		try {
			await expect.poll(() => manager.value.interactions.length).toBe(1);
			const pendingSend = handler(event, "agent.prompt", { message: "프로젝트 없는 첫 대화" });
			expect((await handler(event, "agent.prompt", { message: "중복" })).ok).toBe(false);
			expect(manager.value.messages).toHaveLength(0);
			await handler(event, "agent.respond", {
				id: manager.value.interactions[0].id,
				action: "confirm",
				confirmed: true,
			});
			await startup;
			expect((await pendingSend).ok).toBe(true);
			await handler(event, "agent.abort", undefined);
			expect(manager.value.project?.kind).toBe("personal");
			expect(store.value.recent).toHaveLength(0);
			expect(manager.value.messages.filter((message) => message.role === "user")).toHaveLength(1);
			await expect.poll(() => store.value.lastConversation?.sessionFile).toBeTruthy();
			const originalId = manager.value.state?.sessionId;
			await manager.shutdown();
			await store.load();
			const restored = factory();
			try {
				await new WorkspaceController(
					restored,
					projects,
					store,
					join(root, "general"),
					validateSessionFile,
				).start();
				expect(restored.value.state?.sessionId).toBe(originalId);
				expect(restored.value.messages.some((message) => message.content === "프로젝트 없는 첫 대화")).toBe(true);
			} finally {
				await restored.shutdown();
			}
		} finally {
			await manager.shutdown();
		}
	});
	it("cancels a startup send before dispatch and falls back visibly if the saved project disappears", async () => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "prime-cancel-start-")));
		dirs.push(root);
		const store = new SettingsStore(join(root, "settings.json"));
		const projects = new ProjectManager(store);
		const missing = join(root, "removed");
		await mkdir(missing);
		await projects.open(missing);
		await store.update((settings) => ({ ...settings, lastConversation: { projectPath: missing } }));
		await rm(missing, { recursive: true });
		const manager = new AgentManager(
			store,
			async () =>
				new RpcAgentTransport({
					executable: process.execPath,
					args: [resolve("test/fixtures/fake-cli.mjs")],
					env: { PATH: "/usr/bin:/bin", PRIME_TEST_MODE: "startup-dialog" },
				}),
		);
		const workspace = new WorkspaceController(manager, projects, store, join(root, "general"), validateSessionFile);
		const { window, event } = sender();
		registerIpcHandlers(() => window, manager, projects, store, undefined, workspace);
		const handler = mocks.handle.mock.calls.at(-1)![1] as (
			event: IpcMainInvokeEvent,
			name: string,
			input: unknown,
		) => Promise<Result<unknown>>;
		try {
			const startup = workspace.start();
			await expect.poll(() => manager.value.interactions.length).toBe(1);
			const pending = handler(event, "agent.prompt", { message: "보내지 않을 요청" });
			expect((await handler(event, "agent.abort", undefined)).ok).toBe(true);
			expect(manager.value.interactions.some((item) => item.status === "pending")).toBe(false);
			await startup;
			expect((await pending).ok).toBe(false);
			expect(manager.value.messages).toHaveLength(0);
			expect(manager.value.project?.kind).toBe("personal");
			expect(manager.value.notices.some((notice) => notice.text.includes("일반 대화를 열었습니다"))).toBe(true);
		} finally {
			await manager.shutdown();
		}
	});
	it("accepts an interaction reply while connection holds the lifecycle lock and rejects another sender", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-ipc-dialog-"));
		dirs.push(root);
		const store = new SettingsStore(join(root, "settings.json"));
		const manager = new AgentManager(
			store,
			async () =>
				new RpcAgentTransport({
					executable: process.execPath,
					args: [resolve("test/fixtures/fake-cli.mjs")],
					env: { PATH: "/usr/bin:/bin", PRIME_TEST_MODE: "startup-dialog" },
				}),
		);
		await manager.setProject({ path: root, name: "fixture", lastOpened: "now" });
		const { window, event } = sender();
		registerIpcHandlers(() => window, manager, new ProjectManager(store), store);
		const handler = mocks.handle.mock.calls[0][1] as (
			event: IpcMainInvokeEvent,
			name: string,
			input: unknown,
		) => Promise<Result<unknown>>;
		try {
			const connecting = handler(event, "agent.connect", undefined);
			await expect.poll(() => manager.value.interactions.length).toBe(1);
			const reply = { id: manager.value.interactions[0].id, action: "confirm", confirmed: true };
			expect((await handler({ ...event, sender: {} } as IpcMainInvokeEvent, "agent.respond", reply)).ok).toBe(false);
			expect((await handler(event, "agent.respond", reply)).ok).toBe(true);
			expect((await connecting).ok).toBe(true);
			expect((await handler(event, "agent.respond", reply)).ok).toBe(false);
		} finally {
			await manager.shutdown();
		}
	});
	it("opens catalogued sessions across projects and forwards only native-selected attachment bytes", async () => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "prime-navigation-")));
		dirs.push(root);
		const a = join(root, "a"),
			b = join(root, "b"),
			sessions = join(root, "sessions");
		await Promise.all([mkdir(a), mkdir(b), mkdir(sessions)]);
		vi.stubEnv("PRIME_AGENT_SESSION_DIR", sessions);
		const saved = join(sessions, "saved.jsonl");
		await writeFile(saved, `${JSON.stringify({ type: "session", id: "saved", cwd: b })}\n`);
		const store = new SettingsStore(join(root, "settings.json"));
		const projects = new ProjectManager(store);
		await projects.open(b);
		const project = await projects.open(a);
		const started: string[] = [],
			commands: RpcCommand[] = [];
		const manager = new AgentManager(store, async (): Promise<AgentTransport> => {
			let sessionId = "empty";
			return {
				ownership: "owned-child",
				start: async (cwd) => {
					started.push(cwd);
				},
				close: async () => {},
				subscribe: () => () => {},
				request: async (command) => {
					commands.push(command);
					if (command.type === "get_state") return { sessionId, isStreaming: false };
					if (command.type === "get_messages") return { messages: [] };
					if (command.type === "switch_session")
						sessionId = JSON.parse((await readFile(command.sessionPath, "utf8")).split("\n")[0]).id;
					return { cancelled: false };
				},
			};
		});
		await manager.setProject(project);
		await manager.connect();
		const { window, event } = sender();
		registerIpcHandlers(() => window, manager, projects, store);
		const handler = mocks.handle.mock.calls[0][1] as (
			event: IpcMainInvokeEvent,
			name: string,
			input: unknown,
		) => Promise<Result<unknown>>;
		expect((await handler(event, "session.open", { path: saved, projectPath: a })).ok).toBe(false);
		expect(manager.value.project?.path).toBe(a);
		expect((await handler(event, "session.open", { path: saved, projectPath: b })).ok).toBe(true);
		expect(started).toEqual([a, b]);
		expect(manager.value.state?.sessionId).toBe("saved");
		const image = join(root, "image.png");
		const bytes = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4fcAAAAASUVORK5CYII=",
			"base64",
		);
		await writeFile(image, bytes);
		mocks.open.mockResolvedValue({ canceled: false, filePaths: [image] });
		const selected = (await handler(event, "attachment.select", undefined)) as Result<{ id: string }[]>;
		expect(selected.ok).toBe(true);
		if (!selected.ok) throw new Error(selected.error);
		const payload = { message: "", attachmentIds: [selected.value[0].id] };
		expect((await handler(event, "agent.prompt", payload)).ok).toBe(true);
		expect(commands.find((command) => command.type === "prompt")).toEqual({
			type: "prompt",
			message: "첨부한 이미지를 확인해 주세요.",
			images: [{ type: "image", mimeType: "image/png", data: bytes.toString("base64") }],
		});
		expect((await handler(event, "agent.prompt", payload)).ok).toBe(false);
		await manager.shutdown();
	});
	it("accepts only the exact main frame in the app window", () => {
		const { window, event } = sender();
		expect(isTrustedSender(event, window)).toBe(true);
		expect(isTrustedSender({ ...event, senderFrame: { url: APP_URL } } as IpcMainInvokeEvent, window)).toBe(false);
		expect(isTrustedSender({ ...event, sender: {} } as IpcMainInvokeEvent, window)).toBe(false);
		expect(isTrustedSender(event, null)).toBe(false);
	});
	it("returns a safe error for unknown IPC and refuses an untrusted sender", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-ipc-"));
		dirs.push(root);
		const store = new SettingsStore(join(root, "settings.json"));
		const manager = new AgentManager(store, async () => {
			throw new Error("not used");
		});
		const { window, event } = sender();
		registerIpcHandlers(() => window, manager, new ProjectManager(store), store);
		const handler = mocks.handle.mock.calls[0][1] as (
			event: IpcMainInvokeEvent,
			name: unknown,
			input: unknown,
		) => Promise<Result<unknown>>;
		expect((await handler(event, "child_process.exec", { command: "bad" })).ok).toBe(false);
		expect((await handler({ ...event, sender: {} } as IpcMainInvokeEvent, "app.snapshot", undefined)).ok).toBe(false);
		expect((await handler(event, "app.snapshot", undefined)).ok).toBe(true);
		await manager.shutdown();
	});
	it("only opens a session whose header belongs to the selected project", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-session-"));
		dirs.push(root);
		const file = join(root, "session.jsonl");
		await writeFile(file, `${JSON.stringify({ type: "session", cwd: root, id: "fake" })}\n`);
		expect(await validateSessionFile(file, root)).toBe(await realpath(file));
		await expect(validateSessionFile(file, "/other-project")).rejects.toThrow(/현재 프로젝트/);
		await writeFile(file, "{}\n");
		await expect(validateSessionFile(file, root)).rejects.toThrow();
	});
});
