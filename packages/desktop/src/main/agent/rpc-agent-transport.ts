import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { record } from "../../shared/ipc-contract";
import type { AgentTransport, LaunchSpec, RpcCommand, TransportEvent } from "./agent-transport";
import { JsonlDecoder } from "./jsonl";
import { Redactor } from "./redaction";

interface Pending {
	command: string;
	resolve(value: unknown): void;
	reject(error: Error): void;
	timer?: NodeJS.Timeout;
	expire(): void;
}
export class RpcAgentTransport implements AgentTransport {
	readonly ownership = "owned-child" as const;
	private child: ChildProcessWithoutNullStreams | null = null;
	private pending = new Map<string, Pending>();
	private listeners = new Set<(event: TransportEvent) => void>();
	private closing = false;
	private dialogs = new Set<string>();
	private failed = false;
	private closePromise?: Promise<void>;
	constructor(
		private launch: LaunchSpec,
		private redactor = new Redactor(launch.env),
		private timeoutMs = 45_000,
	) {}
	subscribe(listener: (event: TransportEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	private emit(event: TransportEvent): void {
		for (const listener of this.listeners) listener(event);
	}
	async start(cwd: string): Promise<void> {
		if (this.child || this.closing) throw new Error("연결이 이미 시작되었습니다.");
		const child = spawn(this.launch.executable, [...this.launch.args, "--mode", "rpc"], {
			cwd,
			env: this.launch.env,
			shell: false,
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.child = child;
		const parser = new JsonlDecoder((value) => this.handleRecord(value), 128 * 1024 * 1024);
		child.stdout.on("data", (chunk: Buffer) => {
			if (this.failed) return;
			try {
				parser.push(chunk);
			} catch (error) {
				this.fail(this.redactor.error(error));
				void this.close();
			}
		});
		child.stdout.on("end", () => {
			if (this.closing || this.failed) return;
			try {
				parser.end();
			} catch (error) {
				this.fail(this.redactor.error(error));
			}
		});
		// Only release complete stderr lines; secrets may straddle OS pipe chunks.
		const decoder = new StringDecoder("utf8");
		let stderr = "";
		let overflow = false;
		const consumeStderr = (text: string) => {
			for (const piece of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
				const complete = piece.endsWith("\n");
				if (!overflow) stderr += piece;
				if (stderr.length > 16_384) {
					stderr = "";
					overflow = true;
				}
				if (complete) {
					this.emit({
						kind: "diagnostic",
						message: overflow ? "[긴 stderr 줄 생략]" : this.redactor.text(stderr.trimEnd()),
					});
					stderr = "";
					overflow = false;
				}
			}
		};
		child.stderr.on("data", (chunk: Buffer) => consumeStderr(decoder.write(chunk)));
		child.stderr.on("end", () => {
			consumeStderr(decoder.end());
			if (stderr || overflow) consumeStderr("\n");
		});
		child.on("error", (error) => this.fail(this.redactor.error(error)));
		child.stdin.on("error", (error) => {
			if (!this.closing) this.fail(this.redactor.error(error));
		});
		child.on("close", (code, signal) => {
			this.rejectPending(new Error("Prime Agent 연결이 종료되었습니다."));
			if (!this.closing && !this.failed)
				this.fail(`Prime Agent 종료 (code ${code}, signal ${signal ?? "없음"}). 진단 로그를 확인하세요.`);
			this.child = null;
		});
		try {
			await this.request({ type: "get_state" });
		} catch (error) {
			await this.close();
			throw error;
		}
	}
	private fail(message: string): void {
		if (this.failed || this.closing) return;
		this.failed = true;
		this.rejectPending(new Error(message));
		this.emit({ kind: "closed", error: message });
	}
	private rejectPending(error: Error): void {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
	}
	private handleRecord(value: unknown): void {
		const data = record(value);
		if (typeof data.type !== "string") throw new Error("RPC 이벤트 형식이 올바르지 않습니다.");
		if (data.type === "response") {
			const pending = typeof data.id === "string" ? this.pending.get(data.id) : undefined;
			if (!pending) return;
			if (data.command !== pending.command || typeof data.success !== "boolean")
				throw new Error("RPC 응답과 요청이 일치하지 않습니다.");
			this.pending.delete(data.id as string);
			clearTimeout(pending.timer);
			if (!data.success)
				pending.reject(
					new Error(
						this.redactor.text(typeof data.error === "string" ? data.error : "RPC 요청이 거절되었습니다."),
					),
				);
			else pending.resolve(data.data);
			return;
		}
		if (
			data.type === "extension_ui_request" &&
			["select", "confirm", "input", "editor"].includes(String(data.method)) &&
			typeof data.id === "string"
		) {
			this.dialogs.add(data.id);
			for (const pending of this.pending.values()) clearTimeout(pending.timer);
		}
		this.emit({ kind: "event", value: data });
	}
	request(command: RpcCommand): Promise<unknown> {
		const child = this.child;
		if (!child || this.closing || this.failed || child.exitCode !== null)
			return Promise.reject(new Error("Prime Agent에 연결되어 있지 않습니다."));
		if (command.type === "extension_ui_response") {
			if (!this.dialogs.delete(command.id)) return Promise.reject(new Error("이미 종료된 입력 요청입니다."));
			if (!this.dialogs.size)
				for (const pending of this.pending.values()) pending.timer = setTimeout(pending.expire, this.timeoutMs);
			return new Promise<void>((resolve, reject) =>
				child.stdin.write(`${JSON.stringify(command)}\n`, (error) =>
					error ? reject(new Error(this.redactor.error(error))) : resolve(),
				),
			);
		}
		if (this.pending.size >= 64) return Promise.reject(new Error("처리 중인 요청이 너무 많습니다."));
		const id = randomUUID();
		return new Promise((resolve, reject) => {
			const expire = () => {
				this.pending.delete(id);
				reject(
					new Error(
						`${command.type} 응답 시간이 초과되었습니다. 실행 여부가 불확실하므로 자동 재전송하지 않습니다. 상태를 새로고침하세요.`,
					),
				);
			};
			const timer = this.dialogs.size ? undefined : setTimeout(expire, this.timeoutMs);
			this.pending.set(id, { command: command.type, resolve, reject, timer, expire });
			child.stdin.write(`${JSON.stringify({ ...command, id })}\n`, (error) => {
				if (error) {
					clearTimeout(timer);
					this.pending.delete(id);
					reject(new Error(this.redactor.error(error)));
				}
			});
		});
	}
	close(): Promise<void> {
		this.closePromise ??= this.closeChild();
		return this.closePromise;
	}
	private async closeChild(): Promise<void> {
		this.closing = true;
		this.rejectPending(new Error("연결을 종료했습니다."));
		const child = this.child;
		if (!child || child.exitCode !== null || child.signalCode !== null) return;
		await new Promise<void>((resolve) => {
			// EOF uses Prime's normal cleanup; escalation only targets our direct child.
			const term = setTimeout(() => child.kill("SIGTERM"), 5000);
			const kill = setTimeout(() => child.kill("SIGKILL"), 10_000);
			child.once("close", () => {
				clearTimeout(term);
				clearTimeout(kill);
				resolve();
			});
			child.stdin.end();
		});
		this.child = null;
	}
}
