import { mkdir, realpath } from "node:fs/promises";
import type { Project } from "../../shared/dto";
import type { AgentManager } from "../agent/agent-manager";
import type { ProjectManager } from "../projects/project-manager";
import type { SettingsStore } from "../settings/settings-store";

/** Owns startup and workspace selection; never replays a user request. */
export class WorkspaceController {
	private starting?: Promise<void>;
	private restoreFailure = false;
	personal?: Project;
	constructor(
		private manager: AgentManager,
		private projects: ProjectManager,
		private store: SettingsStore,
		private directory: string,
		private validateSession: (file: string, cwd: string) => Promise<string>,
	) {}
	start(): Promise<void> {
		if (!this.starting) {
			this.manager.setInitializing(true);
			this.starting = this.initialize().finally(() => this.manager.setInitializing(false));
		}
		return this.starting;
	}
	async settled(): Promise<void> {
		await this.start().catch(() => {});
	}
	private async initialize(): Promise<void> {
		await mkdir(this.directory, { recursive: true });
		this.personal = {
			path: await realpath(this.directory),
			name: "일반 대화",
			kind: "personal",
			lastOpened: new Date().toISOString(),
		};
		const last = this.store.value.lastConversation;
		let project = this.personal;
		let session: string | undefined;
		let recoveryNotice = "";
		if (last) {
			try {
				project = await this.project(last.projectPath);
				if (last.sessionFile) session = await this.validateSession(last.sessionFile, project.path);
			} catch {
				project = this.personal;
				recoveryNotice =
					"마지막 대화의 폴더 또는 기록을 찾지 못해 일반 대화를 열었습니다. 프로젝트를 다시 선택하거나 저장된 대화를 열 수 있습니다.";
			}
		}
		await this.manager.setProject(project);
		if (recoveryNotice) this.manager.userNotice(recoveryNotice);
		await this.manager.connect();
		if (session) {
			try {
				await this.manager.sessionCommand({ type: "switch_session", sessionPath: session });
			} catch (error) {
				this.restoreFailure = true;
				this.manager.userNotice(
					"이전 대화 자동 복원에 실패했습니다. 최근 목록에서 다시 열어주세요. 기존 대화에 요청을 자동 전송하지 않습니다.",
				);
				throw error;
			}
		}
		await this.remember();
	}
	async project(path: string): Promise<Project> {
		if (path === this.personal?.path) return this.personal;
		return this.projects.open(path, true);
	}
	async ensureReady(): Promise<void> {
		await this.settled();
		if (this.restoreFailure)
			throw new Error("이전 대화 복원에 실패했습니다. 다시 연결하거나 새 대화를 시작한 뒤 전송하세요.");
		if (this.manager.value.connection === "connected") return;
		// Failed startup is surfaced; only a new explicit user send/retry starts another attempt.
		await this.reconnect();
	}
	async reconnect(): Promise<void> {
		const previous = this.manager.value;
		const session =
			(this.restoreFailure ? this.store.value.lastConversation?.sessionFile : previous.state?.sessionFile) &&
			previous.project
				? await this.validateSession(
						(this.restoreFailure ? this.store.value.lastConversation?.sessionFile : previous.state?.sessionFile)!,
						previous.project.path,
					)
				: undefined;
		if (!previous.project && this.personal) await this.manager.setProject(this.personal);
		await this.manager.connect();
		if (session) await this.manager.sessionCommand({ type: "switch_session", sessionPath: session });
		this.restoreFailure = false;
	}
	async newGeneral(): Promise<void> {
		await this.settled();
		if (!this.personal) throw new Error("일반 대화 작업 공간을 준비하지 못했습니다.");
		this.manager.ensureIdle();
		if (this.manager.value.project?.path !== this.personal.path) {
			await this.manager.setProject(this.personal);
			await this.manager.connect();
		} else {
			if (this.restoreFailure) await this.manager.connect();
			else await this.ensureReady();
			await this.manager.sessionCommand({ type: "new_session" });
		}
		this.restoreFailure = false;
	}
	async remember(explicitNavigation = false): Promise<void> {
		if (explicitNavigation) this.restoreFailure = false;
		if (this.restoreFailure) return;
		const { project, state, connection } = this.manager.value;
		if (!project || connection !== "connected") return;
		const lastConversation = {
			projectPath: project.path,
			...(state?.sessionFile ? { sessionFile: state.sessionFile } : {}),
		};
		if (JSON.stringify(lastConversation) === JSON.stringify(this.store.value.lastConversation)) return;
		await this.store.update((settings) => ({ ...settings, lastConversation }));
	}
}
