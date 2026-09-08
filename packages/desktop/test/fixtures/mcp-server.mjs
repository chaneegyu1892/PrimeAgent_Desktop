import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	GetPromptRequestSchema,
	ListPromptsRequestSchema,
	ListResourcesRequestSchema,
	ListToolsRequestSchema,
	ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

if (process.env.MCP_NOISY) await new Promise((resolve) => process.stderr.write("diagnostic".repeat(40_000), resolve));
const server = new Server(
	{ name: "offline-fixture", version: "1.0.0" },
	{ capabilities: { tools: {}, resources: {}, prompts: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
	tools: [
		{
			name: "echo",
			description: "Offline fixture echo",
			inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
		},
		{ name: "fail", description: "Returns an explicit failure", inputSchema: { type: "object" } },
	],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => ({
	content: [
		{
			type: "text",
			text:
				request.params.name === "fail"
					? "fixture failure"
					: JSON.stringify({
							text: request.params.arguments?.text,
							allowed: process.env.TEST_KEY,
							unexpected: process.env.UNRELATED_SECRET,
						}),
		},
	],
	isError: request.params.name === "fail",
}));
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
	resources: [{ uri: "fixture://readme", name: "readme" }],
}));
server.setRequestHandler(ReadResourceRequestSchema, async () => ({
	contents: [{ uri: "fixture://readme", text: "Resource content" }],
}));
server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [{ name: "example" }] }));
server.setRequestHandler(GetPromptRequestSchema, async () => ({
	messages: [{ role: "user", content: { type: "text", text: "Prompt content" } }],
}));
await server.connect(new StdioServerTransport());
