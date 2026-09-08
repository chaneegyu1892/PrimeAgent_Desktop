import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import type { Project } from "../../shared/dto";
import { record } from "../../shared/ipc-contract";

export interface Settings {
	lastConversation?: { projectPath: string; sessionFile?: string };
	recent: Project[];
	sessionFiles?: string[];
	cliPath: string | null;
}
export class SettingsStore {
	private current: Settings = { recent: [], cliPath: null };
	private tail = Promise.resolve();
	private loadFailed = false;
	constructor(private path: string) {}
	get value(): Settings {
		return structuredClone(this.current);
	}
	async load(): Promise<void> {
		let raw: unknown;
		try {
			raw = JSON.parse(await readFile(this.path, "utf8"));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			this.loadFailed = true;
			throw new Error("데스크톱 설정 파일을 읽을 수 없습니다. 기존 파일은 보존했습니다.");
		}
		const data = record(raw);
		const last = record(data.lastConversation);
		const recent: Project[] = [];
		if (Array.isArray(data.recent)) {
			for (const item of data.recent.slice(0, 20)) {
				const p = record(item);
				if (
					typeof p.path === "string" &&
					isAbsolute(p.path) &&
					typeof p.name === "string" &&
					typeof p.lastOpened === "string"
				) {
					recent.push({ path: p.path, name: p.name, lastOpened: p.lastOpened });
				}
			}
		}
		this.current = {
			...(typeof last.projectPath === "string" && isAbsolute(last.projectPath) && !last.projectPath.includes("\0")
				? {
						lastConversation: {
							projectPath: last.projectPath,
							...(typeof last.sessionFile === "string" &&
							isAbsolute(last.sessionFile) &&
							!last.sessionFile.includes("\0")
								? { sessionFile: last.sessionFile }
								: {}),
						},
					}
				: {}),
			recent,
			sessionFiles: Array.isArray(data.sessionFiles)
				? data.sessionFiles
						.filter((path): path is string => typeof path === "string" && isAbsolute(path))
						.slice(0, 200)
				: [],
			cliPath: typeof data.cliPath === "string" && isAbsolute(data.cliPath) ? data.cliPath : null,
		};
	}
	update(update: (settings: Settings) => Settings): Promise<void> {
		const operation = this.tail.then(async () => {
			if (this.loadFailed)
				throw new Error("설정 파일 복구 후 앱을 다시 실행하세요. 기존 파일을 덮어쓰지 않았습니다.");
			const next = update(this.value);
			await mkdir(dirname(this.path), { recursive: true });
			await writeFile(`${this.path}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
			await rename(`${this.path}.tmp`, this.path);
			this.current = next;
		});
		this.tail = operation.catch(() => {});
		return operation;
	}
}
