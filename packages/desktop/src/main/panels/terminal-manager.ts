import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { type IPty, spawn } from "node-pty";
import type { TerminalState } from "../../shared/panel-contract";

interface Entry {
	pty: IPty;
	state: TerminalState;
	timer?: NodeJS.Timeout;
	exited: Promise<void>;
}
export class TerminalManager {
	private entries = new Map<string, Entry>();
	get runningCount(): number {
		return [...this.entries.values()].filter((entry) => entry.state.running).length;
	}
	constructor(private emit: (state: TerminalState) => void) {}
	open(projectPath: string, cliPath?: string | null): TerminalState {
		const previous = [...this.entries.values()].find((entry) => entry.state.projectPath === projectPath);
		if (previous?.state.running) return { ...previous.state };
		if (previous) this.entries.delete(previous.state.id);
		for (const [id, entry] of this.entries) {
			if (!entry.state.running) {
				if (entry.timer) clearTimeout(entry.timer);
				this.entries.delete(id);
			}
		}
		if (this.entries.size >= 8)
			throw new Error("열린 터미널을 닫은 뒤 다시 시도하세요. 최대 8개까지 열 수 있습니다.");
		const env: NodeJS.ProcessEnv = {
			...process.env,
			TERM: "xterm-256color",
			COLORTERM: "truecolor",
			PATH: [
				cliPath?.slice(0, cliPath.lastIndexOf("/")),
				join(homedir(), ".local/bin"),
				"/opt/homebrew/bin",
				process.env.PATH,
				"/usr/bin:/bin",
			]
				.filter(Boolean)
				.join(delimiter),
		};
		delete env.ELECTRON_RUN_AS_NODE;
		delete env.NODE_OPTIONS;
		const pty = spawn("/bin/zsh", ["-il"], { name: "xterm-256color", cwd: projectPath, env, cols: 80, rows: 24 });
		const state: TerminalState = { id: randomUUID(), projectPath, output: "", offset: 0, running: true };
		let exited!: () => void;
		const entry: Entry = {
			pty,
			state,
			exited: new Promise<void>((resolve) => {
				exited = resolve;
			}),
		};
		const append = (data: string) => {
			state.output = (state.output + data).slice(-128 * 1024);
			state.offset += data.length;
			entry.timer ??= setTimeout(() => {
				entry.timer = undefined;
				this.emit({ ...state });
			}, 30);
		};
		pty.onData(append);
		pty.onExit(({ exitCode }) => {
			state.running = false;
			append(`\r\n[프로세스 종료: ${exitCode}]\r\n`);
			exited();
		});
		this.entries.set(state.id, entry);
		return { ...state };
	}
	private entry(id: string, projectPath: string): Entry {
		const entry = this.entries.get(id);
		if (!entry || entry.state.projectPath !== projectPath) throw new Error("현재 프로젝트의 터미널을 열어주세요.");
		return entry;
	}
	write(id: string, projectPath: string, data: string): void {
		const entry = this.entry(id, projectPath);
		if (!entry.state.running) throw new Error("종료된 터미널입니다.");
		entry.pty.write(data);
	}
	resize(id: string, projectPath: string, cols: number, rows: number): void {
		const entry = this.entry(id, projectPath);
		if (entry.state.running) entry.pty.resize(cols, rows);
	}
	async close(id: string, projectPath: string): Promise<void> {
		const entry = this.entry(id, projectPath);
		if (entry.state.running) {
			entry.pty.kill();
			let timer: NodeJS.Timeout | undefined;
			await Promise.race([
				entry.exited,
				new Promise<void>((resolve) => {
					timer = setTimeout(() => {
						if (entry.state.running) entry.pty.kill("SIGKILL");
						resolve();
					}, 1500);
				}),
			]);
			if (timer) clearTimeout(timer);
		}
	}
	async shutdown(): Promise<void> {
		await Promise.all([...this.entries.values()].map((entry) => this.close(entry.state.id, entry.state.projectPath)));
		for (const entry of this.entries.values()) if (entry.timer) clearTimeout(entry.timer);
		this.entries.clear();
	}
}
