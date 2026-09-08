import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilityStore } from "../src/main/capabilities/capability-store";
import { McpHub } from "../src/main/capabilities/mcp-hub";
import type { McpServerConfig } from "../src/shared/capability-contract";
import { validateMcpConfig } from "../src/shared/capability-contract";
import { validateRequest } from "../src/shared/ipc-contract";

const roots: string[] = [];
const hubs: McpHub[] = [];
afterEach(async () => {
	await Promise.all(hubs.splice(0).map((h) => h.shutdown()));
	await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
	vi.restoreAllMocks();
});
const codec = {
	encrypt: (text: string) => Buffer.from(text).toString("base64"),
	decrypt: (text: string) => Buffer.from(text, "base64").toString(),
};
async function fixture() {
	const root = await realpath(await mkdtemp(join(tmpdir(), "prime-capability-")));
	roots.push(root);
	const store = new CapabilityStore(join(root, "state"), resolve("builtin/skills"), codec);
	await store.load();
	return { root, store };
}
const config: McpServerConfig = {
	id: "fixture",
	name: "Fixture",
	transport: "stdio",
	command: process.execPath,
	args: [resolve("test/fixtures/mcp-server.mjs")],
	env: { TEST_KEY: "USER_TEST_KEY" },
	enabled: true,
};
describe("capability library", () => {
	it("seeds built-in MCPs once while preserving user edits and intentional removal", async () => {
		const { root, store } = await fixture();
		await store.saveMcp({ ...config, enabled: false });
		await store.seedServers([config]);
		expect(store.servers[0].enabled).toBe(false);
		await store.removeMcp(config.id);
		const restored = new CapabilityStore(join(root, "state"), resolve("builtin/skills"), codec);
		await restored.load();
		await restored.seedServers([config]);
		expect(restored.servers).toEqual([]);
	});
	it("loads all 32 bundled skills, applies toggles and restores them without touching global settings", async () => {
		const { root, store } = await fixture();
		expect(store.snapshot().skills).toHaveLength(32);
		expect((await store.launchArgs()).filter((a) => a === "--skill")).toHaveLength(32);
		await store.toggle("skill", "prime-browser", false);
		const restored = new CapabilityStore(join(root, "state"), resolve("builtin/skills"), codec);
		await restored.load();
		expect(restored.snapshot().skills.find((s) => s.id === "prime-browser")?.enabled).toBe(false);
		expect(await restored.launchArgs()).not.toContain(resolve("builtin/skills/prime-browser"));
		expect(await restored.readSkill("prime-coding")).toContain("repository");
	});
	it("stores credentials separately, never returns them, clears credentials on endpoint changes", async () => {
		const { store } = await fixture();
		const s: McpServerConfig = {
			id: "remote",
			name: "Remote",
			transport: "http",
			url: "https://example.com/mcp",
			enabled: true,
		};
		await store.saveMcp(s, "private-secret");
		expect(store.token(s.id)).toBe("private-secret");
		expect(JSON.stringify(store.snapshot())).not.toContain("private-secret");
		expect(await readFile(join(store.root, "capabilities.json"), "utf8")).not.toContain("private-secret");
		await store.saveOAuth(s.id, {
			redirectUrl: "http://127.0.0.1/callback",
			tokens: { access_token: "oauth-secret", token_type: "Bearer" },
		});
		expect(JSON.stringify(store.snapshot())).not.toContain("oauth-secret");
		await store.saveMcp({ ...s, url: "https://other.example/mcp" });
		expect(store.token(s.id)).toBeUndefined();
		expect(store.oauth(s.id)).toBeUndefined();
	});
	it("imports a self-contained plugin disabled, enables it explicitly and removes it from future launches", async () => {
		const { root, store } = await fixture();
		const source = join(root, "plugin");
		await mkdir(join(source, "skill"), { recursive: true });
		await writeFile(
			join(source, "package.json"),
			JSON.stringify({
				name: "fixture-plugin",
				version: "1.0.0",
				pi: { skills: ["skill"], extensions: ["extension.mjs"] },
			}),
		);
		await writeFile(
			join(source, "skill/SKILL.md"),
			"---\nname: fixture-skill\ndescription: Test skill\n---\nFixture",
		);
		await writeFile(join(source, "extension.mjs"), "export default () => {};");
		await store.importFolder("plugin", source);
		const plugin = store.snapshot().plugins[0];
		expect(plugin.enabled).toBe(false);
		expect(await store.launchArgs()).not.toContain("--extension");
		await store.toggle("plugin", plugin.id, true);
		expect(await store.launchArgs()).toContain("--extension");
		await store.remove("plugin", plugin.id);
		expect(await store.launchArgs()).not.toContain("--extension");
		expect(store.snapshot().skills).toHaveLength(32);
	});
	it("rejects escaping plugin paths, symlinks and malformed configuration, preserving corrupt files", async () => {
		const { root, store } = await fixture();
		const source = join(root, "source");
		await mkdir(source);
		await writeFile(
			join(source, "package.json"),
			JSON.stringify({ name: "bad", pi: { extensions: ["../../escape.mjs"] } }),
		);
		await expect(store.importFolder("plugin", source)).rejects.toThrow();
		await symlink("/tmp", join(source, "link"));
		await expect(store.importFolder("skill", source)).rejects.toThrow("심볼릭");
		await mkdir(store.root, { recursive: true });
		await writeFile(join(store.root, "capabilities.json"), "bad json");
		const broken = new CapabilityStore(store.root, resolve("builtin/skills"), codec);
		await expect(broken.load()).rejects.toThrow("보존");
		await expect(broken.saveMcp(config)).rejects.toThrow("복구");
		expect(await readFile(join(store.root, "capabilities.json"), "utf8")).toBe("bad json");
	});
	it("validates IPC payloads and refuses insecure URLs, shell-shaped extras and literal env secrets", () => {
		expect(() => validateMcpConfig(config)).not.toThrow();
		for (const value of [
			{ ...config, shell: true },
			{ ...config, env: { TOKEN: "literal secret" } },
			{ ...config, id: "../outside" },
			{ id: "remote", name: "Remote", enabled: true, transport: "http", url: "http://example.com/mcp" },
		])
			expect(() => validateMcpConfig(value)).toThrow();
		expect(() => validateRequest("capability.toggle", { kind: "skill", id: "a", enabled: "true" })).toThrow();
		expect(() => validateRequest("capability.saveMcp", { server: config, token: "secret" })).toThrow();
		expect(() => validateRequest("capability.testMcp", { id: "fixture", command: "other" })).toThrow();
	});
	it("performs real stdio discovery, tool/resource/prompt calls, preserves errors and limits the environment", async () => {
		let servers = [config];
		const hub = new McpHub(
			() => servers,
			() => undefined,
			{ PATH: process.env.PATH, USER_TEST_KEY: "allowed", UNRELATED_SECRET: "should-not-pass" },
		);
		hubs.push(hub);
		expect((await hub.tools("fixture")).map((t) => t.name)).toContain("echo");
		const value = (await hub.request("fixture", "call", { tool: "echo", arguments: { text: "한글" } })) as {
			content: { text: string }[];
		};
		expect(JSON.parse(value.content[0].text)).toEqual({ text: "한글", allowed: "allowed" });
		expect(await hub.request("fixture", "call", { tool: "fail" })).toMatchObject({ isError: true });
		expect(await hub.request("fixture", "read_resource", { uri: "fixture://readme" })).toMatchObject({
			contents: [{ text: "Resource content" }],
		});
		expect(await hub.request("fixture", "get_prompt", { prompt: "example" })).toMatchObject({
			messages: [{ role: "user" }],
		});
		await expect(hub.request("fixture", "call", { tool: "invented" })).rejects.toThrow("제공하지 않는");
		servers = [];
		await hub.close("fixture");
		await expect(hub.tools("fixture")).rejects.toThrow("활성화");
	});
	it("drains server diagnostics before handshake so noisy startup cannot deadlock", async () => {
		const hub = new McpHub(
			() => [{ ...config, env: { MCP_NOISY: "FIXTURE_NOISY" } }],
			() => undefined,
			{ PATH: process.env.PATH, FIXTURE_NOISY: "1" },
		);
		hubs.push(hub);
		expect((await hub.tools("fixture")).length).toBe(2);
	});

	it("reports failed initialization without echoing secret or subprocess errors", async () => {
		const hub = new McpHub(
			() => [{ ...config, command: "/nonexistent-private-token" }],
			() => undefined,
		);
		hubs.push(hub);
		await expect(hub.tools("fixture")).rejects.toThrow("연결하지 못했습니다");
		expect(hub.status("fixture")?.error).not.toContain("private-token");
	});
});
