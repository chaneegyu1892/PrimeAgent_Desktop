import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { canonicalizeFileText, restoreFileText } from "../../vendor/omo/hashline/file-text-canonicalization";
import { computeLineHash, formatHashLine } from "../../vendor/omo/hashline/hash-computation";

interface Edit {
	pos: string;
	end?: string;
	lines: string[];
}
interface CodeInput {
	action: "read" | "edit";
	path: string;
	offset?: number;
	limit?: number;
	digest?: string;
	edits?: Edit[];
}
const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const locks = new Map<string, Promise<unknown>>();
export async function codeOperation(root: string, input: CodeInput, signal?: AbortSignal) {
	if (
		!input ||
		!["read", "edit"].includes(input.action) ||
		typeof input.path !== "string" ||
		!input.path ||
		input.path.includes("\0")
	)
		throw new Error("파일 요청 형식을 확인하세요.");
	const base = await realpath(root),
		candidate = resolve(base, input.path),
		path = await realpath(candidate);
	const rel = relative(base, path);
	if (!rel || rel.startsWith("..") || isAbsolute(rel) || (await lstat(candidate)).isSymbolicLink())
		throw new Error("프로젝트 안의 일반 파일만 사용할 수 있습니다.");
	const work = async () => {
		signal?.throwIfAborted();
		const before = await lstat(path);
		if (!before.isFile() || before.size > 2_000_000) throw new Error("2 MB 이하의 텍스트 파일만 지원합니다.");
		const bytes = await readFile(path);
		const raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
		if (raw.includes("\0")) throw new Error("바이너리 파일은 수정할 수 없습니다.");
		const envelope = canonicalizeFileText(raw),
			lines = envelope.content.split("\n"),
			fingerprint = digest(bytes);
		if (input.action === "read") {
			const offset = input.offset ?? 1,
				limit = input.limit ?? 200;
			if (!Number.isInteger(offset) || offset < 1 || !Number.isInteger(limit) || limit < 1 || limit > 500)
				throw new Error("offset 또는 limit을 확인하세요.");
			const content = lines
				.slice(offset - 1, offset - 1 + limit)
				.map((line, index) => formatHashLine(offset + index, line))
				.join("\n");
			if (content.length > 100_000) throw new Error("출력이 너무 깁니다. 더 작은 limit을 사용하세요.");
			return {
				path: rel,
				digest: fingerprint,
				totalLines: lines.length,
				offset,
				content,
				truncated: offset - 1 + limit < lines.length,
			};
		}
		if (input.digest !== fingerprint)
			throw new Error("파일이 읽은 뒤 변경되었습니다. 다시 읽고 새로운 digest와 줄 참조를 사용하세요.");
		if (!Array.isArray(input.edits) || !input.edits.length || input.edits.length > 100)
			throw new Error("1~100개의 수정이 필요합니다.");
		const anchor = (value: string) => {
			const match = typeof value === "string" ? /^(\d+)#([ZPMQVRWSNKTXJBYH]{2})$/.exec(value) : null;
			if (!match) throw new Error("줄 참조는 read가 반환한 LINE#HASH 형식이어야 합니다.");
			const index = Number(match[1]) - 1;
			if (index < 0 || index >= lines.length || computeLineHash(index + 1, lines[index]) !== match[2])
				throw new Error("줄 내용이 일치하지 않습니다. 파일을 다시 읽으세요.");
			return index;
		};
		const ranges = input.edits
			.map((edit) => {
				if (
					!edit ||
					!Array.isArray(edit.lines) ||
					edit.lines.some((line) => typeof line !== "string" || /[\r\n\0]/.test(line))
				)
					throw new Error("lines에는 줄바꿈 없는 문자열 목록을 입력하세요.");
				const start = anchor(edit.pos),
					end = anchor(edit.end ?? edit.pos);
				if (end < start) throw new Error("줄 범위가 거꾸로 되어 있습니다.");
				return { start, end, lines: edit.lines };
			})
			.sort((a, b) => a.start - b.start);
		for (let index = 1; index < ranges.length; index++)
			if (ranges[index].start <= ranges[index - 1].end) throw new Error("수정 범위가 겹칩니다.");
		const edited = [...lines];
		for (const edit of ranges.reverse()) edited.splice(edit.start, edit.end - edit.start + 1, ...edit.lines);
		const next = restoreFileText(edited.join("\n"), envelope);
		if (Buffer.byteLength(next) > 2_000_000) throw new Error("수정된 파일이 크기 한도를 초과합니다.");
		await access(path, constants.W_OK);
		const temporary = join(dirname(path), `.prime-edit-${randomUUID()}`);
		try {
			await writeFile(temporary, next, { flag: "wx", mode: before.mode & 0o777 });
			signal?.throwIfAborted();
			if ((await realpath(candidate)) !== path || digest(await readFile(path)) !== fingerprint)
				throw new Error("편집 중 파일이 변경되었습니다. 다시 읽으세요.");
			await rename(temporary, path);
		} finally {
			await rm(temporary, { force: true });
		}
		return { path: rel, digest: digest(next), changed: next !== raw, replacedRanges: ranges.length };
	};
	const operation = (locks.get(path) ?? Promise.resolve()).catch(() => {}).then(work);
	locks.set(path, operation);
	try {
		return await operation;
	} finally {
		if (locks.get(path) === operation) locks.delete(path);
	}
}
export const desktopCodeTool = {
	name: "desktop_code",
	label: "코드 읽기·정밀 편집",
	description:
		"Read project text files as LINE#HASH anchors with a SHA-256 digest; edit exact ranges only against that same digest. Stale content, overlapping edits and out-of-project paths are rejected. read: path, optional offset (1-based), limit <=500. edit: path, digest, edits [{pos,end?,lines}]; empty lines deletes a range. Use your normal coding tools for file creation, moves and binary files.",
	promptSnippet: "Read and edit existing code with hash-anchored, stale-file checked changes.",
	executionMode: "sequential" as const,
	parameters: {
		type: "object",
		properties: {
			action: { type: "string", enum: ["read", "edit"] },
			path: { type: "string" },
			offset: { type: "integer" },
			limit: { type: "integer" },
			digest: { type: "string" },
			edits: {
				type: "array",
				items: {
					type: "object",
					properties: {
						pos: { type: "string" },
						end: { type: "string" },
						lines: { type: "array", items: { type: "string" } },
					},
					required: ["pos", "lines"],
					additionalProperties: false,
				},
			},
		},
		required: ["action", "path"],
		additionalProperties: false,
	},
	async execute(_id: string, params: CodeInput, signal?: AbortSignal, _update?: unknown, context?: { cwd?: string }) {
		const result = await codeOperation(context?.cwd ?? process.cwd(), params, signal);
		return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: {} };
	},
};
export default function desktopCode(pi: { registerTool(tool: typeof desktopCodeTool): void }) {
	pi.registerTool(desktopCodeTool);
}
