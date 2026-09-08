import { randomUUID } from "node:crypto";
import type { AgentState, DesktopSnapshot, ModelInfo, Project } from "../../shared/dto";
import { EMPTY_SNAPSHOT } from "../../shared/dto";
import type { AgentNotice, InteractionReply } from "../../shared/interactions";
import { record } from "../../shared/ipc-contract";
import type { SettingsStore } from "../settings/settings-store";
import type { AgentTransport, RpcCommand, TransportEvent } from "./agent-transport";
import { InteractionStore } from "./interaction-store";
import { contentText, modelInfo, projectMessage, projectState } from "./projection";
import { Redactor } from "./redaction";

export class AgentManager {
	private snapshot: DesktopSnapshot = structuredClone(EMPTY_SNAPSHOT);
	private transport: AgentTransport | null = null;
	private unsubscribe?: () => void;
	private listeners = new Set<(snapshot: DesktopSnapshot) => void>();
	private emission?: NodeJS.Timeout;
	private transition = false;
	private promptPending = false;
	private refreshPromise?: Promise<void>;
	private eventVersion = 0;
	private shuttingDown = false;
	private interactions: InteractionStore;
	constructor(
		private store: SettingsStore,
		private createTransport: () => Promise<AgentTransport>,
		readonly redactor = new Redactor(),
	) {
		this.interactions = new InteractionStore(
			(reply) => this.getTransport().request(reply),
			() => this.changed(),
			redactor,
		);
	}
	get value(): DesktopSnapshot {
		return structuredClone({
			...this.snapshot,
			interactions: this.interactions.value,
			recent: this.store.value.recent,
			cliPath: this.store.value.cliPath,
		});
	}
	get busy(): boolean {
		return (
			this.transition ||
			this.interactions.waiting ||
			this.promptPending ||
			!!this.snapshot.state?.isStreaming ||
			!!this.snapshot.state?.isCompacting
		);
	}
	setInitializing(value: boolean): void {
		this.snapshot.initializing = value;
		this.changed();
	}
	userNotice(message: string): void {
		this.snapshot.notices.push({
			id: randomUUID(),
			kind: "notify",
			text: this.redactor.text(message),
			isError: false,
		});
		this.snapshot.notices = this.snapshot.notices.slice(-20);
		this.changed();
	}
	subscribe(listener: (snapshot: DesktopSnapshot) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	changed(): void {
		if (this.shuttingDown) return;
		this.snapshot.revision++;
		if (!this.emission)
			this.emission = setTimeout(() => {
				this.emission = undefined;
				const value = this.value;
				for (const listener of this.listeners) listener(value);
			}, 40);
	}
	diagnostic(message: string, level: "info" | "error" = "info"): void {
		this.snapshot.diagnostics.push({
			time: new Date().toISOString(),
			level,
			message: this.redactor.text(message).slice(0, 16_384),
		});
		this.snapshot.diagnostics = this.snapshot.diagnostics.slice(-200);
		this.changed();
	}
	ensureIdle(): void {
		if (this.shuttingDown) throw new Error("앱을 종료하고 있습니다.");
		if (this.busy) throw new Error("진행 중인 작업을 중단한 후 다시 시도하세요.");
	}
	async setProject(project: Project): Promise<void> {
		this.ensureIdle();
		await this.disconnect();
		this.snapshot.project = project;
		this.snapshot.messages = [];
		this.snapshot.activity = [];
		this.snapshot.state = null;
		this.snapshot.error = null;
		this.interactions.clear();
		this.snapshot.notices = [];
		this.snapshot.runStatus = "idle";
		this.changed();
	}
	async connect(): Promise<void> {
		this.ensureIdle();
		if (!this.snapshot.project) throw new Error("먼저 프로젝트 폴더를 선택하세요.");
		if (this.transport) await this.disconnect();
		this.interactions.clear();
		this.transition = true;
		this.snapshot.connection = "connecting";
		this.snapshot.error = null;
		this.changed();
		try {
			const transport = await this.createTransport();
			if (this.shuttingDown) {
				await transport.close();
				throw new Error("앱을 종료하고 있습니다.");
			}
			this.transport = transport;
			this.unsubscribe = transport.subscribe((event) => {
				if (this.transport === transport) this.onEvent(event);
			});
			await transport.start(this.snapshot.project.path);
			await this.refresh();
			this.snapshot.connection = "connected";
			this.diagnostic("Prime Agent RPC 연결 완료. 기존 인증과 세션 설정을 사용합니다.");
		} catch (error) {
			this.snapshot.connection = "error";
			this.snapshot.error = this.redactor.error(error);
			this.diagnostic(this.snapshot.error, "error");
			await this.transport?.close();
			this.unsubscribe?.();
			this.transport = null;
			throw error;
		} finally {
			this.transition = false;
			this.changed();
		}
	}
	async disconnect(): Promise<void> {
		if (this.transition) throw new Error("연결 변경이 진행 중입니다.");
		this.transition = true;
		try {
			await this.interactions.close(false);
			this.unsubscribe?.();
			this.unsubscribe = undefined;
			const transport = this.transport;
			this.transport = null;
			this.refreshPromise = undefined;
			await transport?.close();
			this.snapshot.connection = "disconnected";
			if (this.snapshot.state)
				this.snapshot.state = { ...this.snapshot.state, isStreaming: false, isCompacting: false };
		} finally {
			this.transition = false;
			this.changed();
		}
	}
	async shutdown(): Promise<void> {
		// Quit can happen while readiness is still pending; closing rejects that request.
		this.shuttingDown = true;
		await this.interactions.close(false);
		const transport = this.transport;
		this.unsubscribe?.();
		this.listeners.clear();
		await transport?.close();
		if (this.emission) clearTimeout(this.emission);
	}
	private getTransport(): AgentTransport {
		if (!this.transport) throw new Error("Prime Agent에 먼저 연결하세요.");
		return this.transport;
	}
	async respond(reply: InteractionReply): Promise<void> {
		await this.interactions.respond(reply);
	}
	async command(command: RpcCommand): Promise<void> {
		if (this.transition && command.type !== "abort") throw new Error("연결 변경이 진행 중입니다.");
		if (command.type === "prompt" && this.busy) throw new Error("실행 중에는 추가 지시 또는 후속 작업을 선택하세요.");
		const transport = this.getTransport();
		if (command.type === "prompt") {
			this.promptPending = true;
			this.snapshot.runStatus = "running";
			this.snapshot.error = null;
		}
		if (command.type === "abort") {
			this.snapshot.runStatus = "stopping";
			this.changed();
			await this.interactions.close(true);
		}
		try {
			await transport.request(command);
			if (command.type === "abort") {
				this.snapshot.runStatus = "stopped";
				this.updateState({ isStreaming: false, isCompacting: false });
				this.changed();
			}
		} catch (error) {
			this.snapshot.runStatus = "error";
			this.changed();
			throw error;
		} finally {
			if (command.type === "prompt") this.promptPending = false;
		}
		// Acceptance is authoritative even if the subsequent display refresh fails.
		if (this.transport === transport)
			await this.refresh().catch((error) => this.diagnostic(this.redactor.error(error), "error"));
	}
	async sessionCommand(command: RpcCommand): Promise<void> {
		this.ensureIdle();
		this.transition = true;
		try {
			const result = await this.getTransport().request(command);
			if (record(result).cancelled === true) throw new Error("Prime Agent 확장 기능이 세션 변경을 취소했습니다.");
			if (command.type === "new_session" || command.type === "switch_session") {
				this.snapshot.activity = [];
				this.interactions.clear();
				this.snapshot.notices = [];
				this.snapshot.runStatus = "idle";
			}
			await this.refresh();
		} finally {
			this.transition = false;
		}
	}
	async models(): Promise<ModelInfo[]> {
		const result = record(await this.getTransport().request({ type: "get_available_models" }));
		return Array.isArray(result.models) ? result.models.map(modelInfo).filter((m): m is ModelInfo => !!m) : [];
	}
	async refresh(): Promise<void> {
		if (this.refreshPromise) {
			await this.refreshPromise;
			if (!this.transport) return;
		}
		const transport = this.getTransport();
		const version = this.eventVersion;
		const work = async () => {
			const [state, messagesResult] = await Promise.all([
				transport.request({ type: "get_state" }),
				transport.request({ type: "get_messages" }),
			]);
			if (transport !== this.transport) return;
			const parsed = projectState(state, this.redactor);
			// A snapshot requested before a live event must not roll the timeline back.
			if (version !== this.eventVersion) return;
			const messages = record(messagesResult).messages;
			if (!Array.isArray(messages)) throw new Error("Prime Agent 메시지 응답이 올바르지 않습니다.");
			this.snapshot.state = parsed;
			this.snapshot.messages = messages.slice(-1000).flatMap((value) => {
				const m = projectMessage(value, this.redactor);
				return m ? [m] : [];
			});
			this.changed();
		};
		const promise = work();
		this.refreshPromise = promise;
		try {
			await promise;
		} finally {
			if (this.refreshPromise === promise) this.refreshPromise = undefined;
		}
	}
	private updateState(patch: Partial<AgentState>): void {
		if (this.snapshot.state) this.snapshot.state = { ...this.snapshot.state, ...patch };
	}
	private finishOpenActivity(): void {
		this.snapshot.activity = this.snapshot.activity.map((item) =>
			item.type.endsWith("_start") || item.type.endsWith("_update")
				? { ...item, type: "tool_execution_interrupted" }
				: item,
		);
	}
	private notice(data: Record<string, unknown>): void {
		const methods: Record<string, AgentNotice["kind"]> = {
			notify: "notify",
			setStatus: "status",
			setWidget: "widget",
			setTitle: "title",
			set_editor_text: "draft",
		};
		const kind = methods[String(data.method)];
		if (!kind) return;
		const raw =
			kind === "widget"
				? Array.isArray(data.widgetLines)
					? data.widgetLines
							.slice(0, 100)
							.filter((line) => typeof line === "string")
							.join("\n")
					: ""
				: kind === "status"
					? data.statusText
					: kind === "title"
						? data.title
						: kind === "draft"
							? data.text
							: data.message;
		const text = typeof raw === "string" ? this.redactor.text(raw).slice(0, 100_000) : "";
		const id =
			kind === "status"
				? `status:${String(data.statusKey).slice(0, 100)}`
				: kind === "widget"
					? `widget:${String(data.widgetKey).slice(0, 100)}`
					: kind === "draft" || kind === "title"
						? kind
						: randomUUID();
		this.snapshot.notices = this.snapshot.notices.filter((notice) => notice.id !== id);
		if (text) this.snapshot.notices.push({ id, kind, text, isError: data.notifyType === "error" });
		this.snapshot.notices = this.snapshot.notices.slice(-20);
		this.changed();
	}
	private onEvent(event: TransportEvent): void {
		if (event.kind === "diagnostic") {
			this.diagnostic(event.message);
			return;
		}
		if (event.kind === "closed") {
			void this.interactions.close(false);
			this.snapshot.runStatus = "error";
			this.snapshot.connection = "error";
			this.snapshot.error = event.error ?? "연결이 종료되었습니다.";
			this.updateState({ isStreaming: false, isCompacting: false });
			this.finishOpenActivity();
			this.diagnostic(this.snapshot.error, "error");
			return;
		}
		this.eventVersion++;
		const data = event.value;
		const type = String(data.type);
		if (type === "extension_ui_request") {
			if (["select", "confirm", "input", "editor"].includes(String(data.method))) {
				try {
					this.interactions.accept(data);
				} catch (error) {
					this.diagnostic(this.redactor.error(error), "error");
					if (typeof data.id === "string")
						void this.getTransport()
							.request({ type: "extension_ui_response", id: data.id, cancelled: true })
							.catch(() => {});
				}
			} else this.notice(data);
			return;
		}
		if (type === "agent_start") {
			this.snapshot.runStatus = "running";
			this.updateState({ isStreaming: true });
		}
		if (type === "auto_retry_start") this.snapshot.runStatus = "retrying";
		if (type === "auto_retry_end") this.snapshot.runStatus = data.finalError ? "error" : "running";
		if (type === "agent_end") {
			this.snapshot.runStatus =
				this.snapshot.runStatus === "stopping" || this.snapshot.runStatus === "stopped"
					? "stopped"
					: this.snapshot.messages.at(-1)?.error
						? "error"
						: "completed";
			this.updateState({ isStreaming: false });
			this.finishOpenActivity();
		}
		if (type === "compaction_start") this.updateState({ isCompacting: true });
		if (type === "compaction_end") this.updateState({ isCompacting: false });
		if (["message_start", "message_update", "message_end"].includes(type)) {
			const message = projectMessage(data.message, this.redactor);
			if (message) {
				const last = this.snapshot.messages.at(-1);
				const same =
					last?.role === message.role &&
					last?.timestamp === message.timestamp &&
					last?.toolCallId === message.toolCallId;
				if (type !== "message_start" && same) this.snapshot.messages[this.snapshot.messages.length - 1] = message;
				else this.snapshot.messages.push(message);
				this.snapshot.messages = this.snapshot.messages.slice(-1000);
			}
		}
		if (type === "session_action_update") {
			const actions = record(data.actions);
			const strings = (v: unknown) =>
				Array.isArray(v)
					? v.filter((s): s is string => typeof s === "string").map((s) => this.redactor.text(s))
					: [];
			this.updateState({
				queuedCount: typeof actions.queuedCount === "number" ? actions.queuedCount : 0,
				steering: strings(actions.steering),
				followUps: strings(actions.followUps),
			});
		}
		if (
			type.startsWith("tool_execution_") ||
			["auto_retry_start", "auto_retry_end", "extension_error", "compaction_start", "compaction_end"].includes(type)
		) {
			const toolId =
				typeof data.toolCallId === "string"
					? data.toolCallId
					: type.startsWith("auto_retry_")
						? "auto-retry"
						: type.startsWith("compaction_")
							? "compaction"
							: randomUUID();
			const args = record(data.args);
			const argumentText = [args.code, args.command, args.path]
				.filter((value): value is string => typeof value === "string")
				.join("\n");
			const detail = type.startsWith("tool_execution_")
				? contentText(record(data.partialResult ?? data.result).content) || argumentText
				: String(data.errorMessage ?? data.finalError ?? data.error ?? "");
			const activity = {
				id: toolId,
				type,
				label: typeof data.toolName === "string" ? data.toolName : type,
				detail: this.redactor.text(detail).slice(0, 16_384),
				time: new Date().toISOString(),
				isError: data.isError === true || type === "extension_error" || !!data.finalError,
			};
			const index = this.snapshot.activity.findIndex((item) => item.id === toolId);
			if (index >= 0) this.snapshot.activity[index] = activity;
			else this.snapshot.activity.push(activity);
			this.snapshot.activity = this.snapshot.activity.slice(-100);
		}
		if (["agent_end", "compaction_end"].includes(type))
			void this.refresh().catch((error) => this.diagnostic(this.redactor.error(error), "error"));
		this.changed();
	}
}
