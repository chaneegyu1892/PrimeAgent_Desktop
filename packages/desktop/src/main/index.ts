import { join, resolve } from "node:path";
import { app, BrowserWindow, dialog, Menu, nativeTheme, safeStorage } from "electron";
import { SNAPSHOT_CHANNEL } from "../shared/ipc-contract";
import { PANEL_CHANNEL } from "../shared/panel-contract";
import { AgentManager } from "./agent/agent-manager";
import { discoverCli, resolveCli } from "./agent/cli-discovery";
import { RpcAgentTransport } from "./agent/rpc-agent-transport";
import { CapabilityService } from "./capabilities/capability-service";
import { CapabilityStore } from "./capabilities/capability-store";
import { registerIpcHandlers, validateSessionFile } from "./ipc/register-ipc-handlers";
import { PanelService } from "./panels/panel-service";
import { ProjectManager } from "./projects/project-manager";
import { WorkspaceController } from "./sessions/workspace-controller";
import { SettingsStore } from "./settings/settings-store";
import { FreeUpdateDriver } from "./updates/free-update-driver";
import { UpdateService } from "./updates/update-service";
import { createMainWindow, installProtocol, registerScheme } from "./windows/main-window";

registerScheme();
app.setName("Prime Desktop");
// Smoke tests provide a separate app-state directory; agent auth paths are never redirected here.
if (process.env.PRIME_DESKTOP_USER_DATA) app.setPath("userData", resolve(process.env.PRIME_DESKTOP_USER_DATA));
let window: BrowserWindow | null = null;
let manager: AgentManager | undefined;
let panels: PanelService | undefined;
let capabilities: CapabilityService | undefined;
let updates: UpdateService | undefined;
let quitReady = false;
let quitting = false;
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
	app.on("second-instance", () => {
		if (window?.isMinimized()) window.restore();
		window?.show();
		window?.focus();
	});
	void app
		.whenReady()
		.then(async () => {
			const distRoot = resolve(__dirname, "..");
			// The external Node process cannot read Electron's virtual ASAR filesystem.
			const questionExtension = join(distRoot, "extensions/desktop-ask-user.mjs").replace(
				"app.asar/",
				"app.asar.unpacked/",
			);
			nativeTheme.themeSource = "dark";
			app.dock?.setIcon(join(distRoot, "brand/app-icon.png"));
			const store = new SettingsStore(join(app.getPath("userData"), "desktop-settings.json"));
			let settingsError: unknown;
			try {
				await store.load();
			} catch (error) {
				settingsError = error;
			}
			const capabilityStore = new CapabilityStore(
				join(app.getPath("userData"), "capabilities"),
				join(distRoot, "builtin/skills").replace("app.asar/", "app.asar.unpacked/"),
				{
					encrypt(text) {
						if (!safeStorage.isEncryptionAvailable())
							throw new Error("시스템 암호화 저장소를 사용할 수 없습니다. 환경변수 참조를 사용하세요.");
						return safeStorage.encryptString(text).toString("base64");
					},
					decrypt(text) {
						return safeStorage.decryptString(Buffer.from(text, "base64"));
					},
				},
			);
			let capabilityError: unknown;
			try {
				await capabilityStore.load();
			} catch (error) {
				capabilityError = error;
			}
			capabilities = new CapabilityService(
				capabilityStore,
				store.value.cliPath
					? ((await resolveCli(store.value.cliPath).catch(() => undefined))?.env ?? process.env)
					: process.env,
			);
			await capabilities.startBridge();
			if (!capabilityError) await capabilities.detectAside().catch(() => {});
			let managerNumber = 0;
			const createManager = () => {
				const isMain = managerNumber++ === 0;
				return new AgentManager(store, async () => {
					const path = store.value.cliPath;
					if (!path) throw new Error("설정에서 Prime Agent 실행 파일을 선택하세요.");
					const launch = await resolveCli(path);
					const capabilityArgs = await capabilityStore.launchArgs();
					if (isMain) capabilities!.markMainApplied();
					return new RpcAgentTransport({
						...launch,
						env: { ...launch.env, ...capabilities!.grant() },
						args: [
							...launch.args,
							"--extension",
							questionExtension,
							"--extension",
							join(distRoot, "extensions/desktop-mcp.mjs").replace("app.asar/", "app.asar.unpacked/"),
							...capabilityArgs,
						],
					});
				});
			};
			manager = createManager();
			if (capabilityError) manager.diagnostic("확장 설정을 읽지 못했습니다. 확장 라이브러리를 확인하세요.", "error");
			panels = new PanelService(
				() => manager!.value,
				createManager,
				(event) => {
					if (window && !window.isDestroyed()) window.webContents.send(PANEL_CHANNEL, event);
				},
			);
			if (settingsError) manager.diagnostic(manager.redactor.error(settingsError), "error");
			if (!settingsError && !store.value.cliPath) {
				const path = await discoverCli();
				if (path) await store.update((settings) => ({ ...settings, cliPath: path }));
			}
			installProtocol(join(distRoot, "renderer"));
			const projects = new ProjectManager(store);
			const workspace = new WorkspaceController(
				manager,
				projects,
				store,
				join(app.getPath("userData"), "general-workspace"),
				validateSessionFile,
			);
			updates = new UpdateService(
				new FreeUpdateDriver(),
				app.getVersion(),
				async () => {
					await workspace.remember();
					await window?.webContents.session.flushStorageData();
					updates?.stop();
					await Promise.all([manager?.shutdown(), panels?.shutdown(), capabilities?.shutdown()]);
					quitReady = true;
				},
				() => [
					...(manager!.busy ||
					manager!.value.initializing ||
					manager!.value.state?.queuedCount ||
					["running", "retrying", "stopping"].includes(manager!.value.runStatus)
						? ["에이전트 작업이나 답변 대기를 먼저 마무리하세요."]
						: []),
					...panels!.updateBlockers(),
				],
				!app.isPackaged || process.platform !== "darwin" || process.arch !== "arm64"
					? "업데이트 설치는 macOS Apple Silicon 배포 앱에서 사용할 수 있습니다."
					: undefined,
				(error) => manager?.diagnostic(manager.redactor.error(error), "error"),
			);
			registerIpcHandlers(() => window, manager, projects, store, panels, workspace, capabilities, updates);
			manager.subscribe((snapshot) => {
				if (window && !window.isDestroyed()) window.webContents.send(SNAPSHOT_CHANNEL, snapshot);
			});
			const openWindow = () => {
				window = createMainWindow(distRoot);
				window.on("closed", () => {
					window = null;
				});
			};
			Menu.setApplicationMenu(
				Menu.buildFromTemplate([
					{
						label: "Prime Desktop",
						submenu: [
							{ role: "about" },
							{ type: "separator" },
							{ role: "hide" },
							{ role: "hideOthers" },
							{ role: "unhide" },
							{ type: "separator" },
							{ role: "quit" },
						],
					},
					{ role: "editMenu" },
					{ role: "windowMenu" },
				]),
			);
			openWindow();
			if (app.isPackaged) updates.start();
			void workspace.start().catch((error) => manager?.diagnostic(manager.redactor.error(error), "error"));
			app.on("activate", () => {
				if (BrowserWindow.getAllWindows().length === 0) openWindow();
			});
		})
		.catch((error) => {
			dialog.showErrorBox("Prime Desktop 시작 오류", manager?.redactor.error(error) ?? "앱을 시작하지 못했습니다.");
			app.quit();
		});
	app.on("window-all-closed", () => app.quit());
	app.on("before-quit", (event) => {
		if (quitReady) return;
		event.preventDefault();
		if (quitting) return;
		quitting = true;
		updates?.stop();
		void Promise.all([manager?.shutdown(), panels?.shutdown(), capabilities?.shutdown()]).finally(() => {
			quitReady = true;
			app.quit();
		});
	});
}
