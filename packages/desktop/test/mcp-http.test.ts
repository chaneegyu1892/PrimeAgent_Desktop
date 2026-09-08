import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { McpHub } from "../src/main/capabilities/mcp-hub";

describe("Streamable HTTP MCP", () => {
	it("authenticates and discovers through the real SDK transport, without exposing bearer tokens", async () => {
		const headers: string[] = [];
		const rpc = new Server({ name: "http-fixture", version: "1.0.0" }, { capabilities: { tools: {} } });
		rpc.setRequestHandler(ListToolsRequestSchema, async () => ({
			tools: [{ name: "read", description: "Fixture read", inputSchema: { type: "object" } }],
		}));
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
		await rpc.connect(transport);
		const http = createServer((req, res) => {
			headers.push(req.headers.authorization ?? "");
			if (req.headers.authorization !== "Bearer test-secret") {
				res.writeHead(401);
				res.end();
				return;
			}
			void transport.handleRequest(req, res);
		});
		await new Promise<void>((resolve, reject) => {
			http.once("error", reject);
			http.listen(0, "127.0.0.1", resolve);
		});
		const address = http.address();
		if (!address || typeof address === "string") throw new Error("Missing test port");
		const hub = new McpHub(
			() => [
				{
					id: "http",
					name: "HTTP fixture",
					transport: "http",
					url: `http://127.0.0.1:${address.port}/mcp`,
					enabled: true,
				},
			],
			() => "test-secret",
		);
		try {
			expect(await hub.tools("http")).toMatchObject([{ name: "read" }]);
			expect(headers.length).toBeGreaterThan(1);
			expect(headers.every((h) => h === "Bearer test-secret")).toBe(true);
			expect(JSON.stringify(hub.status("http"))).not.toContain("test-secret");
		} finally {
			await hub.shutdown();
			await rpc.close();
			http.closeAllConnections();
			await new Promise<void>((resolve) => http.close(() => resolve()));
		}
	});
});
