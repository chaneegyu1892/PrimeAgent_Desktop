import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { McpServerConfig } from "../../shared/capability-contract";

export interface OAuthSaved {
	redirectUrl: string;
	client?: OAuthClientInformationMixed;
	tokens?: OAuthTokens;
}
export class McpOAuth {
	private active = new Map<string, AbortController>();
	private generations = new Map<string, number>();
	constructor(
		private read: (id: string) => OAuthSaved | undefined,
		private save: (id: string, data: OAuthSaved | undefined) => Promise<void>,
		private open: (url: string) => Promise<void>,
	) {}
	provider(config: McpServerConfig): OAuthClientProvider {
		const data = this.read(config.id) ?? { redirectUrl: "http://127.0.0.1/callback" };
		return this.makeProvider(config, data, async () => {
			throw new Error("확장 라이브러리에서 OAuth 로그인을 시작하세요.");
		});
	}
	private makeProvider(
		config: McpServerConfig,
		data: OAuthSaved,
		redirect: (url: URL) => Promise<void>,
		state?: string,
	): OAuthClientProvider {
		let verifier = "";
		const generation = this.generations.get(config.id) ?? 0;
		const save = async () => {
			if (generation !== (this.generations.get(config.id) ?? 0))
				throw new Error("OAuth 연결 설정이 변경되었습니다.");
			await this.save(config.id, data);
		};
		return {
			redirectUrl: data.redirectUrl,
			clientMetadata: {
				client_name: "Prime Desktop",
				redirect_uris: [data.redirectUrl],
				grant_types: ["authorization_code", "refresh_token"],
				response_types: ["code"],
				token_endpoint_auth_method: "none",
			},
			state: () => state ?? randomBytes(32).toString("hex"),
			clientInformation: () => (config.clientId ? { client_id: config.clientId } : data.client),
			saveClientInformation: async (value) => {
				data.client = value;
				await save();
			},
			tokens: () => data.tokens,
			saveTokens: async (value) => {
				data.tokens = value;
				await save();
			},
			redirectToAuthorization: redirect,
			saveCodeVerifier: (value) => {
				verifier = value;
			},
			codeVerifier: () => verifier,
			invalidateCredentials: async (scope) => {
				if (scope === "all" || scope === "tokens") delete data.tokens;
				if (scope === "all" || scope === "client") delete data.client;
				await save();
			},
		};
	}
	async login(config: McpServerConfig): Promise<void> {
		if (config.transport !== "http" || !config.oauth) throw new Error("OAuth를 사용하는 HTTP 연결을 선택하세요.");
		if (this.active.has(config.id)) throw new Error("로그인이 이미 진행 중입니다.");
		const abort = new AbortController();
		this.active.set(config.id, abort);
		const state = randomBytes(32).toString("hex");
		let finish: (code: string) => void = () => {};
		let rejectCode: (reason: Error) => void = () => {};
		const codePromise = new Promise<string>((resolve, reject) => {
			finish = resolve;
			rejectCode = reject;
		});
		void codePromise.catch(() => {});
		const server = createServer((req, res) => {
			const url = new URL(req.url ?? "/", "http://127.0.0.1");
			if (req.method !== "GET" || url.pathname !== "/callback" || url.searchParams.get("state") !== state) {
				res.writeHead(400);
				res.end("Invalid OAuth callback");
				return;
			}
			const code = url.searchParams.get("code");
			res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
			res.end(
				code
					? "Prime Desktop에서 연결을 완료합니다. 이 창을 닫아도 됩니다."
					: "로그인을 취소했습니다. Prime Desktop으로 돌아가세요.",
			);
			if (code) finish(code);
			else rejectCode(new Error("OAuth 로그인이 취소되었습니다."));
		});
		const timer = setTimeout(() => abort.abort(), 180_000);
		abort.signal.addEventListener(
			"abort",
			() => rejectCode(new Error("OAuth 로그인이 취소되었거나 시간이 초과되었습니다.")),
			{ once: true },
		);
		try {
			await new Promise<void>((resolve, reject) => {
				server.once("error", reject);
				server.listen(0, "127.0.0.1", () => resolve());
			});
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("OAuth 콜백을 시작하지 못했습니다.");
			const data: OAuthSaved = { redirectUrl: `http://127.0.0.1:${address.port}/callback` };
			const provider = this.makeProvider(
				config,
				data,
				async (url) => {
					if (url.protocol !== "https:" || url.username || url.password)
						throw new Error("안전한 OAuth 주소가 아닙니다.");
					await this.open(url.href);
				},
				state,
			);
			const boundedFetch: typeof fetch = (url, init) =>
				fetch(url, { ...init, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20_000)]) });
			const result = await auth(provider, { serverUrl: config.url!, fetchFn: boundedFetch });
			if (result === "REDIRECT") {
				const code = await codePromise;
				const done = await auth(provider, {
					serverUrl: config.url!,
					authorizationCode: code,
					fetchFn: boundedFetch,
				});
				if (done !== "AUTHORIZED") throw new Error("OAuth 인증을 완료하지 못했습니다.");
			}
		} finally {
			clearTimeout(timer);
			server.closeAllConnections();
			server.close();
			this.active.delete(config.id);
		}
	}
	cancel(id: string) {
		this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
		this.active.get(id)?.abort();
	}
	async logout(id: string) {
		this.cancel(id);
		await this.save(id, undefined);
	}
	shutdown() {
		for (const controller of this.active.values()) controller.abort();
	}
}
