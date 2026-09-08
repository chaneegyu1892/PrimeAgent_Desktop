import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerConfig, McpToolView } from "../../shared/capability-contract";

export class McpHub {
	private clients = new Map<string, Promise<Client>>();
	private states = new Map<string, { toolCount?: number; error?: string }>();
	constructor(
		private configs: () => McpServerConfig[],
		private token: (id: string) => string | undefined,
		private env: NodeJS.ProcessEnv = process.env,
		private oauth?: (config: McpServerConfig) => OAuthClientProvider,
	) {}
	status(id: string) {
		return this.states.get(id);
	}
	private get(id: string): Promise<Client> {
		const config = this.configs().find((s) => s.id === id && s.enabled);
		if (!config) throw new Error("활성화된 MCP 연결을 선택하세요.");
		let client = this.clients.get(id);
		if (!client) {
			client = this.connect(config);
			this.clients.set(id, client);
			const captured = client;
			void client
				.then((connected) => {
					connected.onclose = () => {
						if (this.clients.get(id) === captured) {
							this.clients.delete(id);
							this.states.delete(id);
						}
					};
				})
				.catch(() => {});
			void client.catch(() => {
				if (this.clients.get(id) === captured) this.clients.delete(id);
			});
		}
		return client;
	}
	private async connect(config: McpServerConfig): Promise<Client> {
		const client = new Client({ name: "prime-desktop", version: "0.9.3" });
		try {
			if (config.transport === "http") {
				const token = this.token(config.id) || (config.tokenEnv ? this.env[config.tokenEnv] : undefined);
				if (config.tokenEnv && !token) throw new Error("토큰 환경변수가 설정되지 않았습니다.");
				const transport = new StreamableHTTPClientTransport(new URL(config.url!), {
					authProvider: config.oauth ? this.oauth?.(config) : undefined,
					requestInit: { redirect: "error", ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) },
					reconnectionOptions: {
						initialReconnectionDelay: 1000,
						maxReconnectionDelay: 1000,
						reconnectionDelayGrowFactor: 1,
						maxRetries: 0,
					},
				});
				await client.connect(transport, { timeout: 20_000 });
			} else {
				const env: Record<string, string> = {};
				for (const key of ["PATH", "HOME", "LANG", "TMPDIR", "USER", "SHELL"])
					if (this.env[key]) env[key] = this.env[key]!;
				for (const [key, reference] of Object.entries(config.env ?? {})) {
					if (!this.env[reference]) throw new Error(`환경변수 ${reference}가 설정되지 않았습니다.`);
					env[key] = this.env[reference]!;
				}
				const transport = new StdioClientTransport({
					command: config.command!,
					args: config.args,
					env,
					stderr: "pipe",
					maxBufferSize: 16 * 1024 * 1024,
				});
				// Never mix server stderr (which can contain credentials) into the agent's JSONL stream.
				transport.stderr?.on("data", () => {});
				await client.connect(transport, { timeout: 20_000 });
			}
			this.states.set(config.id, {});
			return client;
		} catch {
			await client.close().catch(() => {});
			this.states.set(config.id, {
				error: "연결하지 못했습니다. 서버 주소, 실행 파일, 인증과 환경변수를 확인하세요.",
			});
			throw new Error(this.states.get(config.id)!.error);
		}
	}
	async tools(id: string, signal?: AbortSignal): Promise<McpToolView[]> {
		const client = await this.get(id);
		const tools: McpToolView[] = [];
		let cursor: string | undefined;
		const seen = new Set<string>();
		do {
			const page = await client.listTools({ cursor }, { timeout: 20_000, signal });
			tools.push(
				...page.tools.map((t) => ({ name: t.name, description: t.description ?? "", inputSchema: t.inputSchema })),
			);
			if (tools.length > 2000 || (page.nextCursor && seen.has(page.nextCursor)))
				throw new Error("MCP 도구 목록 한도를 초과했습니다.");
			cursor = page.nextCursor;
			if (cursor) seen.add(cursor);
		} while (cursor);
		this.states.set(id, { toolCount: tools.length });
		return tools;
	}
	async request(id: string, action: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
		if (action === "tools") return this.tools(id, signal);
		const client = await this.get(id);
		const options = { timeout: 120_000, signal };
		switch (action) {
			case "call": {
				if (typeof args.tool !== "string") throw new Error("도구 이름이 필요합니다.");
				// Discover schemas first and reject guessed tool names; server validates its call contract.
				const available = await this.tools(id, signal);
				if (!available.some((t) => t.name === args.tool)) throw new Error("서버가 제공하지 않는 도구입니다.");
				return client.callTool(
					{ name: args.tool, arguments: args.arguments as Record<string, unknown> | undefined },
					undefined,
					options,
				);
			}
			case "resources":
				return client.listResources({ cursor: typeof args.cursor === "string" ? args.cursor : undefined }, options);
			case "read_resource":
				if (typeof args.uri !== "string") throw new Error("리소스 URI가 필요합니다.");
				return client.readResource({ uri: args.uri }, options);
			case "prompts":
				return client.listPrompts({ cursor: typeof args.cursor === "string" ? args.cursor : undefined }, options);
			case "get_prompt": {
				if (typeof args.prompt !== "string") throw new Error("프롬프트 이름이 필요합니다.");
				const values = args.arguments as Record<string, unknown> | undefined;
				if (values && Object.values(values).some((value) => typeof value !== "string"))
					throw new Error("프롬프트 인자는 문자열이어야 합니다.");
				return client.getPrompt(
					{ name: args.prompt, arguments: values as Record<string, string> | undefined },
					options,
				);
			}
			default:
				throw new Error("지원하지 않는 MCP 동작입니다.");
		}
	}
	async close(id: string): Promise<void> {
		const pending = this.clients.get(id);
		this.clients.delete(id);
		this.states.delete(id);
		if (pending) await pending.then((client) => client.close()).catch(() => {});
	}
	async shutdown() {
		await Promise.all([...this.clients.keys()].map((id) => this.close(id)));
	}
}
