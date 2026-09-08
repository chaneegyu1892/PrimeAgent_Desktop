import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Project, SavedSession } from "../../shared/dto";
import { record } from "../../shared/ipc-contract";
import { contentText } from "../agent/projection";
import type { Redactor } from "../agent/redaction";

export function sessionDirectory(env = process.env, home = homedir()): string {
	const expand = (path: string) =>
		path === "~" ? home : path.startsWith("~/") ? join(home, path.slice(2)) : resolve(path);
	const override = env.PRIME_AGENT_SESSION_DIR ?? env.PRIME_AGENT_CODING_AGENT_SESSION_DIR;
	return override
		? expand(override)
		: join(expand(env.PRIME_AGENT_CODING_AGENT_DIR || join(home, ".prime/agent")), "sessions");
}
export class SessionCatalog {
	private cache = new Map<string, { stamp: string; session: SavedSession | null }>();
	constructor(
		private directory: string,
		private redactor: Redactor,
	) {}
	async list(projects: Project[], imported: string[] = []): Promise<SavedSession[]> {
		const entries = await readdir(this.directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return [];
			throw new Error("저장된 세션 목록을 읽지 못했습니다.");
		});
		const paths = [
			...new Set([
				...entries.filter((e) => e.isFile() && e.name.endsWith(".jsonl")).map((e) => join(this.directory, e.name)),
				...imported,
			]),
		];
		const allowed = new Set(projects.map((project) => project.path));
		const result: SavedSession[] = [];
		for (const path of paths) {
			const session = await this.read(path).catch(() => null);
			if (session && allowed.has(session.projectPath)) result.push(session);
		}
		const present = new Set(paths);
		for (const path of this.cache.keys()) if (!present.has(path)) this.cache.delete(path);
		return result.sort((a, b) => b.modified.localeCompare(a.modified));
	}
	private async read(path: string): Promise<SavedSession | null> {
		const details = await stat(path);
		if (!details.isFile()) return null;
		const stamp = `${details.ino}:${details.size}:${details.mtimeMs}`;
		const cached = this.cache.get(path);
		if (cached?.stamp === stamp) return cached.session;
		let header: Record<string, unknown> | undefined;
		let name = "";
		let first = "";
		let activity = 0;
		const fold = (line: string) => {
			try {
				const entry = record(JSON.parse(line));
				if (!header) {
					header = entry;
					return;
				}
				if (entry.type === "session_info" && typeof entry.name === "string") name = entry.name.trim();
				const message = record(entry.message);
				if (entry.type === "message" && ["user", "assistant"].includes(String(message.role))) {
					const time =
						typeof message.timestamp === "number" ? message.timestamp : Date.parse(String(entry.timestamp));
					if (Number.isFinite(time)) activity = Math.max(activity, time);
					if (message.role === "user" && !first) first = contentText(message.content).replace(/\s+/g, " ").trim();
				}
			} catch {
				/* An append may be incomplete; keep the last complete metadata. */
			}
		};
		// Bound memory even when a saved image or tool result occupies a multi-megabyte JSON line.
		let pending = "";
		let oversized = false;
		for await (const chunk of createReadStream(path, { encoding: "utf8", highWaterMark: 64 * 1024 })) {
			const lines = String(chunk).split("\n");
			for (let i = 0; i < lines.length; i++) {
				if (!oversized) pending += lines[i];
				if (pending.length > 1024 * 1024) {
					pending = "";
					oversized = true;
				}
				if (i < lines.length - 1) {
					if (!oversized && pending.trim()) fold(pending);
					pending = "";
					oversized = false;
				}
			}
			if (header && header.type !== "session") break;
		}
		let session: SavedSession | null = null;
		if (header?.type === "session" && typeof header.id === "string" && typeof header.cwd === "string") {
			const cwd = header.cwd;
			const projectPath = await realpath(cwd).catch(() => resolve(cwd));
			session = {
				id: header.id,
				path: await realpath(path),
				projectPath,
				title: this.redactor.text(name || first || "새 세션").slice(0, 120),
				modified: new Date(activity || details.mtimeMs).toISOString(),
			};
		}
		this.cache.set(path, { stamp, session });
		return session;
	}
}
