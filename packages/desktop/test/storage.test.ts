import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverCli, resolveCli } from "../src/main/agent/cli-discovery";
import { ProjectManager } from "../src/main/projects/project-manager";
import { SettingsStore } from "../src/main/settings/settings-store";

const dirs: string[] = [];
async function temp() {
	const dir = await mkdtemp(join(tmpdir(), "prime-desktop-test-"));
	dirs.push(dir);
	return dir;
}
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
describe("projects and settings", () => {
	it("persists recent canonical folders and restores them after restart", async () => {
		const root = await temp();
		const folder = join(root, "project");
		await mkdir(folder);
		const file = join(root, "settings.json");
		const store = new SettingsStore(file);
		await store.load();
		const manager = new ProjectManager(store);
		await manager.open(folder);
		await manager.open(folder);
		const reloaded = new SettingsStore(file);
		await reloaded.load();
		expect(reloaded.value.recent).toHaveLength(1);
		expect(reloaded.value.recent[0].name).toBe("project");
		await new ProjectManager(reloaded).remove(reloaded.value.recent[0].path);
		expect(reloaded.value.recent).toHaveLength(0);
	});
	it("rejects nonexistent folders, files, relative paths and ungranted recents", async () => {
		const root = await temp();
		const store = new SettingsStore(join(root, "settings.json"));
		const manager = new ProjectManager(store);
		const file = join(root, "file");
		await writeFile(file, "test");
		for (const path of [join(root, "missing"), file, "relative"]) await expect(manager.open(path)).rejects.toThrow();
		await expect(manager.open(root, true)).rejects.toThrow(/목록/);
	});
	it("serializes concurrent updates without losing settings", async () => {
		const root = await temp();
		const store = new SettingsStore(join(root, "settings.json"));
		await Promise.all([
			store.update((s) => ({ ...s, cliPath: "/test/prime-agent" })),
			store.update((s) => ({ ...s, recent: [{ name: "x", path: root, lastOpened: "now" }] })),
		]);
		expect(store.value.cliPath).toBe("/test/prime-agent");
		expect(store.value.recent).toHaveLength(1);
	});
	it("does not silently overwrite corrupt settings", async () => {
		const root = await temp();
		const file = join(root, "settings.json");
		await writeFile(file, "invalid-json");
		const store = new SettingsStore(file);
		await expect(store.load()).rejects.toThrow(/보존/);
		await expect(store.update((s) => ({ ...s, cliPath: "/new/path" }))).rejects.toThrow(/덮어쓰지/);
		expect(await readFile(file, "utf8")).toBe("invalid-json");
	});
});
describe("external CLI discovery", () => {
	it("finds an executable and uses external Node adjacent to a symlink", async () => {
		const root = await temp();
		const bin = join(root, "bin");
		await mkdir(bin);
		const script = join(root, "cli.js");
		await writeFile(script, "#!/usr/bin/env node\n");
		await chmod(script, 0o755);
		const cli = join(bin, "prime-agent");
		await symlink(script, cli);
		await symlink(process.execPath, join(bin, "node"));
		expect(await discoverCli({ PATH: bin }, root)).toBe(cli);
		const spec = await resolveCli(cli, { PATH: "/usr/bin", ELECTRON_RUN_AS_NODE: "1", NODE_OPTIONS: "bad" });
		expect(spec.executable).toBe(join(bin, "node"));
		expect(spec.args[0]).toContain("cli.js");
		expect(spec.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
		expect(spec.env.NODE_OPTIONS).toBeUndefined();
	});
	it("rejects directory and nonexecutable selection", async () => {
		const root = await temp();
		const file = join(root, "cli");
		await writeFile(file, "no");
		await expect(resolveCli(root)).rejects.toThrow();
		await expect(resolveCli(file)).rejects.toThrow();
	});
});
