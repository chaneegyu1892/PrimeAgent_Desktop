import { open, realpath } from "node:fs/promises";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { clipboard, dialog, ipcMain } from "electron";
import type { CapabilityRequestName } from "../../shared/capability-contract";
import type { PromptPayload, Result } from "../../shared/dto";
import type { HarnessConfig, TaskSpec } from "../../shared/harness-contract";
import type { InteractionReply } from "../../shared/interactions";
import { REQUEST_CHANNEL, record, validateRequest } from "../../shared/ipc-contract";
import type { PanelRequestName } from "../../shared/panel-contract";
import type { AgentManager } from "../agent/agent-manager";
import { discoverCli, resolveCli } from "../agent/cli-discovery";
import { AttachmentStore } from "../attachments/attachment-store";
import type { CapabilityService } from "../capabilities/capability-service";
import type { TaskService } from "../harness/task-service";
import type { PanelService } from "../panels/panel-service";
import type { ProjectManager } from "../projects/project-manager";
import { SessionCatalog, sessionDirectory } from "../sessions/session-catalog";
import type { WorkspaceController } from "../sessions/workspace-controller";
import type { SettingsStore } from "../settings/settings-store";
import type { UpdateService } from "../updates/update-service";
import { APP_URL } from "../windows/main-window";

export function isTrustedSender(event: IpcMainInvokeEvent, window: BrowserWindow | null): boolean {
	return (
		!!window &&
		!window.isDestroyed() &&
		event.sender === window.webContents &&
		event.senderFrame === window.webContents.mainFrame &&
		event.senderFrame?.url === APP_URL
	);
}
export async function validateSessionFile(path: string, cwd: string): Promise<string> {
	const canonical = await realpath(path);
	const file = await open(canonical, "r");
	try {
		const buffer = Buffer.alloc(16_384);
		const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
		const text = buffer.subarray(0, bytesRead).toString("utf8");
		const lineEnd = text.indexOf("\n");
		if (lineEnd === -1) throw new Error("세션 헤더가 없습니다.");
		const header = record(JSON.parse(text.slice(0, lineEnd)));
		const selectedCwd = await realpath(cwd).catch(() => null);
		const sessionCwd = typeof header.cwd === "string" ? await realpath(header.cwd).catch(() => null) : null;
		if (header.type !== "session" || !selectedCwd || sessionCwd !== selectedCwd) {
			throw new Error("현재 프로젝트의 Prime Agent 세션 파일을 선택하세요.");
		}
		return canonical;
	} finally {
		await file.close();
	}
}
export function registerIpcHandlers(
	getWindow: () => BrowserWindow | null,
	manager: AgentManager,
	projects: ProjectManager,
	store: SettingsStore,
	panels?: PanelService,
	workspace?: WorkspaceController,
	capabilities?: CapabilityService,
	updates?: UpdateService,
	tasks?: TaskService,
): void {
	let lifecycleBusy = false;
	let activeRequests = 0;
	let cancellationEpoch = 0;
	const attachments = new AttachmentStore();
	const catalog = new SessionCatalog(sessionDirectory(), manager.redactor);
	if (workspace)
		manager.subscribe((snapshot) => {
			if (!lifecycleBusy && !snapshot.initializing && !manager.busy) void workspace.remember().catch(() => {});
		});
	const listSessions = async () =>
		(
			await catalog.list(
				[...store.value.recent, ...(workspace?.personal ? [workspace.personal] : [])],
				store.value.sessionFiles,
			)
		).filter((session) => !tasks?.ownsSession(session.path));
	const rememberSession = (path: string) =>
		store.update((settings) => ({
			...settings,
			sessionFiles: [...new Set([path, ...(settings.sessionFiles ?? [])])].slice(0, 200),
		}));
	ipcMain.handle(REQUEST_CHANNEL, async (event, name: unknown, input: unknown): Promise<Result<unknown>> => {
		let locked = false;
		let counted = false;
		try {
			const window = getWindow();
			if (!isTrustedSender(event, window)) throw new Error("신뢰할 수 없는 화면의 요청입니다.");
			validateRequest(name, input);
			if (name.startsWith("update.")) {
				if (!updates) throw new Error("업데이트 서비스를 사용할 수 없습니다.");
				const blockers = [
					...(activeRequests ? ["처리 중인 앱 요청이 끝난 뒤 다시 시도하세요."] : []),
					...(attachments.count ? ["미전송 첨부파일을 보내거나 제거한 뒤 업데이트하세요."] : []),
				];
				if (name === "update.check") await updates.check();
				if (name === "update.download") await updates.download();
				if (name === "update.install") await updates.install(blockers);
				return { ok: true, value: updates.status(blockers) };
			}
			if (updates?.installing && !["app.snapshot", "app.copyText", "agent.copyDiagnostics"].includes(name))
				throw new Error("업데이트를 적용하고 있습니다. 재시작 후 작업을 이어가세요.");
			activeRequests++;
			counted = true;
			if (name.startsWith("harness.")) {
				if (!tasks) throw new Error("작업 관리자를 사용할 수 없습니다.");
				const args = record(input);
				if (name.startsWith("harness.memory")) {
					const path = args.projectPath as string;
					if (path !== manager.value.project?.path && !store.value.recent.some((project) => project.path === path))
						throw new Error("앱에서 연 프로젝트를 선택하세요.");
					if (name === "harness.memorySave")
						await tasks.memory.save(path, {
							key: args.key as string,
							content: args.content as string,
							source: args.source as string,
						});
					if (name === "harness.memoryForget") await tasks.memory.forget(path, args.key as string);
					return {
						ok: true,
						value: await tasks.memory.list(path, name === "harness.memoryList" ? (args.query as string) : ""),
					};
				}
				if (name === "harness.create") {
					const path = args.projectPath as string;
					if (path !== manager.value.project?.path && !store.value.recent.some((project) => project.path === path))
						throw new Error("앱에서 연 프로젝트를 선택하세요.");
					const { projectPath: _projectPath, ...spec } = args;
					await tasks.create(path, spec as unknown as TaskSpec);
				}
				if (name === "harness.configure") await tasks.configure(input as HarnessConfig);
				if (name === "harness.cancel") await tasks.cancel(args.id as string);
				if (name === "harness.resume") await tasks.resume(args.id as string);
				if (name === "harness.detail") return { ok: true, value: tasks.detail(args.id as string) };
				if (name === "harness.message") {
					await tasks.message(args.id as string, args.message as string);
					return { ok: true, value: undefined };
				}
				if (name === "harness.respond") {
					await tasks.respond(args.id as string, args.reply as InteractionReply);
					return { ok: true, value: undefined };
				}
				return { ok: true, value: tasks.snapshot() };
			}
			if (name.startsWith("capability.")) {
				if (!capabilities) throw new Error("확장 서비스를 사용할 수 없습니다.");
				return { ok: true, value: await capabilities.handle(name as CapabilityRequestName, input, window!) };
			}
			if (name.startsWith("panel.")) {
				if (!panels) throw new Error("패널 서비스를 사용할 수 없습니다.");
				return { ok: true, value: await panels.handle(name as PanelRequestName, input) };
			}
			const args = record(input);
			const sendEpoch = cancellationEpoch;
			const priorSession = manager.value.state?.sessionId;
			const lifecycle =
				name.startsWith("project.") ||
				name.startsWith("settings.") ||
				(name.startsWith("session.") && name !== "session.list") ||
				name === "attachment.select" ||
				["agent.prompt", "agent.steer", "agent.followUp"].includes(name) ||
				name === "agent.connect" ||
				name === "agent.reconnect" ||
				name === "agent.disconnect" ||
				name === "model.select" ||
				name === "model.setThinkingLevel";
			if (lifecycle) {
				if (lifecycleBusy) throw new Error("이전 작업이 끝난 후 다시 시도하세요.");
				lifecycleBusy = true;
				locked = true;
			} else if (
				lifecycleBusy &&
				!["app.snapshot", "agent.respond", "agent.abort", "agent.copyDiagnostics", "session.list"].includes(name)
			)
				throw new Error("프로젝트 또는 연결을 변경 중입니다.");
			let value: unknown;
			if (lifecycle) await workspace?.settled();
			switch (name) {
				case "app.copyText":
					clipboard.writeText(args.text as string);
					break;
				case "app.snapshot":
					value = manager.value;
					break;
				case "project.selectDirectory": {
					manager.ensureIdle();
					const selected = await dialog.showOpenDialog(window!, {
						properties: ["openDirectory"],
						title: "프로젝트 폴더 선택",
					});
					if (!selected.canceled && selected.filePaths[0]) {
						await manager.setProject(await projects.open(selected.filePaths[0]));
						await manager.connect();
					}
					value = manager.value;
					break;
				}
				case "project.openRecent":
					manager.ensureIdle();
					await manager.setProject(await projects.open(args.path as string, true));
					await manager.connect();
					value = manager.value;
					break;
				case "project.removeRecent":
					await projects.remove(args.path as string);
					manager.changed();
					value = manager.value;
					break;
				case "settings.selectCli": {
					manager.ensureIdle();
					const selected = await dialog.showOpenDialog(window!, {
						properties: ["openFile"],
						title: "Prime Agent 실행 파일 선택",
						defaultPath: store.value.cliPath ?? undefined,
					});
					if (!selected.canceled && selected.filePaths[0]) {
						await resolveCli(selected.filePaths[0]);
						await manager.disconnect();
						await store.update((settings) => ({ ...settings, cliPath: selected.filePaths[0] }));
						await workspace?.reconnect();
					}
					manager.changed();
					value = manager.value;
					break;
				}
				case "settings.detectCli": {
					manager.ensureIdle();
					const path = await discoverCli();
					if (!path) throw new Error("Prime Agent를 찾지 못했습니다. 설치 후 실행 파일을 직접 선택하세요.");
					await resolveCli(path);
					await manager.disconnect();
					await store.update((settings) => ({ ...settings, cliPath: path }));
					await workspace?.reconnect();
					manager.changed();
					value = manager.value;
					break;
				}
				case "agent.respond":
					await manager.respond(input as InteractionReply);
					break;
				case "agent.reconnect": {
					if (workspace) {
						await workspace.reconnect();
						value = manager.value;
						break;
					}
					const previous = manager.value;
					const path =
						previous.state?.sessionFile && previous.project
							? await validateSessionFile(previous.state.sessionFile, previous.project.path)
							: null;
					await manager.connect();
					if (path) await manager.sessionCommand({ type: "switch_session", sessionPath: path });
					value = manager.value;
					break;
				}
				case "agent.connect":
					await manager.connect();
					value = manager.value;
					break;
				case "agent.disconnect":
					await manager.disconnect();
					value = manager.value;
					break;
				case "attachment.select": {
					const selected = await dialog.showOpenDialog(window!, {
						properties: ["openFile", "multiSelections"],
						title: "첨부파일 선택",
					});
					value = selected.canceled ? [] : await attachments.select(selected.filePaths);
					break;
				}
				case "attachment.remove":
					attachments.remove(args.id as string);
					break;
				case "agent.prompt":
				case "agent.steer":
				case "agent.followUp": {
					await workspace?.ensureReady();
					if (sendEpoch !== cancellationEpoch)
						throw new Error("전송 대기를 취소했습니다. 입력 내용은 보관됩니다.");
					const payload = input as PromptPayload;
					const prepared = payload.attachmentIds?.length
						? await attachments.prepare(payload.message, payload.attachmentIds)
						: { message: payload.message };
					await manager.command({
						type: name === "agent.prompt" ? "prompt" : name === "agent.steer" ? "steer" : "follow_up",
						...prepared,
					});
					for (const id of payload.attachmentIds ?? []) attachments.remove(id);
					break;
				}
				case "agent.abort":
					cancellationEpoch++;
					if (
						!manager.value.state &&
						manager.value.connection !== "connected" &&
						!manager.value.interactions.some((item) => item.status === "pending")
					)
						break;
					await manager.command({ type: "abort" });
					break;
				case "agent.refresh":
					await manager.refresh();
					value = manager.value;
					break;
				case "agent.copyDiagnostics":
					clipboard.writeText(
						manager.value.diagnostics.map((d) => `${d.time} [${d.level}] ${d.message}`).join("\n"),
					);
					break;
				case "session.list":
					value = await listSessions();
					break;
				case "session.open": {
					manager.ensureIdle();
					const saved = (await listSessions()).find(
						(session) => session.path === args.path && session.projectPath === args.projectPath,
					);
					if (!saved) throw new Error("저장된 세션을 찾을 수 없습니다. 목록을 새로고침하세요.");
					const path = await validateSessionFile(saved.path, saved.projectPath);
					if (manager.value.project?.path !== saved.projectPath)
						await manager.setProject(
							await (workspace ? workspace.project(saved.projectPath) : projects.open(saved.projectPath, true)),
						);
					if (manager.value.connection !== "connected") await manager.connect();
					await manager.sessionCommand({ type: "switch_session", sessionPath: path });
					value = manager.value;
					break;
				}
				case "session.create": {
					manager.ensureIdle();
					if (manager.value.project?.path !== args.path)
						await manager.setProject(await projects.open(args.path as string, true));
					if (manager.value.connection !== "connected") await manager.connect();
					await manager.sessionCommand({ type: "new_session" });
					value = manager.value;
					break;
				}
				case "session.new":
					await workspace?.ensureReady();
					await manager.sessionCommand({ type: "new_session" });
					value = manager.value;
					break;
				case "session.newGeneral":
					if (!workspace) throw new Error("일반 대화 서비스를 사용할 수 없습니다.");
					await workspace.newGeneral();
					value = manager.value;
					break;
				case "session.resume": {
					manager.ensureIdle();
					const cwd = manager.value.project?.path;
					if (!cwd) throw new Error("먼저 프로젝트를 선택하세요.");
					const selected = await dialog.showOpenDialog(window!, {
						properties: ["openFile"],
						title: "Prime Agent 세션 열기",
						filters: [{ name: "Prime Agent session", extensions: ["jsonl"] }],
					});
					if (!selected.canceled && selected.filePaths[0]) {
						const path = await validateSessionFile(selected.filePaths[0], cwd);
						if (tasks?.ownsSession(path))
							throw new Error(
								"이 세션은 에이전트 작업에서 관리합니다. 작업 패널에서 결과를 확인하거나 재개하세요.",
							);
						await manager.sessionCommand({ type: "switch_session", sessionPath: path });
						await rememberSession(path);
					}
					value = manager.value;
					break;
				}
				case "session.setName":
					await manager.sessionCommand({ type: "set_session_name", name: args.name as string });
					value = manager.value;
					break;
				case "model.list":
					value = await manager.models();
					break;
				case "model.select":
					await manager.sessionCommand({
						type: "set_model",
						provider: args.provider as string,
						modelId: args.modelId as string,
					});
					value = manager.value;
					break;
				case "model.setThinkingLevel":
					await manager.sessionCommand({ type: "set_thinking_level", level: args.level as string });
					value = manager.value;
					break;
			}
			if (lifecycle)
				await workspace
					?.remember(
						manager.value.state?.sessionId !== priorSession &&
							[
								"agent.connect",
								"session.new",
								"session.newGeneral",
								"session.open",
								"session.create",
								"session.resume",
								"project.selectDirectory",
								"project.openRecent",
							].includes(name),
					)
					.catch((error) => manager.diagnostic(manager.redactor.error(error), "error"));
			return { ok: true, value };
		} catch (error) {
			const message = manager.redactor.error(error);
			manager.diagnostic(message, "error");
			return { ok: false, error: message };
		} finally {
			if (counted) activeRequests--;
			if (locked) lifecycleBusy = false;
		}
	});
}
