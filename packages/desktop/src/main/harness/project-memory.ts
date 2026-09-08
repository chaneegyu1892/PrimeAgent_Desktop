import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Redactor } from "../agent/redaction";

export interface MemoryEntry {
	key: string;
	content: string;
	source: string;
	updatedAt: string;
}
export class ProjectMemory {
	private writes = new Map<string, Promise<unknown>>();
	private stopped = false;
	constructor(
		private root: string,
		private redactor = new Redactor(),
	) {}
	private async file(projectPath: string) {
		return join(
			this.root,
			`${createHash("sha256")
				.update(await realpath(projectPath))
				.digest("hex")}.json`,
		);
	}
	async list(projectPath: string, query = ""): Promise<MemoryEntry[]> {
		const file = await this.file(projectPath);
		await this.writes.get(file)?.catch(() => {});
		const entries = await this.read(file);
		const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean).slice(0, 20);
		return entries
			.filter(
				(entry) =>
					!terms.length ||
					terms.some((term) => `${entry.key} ${entry.content}`.toLocaleLowerCase().includes(term)),
			)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}
	private async read(file: string): Promise<MemoryEntry[]> {
		try {
			const content = await readFile(file, "utf8");
			if (content.length > 2_000_000) throw new Error("oversize");
			const data: unknown = JSON.parse(content);
			if (!Array.isArray(data) || data.length > 200) throw new Error("invalid");
			const keys = new Set<string>();
			for (const entry of data) {
				validateMemory(entry);
				if (keys.has(entry.key) || !("updatedAt" in entry) || typeof entry.updatedAt !== "string")
					throw new Error("invalid");
				keys.add(entry.key);
			}
			return data as MemoryEntry[];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw new Error("프로젝트 기억을 읽지 못했습니다. 기존 파일은 보존했습니다.");
		}
	}
	async save(projectPath: string, entry: Pick<MemoryEntry, "key" | "content" | "source">) {
		validateMemory(entry);
		if (
			this.redactor.text(`${entry.key}\n${entry.content}\n${entry.source}`) !==
			`${entry.key}\n${entry.content}\n${entry.source}`
		)
			throw new Error("비밀 값은 프로젝트 기억에 저장할 수 없습니다.");
		await this.change(projectPath, (entries) => {
			if (!entries.some((item) => item.key === entry.key) && entries.length >= 200)
				throw new Error("프로젝트 기억은 최대 200개입니다.");
			return [
				...entries.filter((item) => item.key !== entry.key),
				{ ...entry, updatedAt: new Date().toISOString() },
			];
		});
	}
	async forget(projectPath: string, key: string) {
		await this.change(projectPath, (entries) => entries.filter((entry) => entry.key !== key));
	}
	private async change(projectPath: string, update: (entries: MemoryEntry[]) => MemoryEntry[]) {
		const file = await this.file(projectPath);
		if (this.stopped) throw new Error("앱을 종료하고 있습니다.");
		const work = (this.writes.get(file) ?? Promise.resolve())
			.catch(() => {})
			.then(async () => {
				const entries = update(await this.read(file));
				await mkdir(this.root, { recursive: true });
				await writeFile(`${file}.tmp`, JSON.stringify(entries, null, 2), { mode: 0o600 });
				await rename(`${file}.tmp`, file);
			});
		this.writes.set(file, work);
		try {
			await work;
		} finally {
			if (this.writes.get(file) === work) this.writes.delete(file);
		}
	}
	async shutdown() {
		this.stopped = true;
		await Promise.allSettled(this.writes.values());
	}
}
export function validateMemory(input: unknown): asserts input is Pick<MemoryEntry, "key" | "content" | "source"> {
	if (!input || typeof input !== "object") throw new Error("기억 내용을 확인하세요.");
	const entry = input as Record<string, unknown>;
	for (const [key, limit] of [
		["key", 120],
		["content", 8000],
		["source", 1000],
	] as const)
		if (
			typeof entry[key] !== "string" ||
			!(entry[key] as string).trim() ||
			(entry[key] as string).length > limit ||
			(entry[key] as string).includes("\0")
		)
			throw new Error("기억의 제목·내용·근거를 입력하세요.");
}
