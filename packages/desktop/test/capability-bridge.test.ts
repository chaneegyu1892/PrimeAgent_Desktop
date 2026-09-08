import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ dialog: {}, shell: { openExternal: vi.fn() } }));

import { CapabilityService } from "../src/main/capabilities/capability-service";
import { CapabilityStore } from "../src/main/capabilities/capability-store";

const roots: string[] = [],
	services: CapabilityService[] = [];
afterEach(async () => {
	await Promise.all(services.splice(0).map((s) => s.shutdown()));
	await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
describe("authenticated local capability bridge", () => {
	it("rejects browser origins and unknown tokens, exposes active servers only and dispatches real tools", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-bridge-"));
		roots.push(root);
		const store = new CapabilityStore(root, resolve("builtin/skills"), {
			encrypt: (text) => text,
			decrypt: (text) => text,
		});
		await store.load();
		await store.saveMcp({
			id: "fixture",
			name: "Fixture",
			transport: "stdio",
			command: process.execPath,
			args: [resolve("test/fixtures/mcp-server.mjs")],
			enabled: true,
		});
		const service = new CapabilityService(store);
		services.push(service);
		await service.startBridge();
		const env = service.grant();
		const invoke = (body: unknown, token = env.PRIME_DESKTOP_MCP_TOKEN, origin?: string) =>
			fetch(env.PRIME_DESKTOP_MCP_URL, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}`, ...(origin ? { Origin: origin } : {}) },
				body: JSON.stringify(body),
			});
		expect((await invoke({ action: "servers" }, "wrong")).status).toBe(403);
		expect((await invoke({ action: "servers" }, undefined, "https://example.com")).status).toBe(403);
		expect(await (await invoke({ action: "servers" })).json()).toEqual({
			ok: true,
			value: [{ id: "fixture", name: "Fixture" }],
		});
		const call = await (
			await invoke({ action: "call", server: "fixture", tool: "echo", arguments: { text: "bridge" } })
		).json();
		expect(call.ok).toBe(true);
		expect(call.value.content[0].text).toContain("bridge");
		await store.removeMcp("fixture");
		await service.hub.close("fixture");
		expect(await (await invoke({ action: "servers" })).json()).toEqual({ ok: true, value: [] });
		expect((await (await invoke({ action: "tools", server: "fixture" })).json()).ok).toBe(false);
	});
});
