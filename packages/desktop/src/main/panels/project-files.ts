import { execFile } from "node:child_process";
import { open, readdir, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { FileEntry, FilePreview, GitChange, GitReview } from "../../shared/panel-contract";

const exec = promisify(execFile);
export async function projectFile(root: string, path: string): Promise<string> {
	if (isAbsolute(path) || path.includes("\0")) throw new Error("프로젝트 내부 경로를 선택하세요.");
	const base = await realpath(root);
	const candidate = await realpath(resolve(base, path));
	if (candidate !== base && !candidate.startsWith(`${base}${sep}`))
		throw new Error("프로젝트 바깥의 파일은 열 수 없습니다.");
	return candidate;
}
export async function listFiles(root: string, path: string): Promise<{ entries: FileEntry[]; truncated: boolean }> {
	const target = await projectFile(root, path);
	const all = (await readdir(target, { withFileTypes: true }))
		.filter((entry) => entry.name !== ".git")
		.sort(
			(a, b) =>
				Number(b.isDirectory()) - Number(a.isDirectory()) ||
				a.name.localeCompare(b.name, undefined, { numeric: true }),
		);
	return {
		entries: all.slice(0, 500).map((entry) => ({
			name: entry.name,
			path: relative(root, resolve(target, entry.name)),
			directory: entry.isDirectory(),
			symlink: entry.isSymbolicLink(),
		})),
		truncated: all.length > 500,
	};
}
export async function readProjectFile(root: string, path: string): Promise<FilePreview> {
	const handle = await open(await projectFile(root, path), "r");
	try {
		const info = await handle.stat();
		if (!info.isFile()) throw new Error("일반 파일을 선택하세요.");
		const mime: Record<string, string> = {
			".png": "image/png",
			".jpg": "image/jpeg",
			".jpeg": "image/jpeg",
			".gif": "image/gif",
			".webp": "image/webp",
		};
		const imageType = mime[extname(path).toLowerCase()];
		const limit = imageType ? 8 * 1024 * 1024 : 1024 * 1024;
		const buffer = Buffer.alloc(Math.min(info.size, limit));
		let length = 0;
		while (length < buffer.length) {
			const result = await handle.read(buffer, length, buffer.length - length, length);
			if (!result.bytesRead) break;
			length += result.bytesRead;
		}
		const data = buffer.subarray(0, length);
		const binary = !imageType && data.includes(0);
		return {
			path,
			kind: imageType && info.size <= limit ? "image" : binary || imageType ? "binary" : "text",
			content:
				imageType && info.size <= limit
					? `data:${imageType};base64,${data.toString("base64")}`
					: binary || imageType
						? ""
						: data.toString("utf8"),
			size: info.size,
			truncated: info.size > limit,
		};
	} finally {
		await handle.close();
	}
}
async function git(root: string, args: string[]): Promise<string> {
	const { stdout } = await exec(
		"/usr/bin/git",
		["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.quotePath=false", "-C", root, ...args],
		{
			encoding: "utf8",
			maxBuffer: 4 * 1024 * 1024,
			timeout: 15_000,
			env: { ...process.env, GIT_PAGER: "cat", GIT_TERMINAL_PROMPT: "0" },
		},
	);
	return stdout;
}
export async function reviewProject(root: string): Promise<GitReview> {
	const repositoryRoot = (await git(root, ["rev-parse", "--show-toplevel"]).catch(() => "")).trim();
	if (!repositoryRoot) return { branch: "", changes: [], isRepository: false };
	const [branch, status] = await Promise.all([
		git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "새 저장소"),
		git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]),
	]);
	const chunks = status.split("\0");
	const changes: GitChange[] = [];
	for (let i = 0; i < chunks.length; i++) {
		const entry = chunks[i];
		if (!entry) continue;
		const code = entry.slice(0, 2);
		const path = relative(root, resolve(repositoryRoot, entry.slice(3)));
		const originalPath = /[RC]/.test(code) ? relative(root, resolve(repositoryRoot, chunks[++i])) : undefined;
		changes.push({ path, status: code, ...(originalPath ? { originalPath } : {}) });
	}
	return { branch: branch.trim(), changes, isRepository: true };
}
export async function projectDiff(root: string, path: string, staged: boolean): Promise<string> {
	const review = await reviewProject(root);
	const entry = review.changes.find((change) => change.path === path);
	if (!entry) throw new Error("변경된 파일을 다시 선택하세요.");
	if (entry.status === "??") {
		if (staged) return "아직 스테이징하지 않은 파일입니다.";
		const file = await readProjectFile(root, path);
		return file.kind === "text"
			? `새 파일: ${path}\n${file.content
					.split("\n")
					.map((line) => `+${line}`)
					.join("\n")}${file.truncated ? "\n… 미리보기 제한" : ""}`
			: "바이너리 파일이 추가되었습니다.";
	}
	return (
		(await git(root, [
			"diff",
			"--no-ext-diff",
			"--no-textconv",
			"--no-color",
			...(staged ? ["--cached"] : []),
			"--",
			path,
			...(entry.originalPath ? [entry.originalPath] : []),
		])) || "이 범위에 표시할 변경이 없습니다."
	);
}
