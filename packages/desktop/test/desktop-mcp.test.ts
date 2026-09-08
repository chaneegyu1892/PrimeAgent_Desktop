import { afterEach, describe, expect, it, vi } from "vitest";
import { desktopMcpTool } from "../src/extension/desktop-mcp";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});
const setup = (value: unknown) => {
	vi.stubEnv("PRIME_DESKTOP_MCP_URL", "http://127.0.0.1:12345/mcp");
	vi.stubEnv("PRIME_DESKTOP_MCP_TOKEN", "opaque-test-token");
	const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(value)));
	vi.stubGlobal("fetch", request);
	return request;
};
describe("agent MCP bridge extension", () => {
	it("sends only through its local authenticated bridge and preserves screenshot image blocks", async () => {
		const fetch = setup({
			ok: true,
			value: {
				content: [
					{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
					{ type: "text", text: "screenshot" },
				],
			},
		});
		const result = await desktopMcpTool.execute("id", { action: "call", server: "aside", tool: "repl" });
		expect(result.content).toContainEqual({ type: "image", data: "aW1hZ2U=", mimeType: "image/png" });
		expect(result.content[0]).toMatchObject({ type: "text", text: expect.not.stringContaining("aW1hZ2U=") });
		expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer opaque-test-token");
	});
	it("reports bridge failures and explicit MCP tool errors instead of inventing success", async () => {
		setup({ ok: false, error: "connection failed" });
		await expect(desktopMcpTool.execute("id", { action: "servers" })).rejects.toThrow("connection failed");
		setup({ ok: true, value: { content: [{ type: "text", text: "denied" }], isError: true } });
		expect(
			(await desktopMcpTool.execute("id", { action: "call", server: "fixture", tool: "fail" })).details.isError,
		).toBe(true);
	});
	it("refuses an external bridge URL", async () => {
		const fetch = setup({ ok: true });
		vi.stubEnv("PRIME_DESKTOP_MCP_URL", "https://outside.example/mcp");
		await expect(desktopMcpTool.execute("id", { action: "servers" })).rejects.toThrow("연결이 없습니다");
		expect(fetch).not.toHaveBeenCalled();
	});
});
