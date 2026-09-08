import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handle: vi.fn(), open: vi.fn() }));
vi.mock("electron", () => ({
	ipcMain: { handle: mocks.handle },
	dialog: { showOpenDialog: mocks.open },
	clipboard: { writeText: vi.fn() },
}));

import { AgentManager } from "../src/main/agent/agent-manager";
import { registerIpcHandlers } from "../src/main/ipc/register-ipc-handlers";
import { ProjectManager } from "../src/main/projects/project-manager";
import { SettingsStore } from "../src/main/settings/settings-store";
import { UpdateService } from "../src/main/updates/update-service";
import { APP_URL } from "../src/main/windows/main-window";
import type { Result } from "../src/shared/dto";

afterEach(() => vi.clearAllMocks());
function fixture() {
	const store = new SettingsStore("/unused-update-fixture.json");
	const manager = new AgentManager(store, async () => {
		throw new Error("No agent launch allowed");
	});
	const frame = { url: APP_URL };
	const contents = { mainFrame: frame };
	const window = { isDestroyed: () => false, webContents: contents } as unknown as BrowserWindow;
	const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
	const driver = {
		check: async () => ({ version: "0.11.0", notes: "" }),
		download: async () => {},
		stage: vi.fn(async () => {}),
		quitAndInstall: vi.fn(),
	};
	const service = new UpdateService(
		driver,
		"0.10.0",
		async () => {},
		() => [],
	);
	registerIpcHandlers(
		() => window,
		manager,
		new ProjectManager(store),
		store,
		undefined,
		undefined,
		undefined,
		service,
	);
	const handler = mocks.handle.mock.calls.at(-1)![1] as (
		event: IpcMainInvokeEvent,
		name: string,
		input: unknown,
	) => Promise<Result<unknown>>;
	const call = (name: string, input?: unknown) => handler(event, name, input);
	return { manager, service, driver, handler, event, call };
}
describe("update IPC work exclusion", () => {
	it("blocks install while a preexisting native request is pending, then allows it", async () => {
		const f = fixture();
		let release!: (result: { canceled: boolean; filePaths: string[] }) => void;
		mocks.open.mockImplementation(
			() =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);
		await f.call("update.check");
		await f.call("update.download");
		const picking = f.call("project.selectDirectory");
		await vi.waitFor(() => expect(mocks.open).toHaveBeenCalled());
		const blocked = await f.call("update.install");
		expect(blocked.ok).toBe(false);
		if (!blocked.ok) expect(blocked.error).toContain("처리 중인 앱 요청");
		expect(f.driver.stage).not.toHaveBeenCalled();
		release({ canceled: true, filePaths: [] });
		await picking;
		expect((await f.call("update.install")).ok).toBe(true);
		await f.manager.shutdown();
	});
	it("blocks new prompts and panel work as soon as installation begins, but keeps status readable", async () => {
		const f = fixture();
		let release!: () => void;
		f.driver.stage.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		await f.call("update.check");
		await f.call("update.download");
		const installing = f.call("update.install");
		for (const [name, input] of [
			["agent.prompt", { message: "must not run" }],
			["panel.terminalOpen", { projectPath: "/project" }],
			["attachment.select", undefined],
		] as const) {
			const result = await f.call(name, input);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error).toContain("업데이트를 적용");
		}
		expect((await f.call("update.status")).ok).toBe(true);
		expect((await f.call("app.snapshot")).ok).toBe(true);
		expect(
			(
				await f.handler(
					{ ...f.event, senderFrame: { url: "https://evil.example" } } as IpcMainInvokeEvent,
					"update.install",
					undefined,
				)
			).ok,
		).toBe(false);
		release();
		await installing;
		expect(f.driver.quitAndInstall).toHaveBeenCalledOnce();
		await f.manager.shutdown();
	});
});
