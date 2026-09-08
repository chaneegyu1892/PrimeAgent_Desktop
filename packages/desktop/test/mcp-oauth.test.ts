import { describe, expect, it, vi } from "vitest";
import { McpOAuth, type OAuthSaved } from "../src/main/capabilities/mcp-oauth";
import type { McpServerConfig } from "../src/shared/capability-contract";

const config: McpServerConfig = {
	id: "example",
	name: "Example",
	transport: "http",
	url: "https://example.com/mcp",
	oauth: true,
	enabled: true,
};
describe("MCP OAuth credential lifecycle", () => {
	it("supports encrypted-store callbacks, PKCE verifier and public client metadata", async () => {
		let saved: OAuthSaved | undefined;
		const oauth = new McpOAuth(
			() => saved,
			async (_id, value) => {
				saved = structuredClone(value);
			},
			vi.fn(),
		);
		const provider = oauth.provider(config);
		expect(provider.clientMetadata.token_endpoint_auth_method).toBe("none");
		expect(provider.clientMetadata.grant_types).toContain("refresh_token");
		await provider.saveCodeVerifier("verifier");
		expect(await provider.codeVerifier()).toBe("verifier");
		await provider.saveTokens({ access_token: "access", refresh_token: "refresh", token_type: "Bearer" });
		expect(await oauth.provider(config).tokens()).toMatchObject({ access_token: "access" });
		await provider.invalidateCredentials?.("tokens");
		expect(await oauth.provider(config).tokens()).toBeUndefined();
	});
	it("never reopens a browser from an agent call and rejects refresh writes after logout", async () => {
		const open = vi.fn(),
			save = vi.fn();
		const oauth = new McpOAuth(() => undefined, save, open);
		const provider = oauth.provider(config);
		await expect(provider.redirectToAuthorization(new URL("https://example.com/authorize"))).rejects.toThrow(
			"라이브러리",
		);
		expect(open).not.toHaveBeenCalled();
		await oauth.logout(config.id);
		await expect(provider.saveTokens({ access_token: "late", token_type: "Bearer" })).rejects.toThrow("변경");
		expect(save).toHaveBeenLastCalledWith(config.id, undefined);
	});
	it("rejects OAuth for stdio and supports a pre-registered public client ID", async () => {
		const oauth = new McpOAuth(
			() => undefined,
			async () => {},
			vi.fn(),
		);
		await expect(oauth.login({ ...config, transport: "stdio" })).rejects.toThrow("HTTP");
		expect(await oauth.provider({ ...config, clientId: "registered-client" }).clientInformation()).toEqual({
			client_id: "registered-client",
		});
	});
});
