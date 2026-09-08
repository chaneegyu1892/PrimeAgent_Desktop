import { randomBytes } from "node:crypto";
import { access } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { dialog, shell } from "electron";
import { CONNECTION_TEMPLATES } from "../../shared/capability-catalog";
import type { CapabilityRequestName } from "../../shared/capability-contract";
import { record } from "../../shared/ipc-contract";
import type { CapabilityStore } from "./capability-store";
import { McpHub } from "./mcp-hub";
import { McpOAuth } from "./mcp-oauth";

export class CapabilityService {
	readonly hub: McpHub;
	private appliedRevision = 0;
	markMainApplied() {
		this.appliedRevision = this.store.skillRevision;
	}
	readonly oauth: McpOAuth;
	private bridge?: Server;
	private grants = new Set<string>();
	private url = "";
	private mutations: Promise<unknown> = Promise.resolve();
	constructor(
		readonly store: CapabilityStore,
		env: NodeJS.ProcessEnv = process.env,
	) {
		this.oauth = new McpOAuth(
			(id) => store.oauth(id),
			(id, data) => store.saveOAuth(id, data),
			(url) => shell.openExternal(url),
		);
		this.hub = new McpHub(
			() => store.servers,
			(id) => store.token(id),
			env,
			(config) => this.oauth.provider(config),
		);
	}
	snapshot() {
		const value = this.store.snapshot();
		value.reloadRequired = this.appliedRevision !== this.store.skillRevision;
		value.servers = value.servers.map((server) => {
			const state = this.hub.status(server.id);
			return {
				...server,
				...(state ?? {}),
				status: !server.enabled
					? "disabled"
					: state?.error
						? "error"
						: state?.toolCount !== undefined
							? "connected"
							: "configured",
			};
		});
		return value;
	}
	async detectAside() {
		if (this.store.servers.some((s) => s.id === "aside")) return;
		for (const path of [join(homedir(), ".local/bin/aside"), "/opt/homebrew/bin/aside", "/usr/local/bin/aside"]) {
			if (
				await access(path).then(
					() => true,
					() => false,
				)
			) {
				await this.store.saveMcp({
					id: "aside",
					name: "Aside",
					transport: "stdio",
					command: path,
					args: ["mcp"],
					enabled: true,
				});
				return;
			}
		}
	}
	async handle(name: CapabilityRequestName, input: unknown, window: BrowserWindow): Promise<unknown> {
		const args = record(input);
		if (name === "capability.openDocs") {
			const template = CONNECTION_TEMPLATES.find((t) => t.config.id === args.id);
			if (!template) throw new Error("안내 페이지를 찾지 못했습니다.");
			await shell.openExternal(template.docs);
			return;
		}
		if (name === "capability.list") return this.snapshot();
		if (name === "capability.readPlugin") return this.store.readPlugin(args.id as string);
		if (name === "capability.readSkill") return this.store.readSkill(args.id as string);
		if (name === "capability.loginMcp") {
			const config = this.store.servers.find((s) => s.id === args.id);
			if (!config) throw new Error("연결을 찾지 못했습니다.");
			await this.oauth.login(config).catch(() => {
				throw new Error(
					"OAuth 로그인을 완료하지 못했습니다. 취소 여부, 서비스 접근 권한과 클라이언트 등록 조건을 확인하세요.",
				);
			});
			await this.hub.close(config.id);
			return this.snapshot();
		}
		if (name === "capability.logoutMcp") {
			await this.oauth.logout(args.id as string);
			await this.hub.close(args.id as string);
			return this.snapshot();
		}
		if (name === "capability.testMcp") return this.hub.tools(args.id as string);
		const operation = this.mutations
			.catch(() => {})
			.then(async () => {
				switch (name) {
					case "capability.toggle":
						await this.store.toggle(args.kind as "skill" | "plugin", args.id as string, args.enabled as boolean);
						break;
					case "capability.remove":
						await this.store.remove(args.kind as "skill" | "plugin", args.id as string);
						break;
					case "capability.import": {
						const selected = await dialog.showOpenDialog(window, {
							title: args.kind === "skill" ? "SKILL.md가 있는 폴더 선택" : "Prime 패키지 폴더 선택",
							properties: ["openDirectory"],
						});
						if (!selected.canceled && selected.filePaths[0])
							await this.store.importFolder(args.kind as "skill" | "plugin", selected.filePaths[0]);
						break;
					}
					case "capability.saveMcp": {
						const server = args.server as Parameters<CapabilityStore["saveMcp"]>[0];
						this.oauth.cancel(server.id);
						await this.store.saveMcp(server, args.token as string | undefined);
						await this.hub.close(server.id);
						break;
					}
					case "capability.removeMcp":
						this.oauth.cancel(args.id as string);
						await this.store.removeMcp(args.id as string);
						await this.hub.close(args.id as string);
						break;
				}
				return this.snapshot();
			});
		this.mutations = operation;
		return operation;
	}
	async startBridge() {
		const server = createServer((req, res) => {
			const token = req.headers.authorization?.replace(/^Bearer /, "");
			if (req.method !== "POST" || req.url !== "/mcp" || req.headers.origin || !token || !this.grants.has(token)) {
				res.writeHead(403);
				res.end();
				return;
			}
			const abort = new AbortController();
			res.on("close", () => {
				if (!res.writableEnded) abort.abort();
			});
			let raw = "";
			req.setEncoding("utf8");
			req.on("data", (chunk: string) => {
				raw += chunk;
				if (raw.length > 1_000_000) {
					abort.abort();
					req.destroy();
				}
			});
			req.on("end", () => {
				void (async () => {
					try {
						const args = record(JSON.parse(raw));
						const result =
							args.action === "servers"
								? this.store.servers.filter((s) => s.enabled).map((s) => ({ id: s.id, name: s.name }))
								: await this.hub.request(
										String(args.server ?? ""),
										String(args.action ?? ""),
										args,
										abort.signal,
									);
						const body = JSON.stringify({ ok: true, value: result });
						if (Buffer.byteLength(body) > 16 * 1024 * 1024) throw new Error("MCP 응답 크기 한도를 초과했습니다.");
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(body);
					} catch {
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(
							JSON.stringify({
								ok: false,
								error: "MCP 요청을 완료하지 못했습니다. 연결 설정·인증·인자를 확인하세요. 실행 여부가 불확실하면 재시도 전에 대상 상태를 확인하세요.",
							}),
						);
					}
				})();
			});
		});
		server.requestTimeout = 150_000;
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				server.removeListener("error", reject);
				resolve();
			});
		});
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("MCP 브리지를 시작하지 못했습니다.");
		this.bridge = server;
		this.url = `http://127.0.0.1:${address.port}/mcp`;
	}
	grant(): Record<string, string> {
		const token = randomBytes(32).toString("hex");
		this.grants.add(token);
		return { PRIME_DESKTOP_MCP_URL: this.url, PRIME_DESKTOP_MCP_TOKEN: token };
	}
	async shutdown() {
		this.oauth.shutdown();
		this.grants.clear();
		this.bridge?.closeAllConnections();
		await Promise.all([
			this.hub.shutdown(),
			new Promise<void>((resolve) => {
				if (this.bridge) this.bridge.close(() => resolve());
				else resolve();
			}),
		]);
	}
}
