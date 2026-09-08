import { constants } from "node:fs";
import { access, open, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import type { LaunchSpec } from "./agent-transport";

async function executable(path: string): Promise<boolean> {
	try {
		await access(path, constants.X_OK);
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}
export async function discoverCli(env: NodeJS.ProcessEnv = process.env, home = homedir()): Promise<string | null> {
	const dirs = (env.PATH ?? "").split(delimiter).filter(isAbsolute);
	dirs.push(join(home, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin");
	try {
		const versions = await readdir(join(home, ".nvm/versions/node"));
		versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
		dirs.push(...versions.map((version) => join(home, ".nvm/versions/node", version, "bin")));
	} catch {
		/* nvm is optional. */
	}
	for (const dir of new Set(dirs)) {
		const candidate = join(dir, "prime-agent");
		if (await executable(candidate)) return candidate;
	}
	return null;
}
export async function resolveCli(path: string, env: NodeJS.ProcessEnv = process.env): Promise<LaunchSpec> {
	if (!isAbsolute(path) || path.includes("\0") || !(await executable(path)))
		throw new Error("실행 가능한 Prime Agent CLI 파일을 선택하세요.");
	const resolved = await realpath(path);
	const file = await open(resolved, "r");
	let head: string;
	try {
		const buffer = Buffer.alloc(256);
		const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
		head = buffer.subarray(0, bytesRead).toString("utf8");
	} finally {
		await file.close();
	}
	const dirs = [
		dirname(path),
		...(env.PATH ?? "").split(delimiter).filter(isAbsolute),
		"/opt/homebrew/bin",
		"/usr/local/bin",
		"/usr/bin",
		"/bin",
	];
	const childEnv: NodeJS.ProcessEnv = { ...env, PATH: [...new Set(dirs)].join(delimiter) };
	delete childEnv.ELECTRON_RUN_AS_NODE;
	delete childEnv.NODE_OPTIONS;
	if (/^#![^\n]*\bnode\b/.test(head)) {
		for (const dir of new Set(dirs)) {
			const node = join(dir, "node");
			if (await executable(node)) return { executable: node, args: [resolved], env: childEnv };
		}
		throw new Error(
			"이 Prime Agent CLI에 필요한 외부 Node.js를 찾지 못했습니다. Node가 설치된 경로의 CLI를 선택하세요.",
		);
	}
	return { executable: path, args: [], env: childEnv };
}
