import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserUrl } from "../src/main/panels/aside-browser";
import { listFiles, projectDiff, readProjectFile, reviewProject } from "../src/main/panels/project-files";
import { validateRequest } from "../src/shared/ipc-contract";

const dirs: string[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture() {
	const root = await realpath(await mkdtemp(join(tmpdir(), "prime-panel-")));
	dirs.push(root);
	const project = join(root, "project");
	await mkdir(project);
	return { root, project };
}

describe("project panels", () => {
	it("previews text and rejects traversal, absolute paths and symlinks outside the selected project", async () => {
		const { root, project } = await fixture();
		await writeFile(join(project, "readme.txt"), "한글 텍스트\n<script>not executed</script>");
		await writeFile(join(root, "outside.txt"), "private");
		await symlink(join(root, "outside.txt"), join(project, "escape.txt"));
		await mkdir(join(project, "nested"));
		await mkdir(join(project, ".git"));
		const listing = await listFiles(project, "");
		expect(listing.entries[0].name).toBe("nested");
		expect(listing.entries.some((entry) => entry.name === ".git")).toBe(false);
		expect((await readProjectFile(project, "readme.txt")).content).toContain("한글 텍스트");
		for (const path of ["../outside.txt", join(root, "outside.txt"), "escape.txt"])
			await expect(readProjectFile(project, path)).rejects.toThrow(/프로젝트/);
	});
	it("bounds large previews and distinguishes binary files", async () => {
		const { project } = await fixture();
		await writeFile(join(project, "large.txt"), "a".repeat(1024 * 1024 + 100));
		await writeFile(join(project, "binary.dat"), Buffer.from([0, 1, 2]));
		const preview = await readProjectFile(project, "large.txt");
		expect(preview.content.length).toBe(1024 * 1024);
		expect(preview.truncated).toBe(true);
		expect((await readProjectFile(project, "binary.dat")).kind).toBe("binary");
	});
	it("shows unstaged, staged, untracked and renamed changes relative to a nested project", async () => {
		const { project } = await fixture();
		const git = (...args: string[]) => promisify(execFile)("/usr/bin/git", ["-C", project, ...args]);
		await git("init", "-q");
		const nested = join(project, "nested");
		await mkdir(nested);
		await writeFile(join(nested, "한글 file.txt"), "original\n");
		await writeFile(join(nested, "rename.txt"), "rename content\n");
		await git("add", ".");
		await git(
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.invalid",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"-qm",
			"Fixture",
		);
		await writeFile(join(nested, "한글 file.txt"), "staged\n");
		await git("add", ".");
		await writeFile(join(nested, "한글 file.txt"), "unstaged\n");
		await writeFile(join(nested, "new.txt"), "new content\n");
		await git("mv", "nested/rename.txt", "nested/renamed.txt");
		const review = await reviewProject(nested);
		expect(review.changes).toContainEqual({ path: "한글 file.txt", status: "MM" });
		expect(review.changes).toContainEqual({ path: "renamed.txt", status: "R ", originalPath: "rename.txt" });
		expect(await projectDiff(nested, "한글 file.txt", false)).toContain("+unstaged");
		expect(await projectDiff(nested, "한글 file.txt", true)).toContain("+staged");
		expect(await projectDiff(nested, "renamed.txt", true)).toContain("rename to nested/renamed.txt");
		expect(await projectDiff(nested, "new.txt", false)).toContain("+new content");
		await expect(projectDiff(nested, "../outside", false)).rejects.toThrow(/다시 선택/);
	});
	it("reports non-repositories without inventing a branch", async () => {
		const { project } = await fixture();
		expect(await reviewProject(project)).toEqual({ isRepository: false, branch: "", changes: [] });
	});
	it("validates every panel IPC boundary and rejects invalid terminal sizes and extra fields", () => {
		expect(() => validateRequest("panel.files", { projectPath: "/project", path: "" })).not.toThrow();
		expect(() => validateRequest("panel.terminalWrite", { id: "term", data: "\u0003" })).not.toThrow();
		for (const size of [0, -1, 1.5, 501, Number.NaN])
			expect(() => validateRequest("panel.terminalResize", { id: "term", cols: size, rows: 24 })).toThrow();
		expect(() => validateRequest("panel.file", { projectPath: "/project", path: "ok", extra: true })).toThrow();
		expect(() => validateRequest("panel.chatSend", { projectPath: "/project", message: " " })).toThrow();
		expect(() => validateRequest("panel.execute", { command: "anything" })).toThrow();
	});
	it("only opens HTTP(S) browser URLs without embedded credentials", () => {
		expect(browserUrl("http://localhost:3000/test?q=한글")).toContain("http://localhost:3000/test");
		for (const value of ["file:///etc/passwd", "javascript:alert(1)", "https://user:secret@example.com", "invalid"])
			expect(() => browserUrl(value)).toThrow();
	});
});
