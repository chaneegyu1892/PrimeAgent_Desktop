import type { DesktopSnapshot } from "../../shared/dto";
import type { InteractionReply } from "../../shared/interactions";
import { record } from "../../shared/ipc-contract";
import type { PanelEvent, PanelRequestName } from "../../shared/panel-contract";
import type { AgentManager } from "../agent/agent-manager";
import { AsideBrowser } from "./aside-browser";
import { listFiles, projectDiff, readProjectFile, reviewProject } from "./project-files";
import { TerminalManager } from "./terminal-manager";

export class PanelService {
	private browser = new AsideBrowser();
	private terminals: TerminalManager;
	private chats = new Map<string, AgentManager>();
	private chatBusy = new Set<string>();
	private stopped = false;
	updateBlockers(): string[] {
		const blockers: string[] = [];
		if (
			this.chatBusy.size ||
			[...this.chats.values()].some(
				(chat) =>
					chat.busy ||
					chat.value.state?.queuedCount ||
					["running", "retrying", "stopping"].includes(chat.value.runStatus),
			)
		)
			blockers.push("사이드 채팅 작업이나 답변 대기를 먼저 마무리하세요.");
		if (this.terminals.runningCount)
			blockers.push(`열린 터미널 ${this.terminals.runningCount}개를 먼저 종료하세요. 실행 중인 명령을 보호합니다.`);
		return blockers;
	}
	constructor(
		private snapshot: () => DesktopSnapshot,
		private createChat: () => AgentManager,
		private emit: (event: PanelEvent) => void,
	) {
		this.terminals = new TerminalManager((state) => emit({ type: "terminal", state }));
	}
	private project(path?: unknown) {
		const project = this.snapshot().project;
		if (!project || (path !== undefined && project.path !== path))
			throw new Error("현재 프로젝트를 다시 선택하세요.");
		return project;
	}
	async handle(name: PanelRequestName, input: unknown): Promise<unknown> {
		if (this.stopped) throw new Error("앱을 종료하고 있습니다.");
		const args = record(input);
		switch (name) {
			case "panel.browserTabs":
				return this.browser.list();
			case "panel.browserOpen":
				return this.browser.open(args.url as string);
			case "panel.browserRead":
				return this.browser.read(args.id as string);
			case "panel.files":
				return listFiles(this.project(args.projectPath).path, args.path as string);
			case "panel.file":
				return readProjectFile(this.project(args.projectPath).path, args.path as string);
			case "panel.review":
				return reviewProject(this.project(args.projectPath).path);
			case "panel.diff":
				return projectDiff(this.project(args.projectPath).path, args.path as string, args.staged as boolean);
			case "panel.terminalOpen":
				return this.terminals.open(this.project(args.projectPath).path, this.snapshot().cliPath);
			case "panel.terminalWrite":
				return this.terminals.write(args.id as string, this.project().path, args.data as string);
			case "panel.terminalResize":
				return this.terminals.resize(
					args.id as string,
					this.project().path,
					args.cols as number,
					args.rows as number,
				);
			case "panel.terminalClose":
				return this.terminals.close(args.id as string, this.project().path);
			case "panel.chatRespond": {
				const chat = this.chats.get(args.projectPath as string);
				if (!chat) throw new Error("사이드 채팅을 찾을 수 없습니다.");
				return chat.respond(args.reply as InteractionReply);
			}
			case "panel.chatState":
				return this.chats.get(this.project(args.projectPath).path)?.value ?? null;
			case "panel.chatAbort":
				return this.chats.get(this.project(args.projectPath).path)?.command({ type: "abort" });
			case "panel.chatNew": {
				const manager = this.chats.get(this.project(args.projectPath).path);
				if (manager) await manager.sessionCommand({ type: "new_session" });
				return;
			}
			case "panel.chatSend": {
				const project = this.project(args.projectPath);
				if (this.chatBusy.has(project.path)) throw new Error("이전 요청을 처리하고 있습니다.");
				this.chatBusy.add(project.path);
				try {
					let chat = this.chats.get(project.path);
					if (!chat) {
						if (this.chats.size >= 8) throw new Error("사이드 채팅은 최대 8개 프로젝트까지 지원합니다.");
						chat = this.createChat();
						this.chats.set(project.path, chat);
						chat.subscribe((snapshot) => this.emit({ type: "chat", projectPath: project.path, snapshot }));
						await chat.setProject(project);
					}
					if (chat.value.connection !== "connected") {
						const previousSession = chat.value.state?.sessionFile;
						await chat.connect();
						if (previousSession)
							await chat.sessionCommand({ type: "switch_session", sessionPath: previousSession });
						await chat.sessionCommand({ type: "set_session_name", name: "사이드 채팅" });
					}
					const running = chat.value.state?.isStreaming || chat.value.state?.isCompacting;
					await chat.command({
						type: args.mode === "followUp" ? "follow_up" : args.mode === "steer" || running ? "steer" : "prompt",
						message: args.message as string,
					});
				} finally {
					this.chatBusy.delete(project.path);
				}
				return;
			}
		}
	}
	async shutdown(): Promise<void> {
		this.stopped = true;
		await Promise.all([this.terminals.shutdown(), ...[...this.chats.values()].map((chat) => chat.shutdown())]);
	}
}
