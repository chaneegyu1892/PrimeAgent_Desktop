import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { TransportEvent } from "../src/main/agent/agent-transport";
import { JsonlDecoder } from "../src/main/agent/jsonl";
import { RpcAgentTransport } from "../src/main/agent/rpc-agent-transport";

const fixture = resolve("test/fixtures/fake-cli.mjs");
function transport(mode = "", timeout = 2000) {
	return new RpcAgentTransport(
		{ executable: process.execPath, args: [fixture], env: { PATH: "/usr/bin:/bin", PRIME_TEST_MODE: mode } },
		undefined,
		timeout,
	);
}
describe("strict JSONL", () => {
	it("preserves UTF-8, U+2028/U+2029 and CRLF across every byte boundary", () => {
		const values: unknown[] = [];
		const parser = new JsonlDecoder((value) => values.push(value));
		const expected = { text: "한글 😀\u2028line\u2029last\rvalue" };
		const bytes = Buffer.from(`${JSON.stringify(expected)}\r\n{}\n`);
		for (const byte of bytes) parser.push(Buffer.from([byte]));
		parser.end();
		expect(values).toEqual([expected, {}]);
	});
	it("rejects malformed, oversized, and unterminated records without quoting payload", () => {
		expect(() => new JsonlDecoder(() => {}).push(Buffer.from("SECRET not JSON\n"))).toThrow(/JSONL/);
		expect(() => new JsonlDecoder(() => {}, 3).push(Buffer.from("1234"))).toThrow(/크기/);
		const parser = new JsonlDecoder(() => {});
		parser.push(Buffer.from("{}"));
		expect(() => parser.end()).toThrow(/줄 끝/);
	});
});
describe("RPC subprocess lifecycle", () => {
	it("readies via get_state, streams messages, routes steer/follow-up/abort, and closes", async () => {
		const client = transport();
		const events: TransportEvent[] = [];
		client.subscribe((event) => events.push(event));
		try {
			await client.start(process.cwd());
			await client.request({ type: "prompt", message: "offline test" });
			await client.request({ type: "steer", message: "steer" });
			await client.request({ type: "follow_up", message: "later" });
			await client.request({ type: "abort" });
			const messages = await client.request({ type: "get_messages" });
			expect(JSON.stringify(messages)).toContain("한글 테스트 😀");
			expect(events.some((e) => e.kind === "event" && e.value.type === "tool_execution_update")).toBe(true);
			expect(events.filter((e) => e.kind === "event" && e.value.type === "session_action_update")).toHaveLength(2);
			expect(client.ownership).toBe("owned-child");
		} finally {
			await client.close();
		}
		await expect(client.request({ type: "get_state" })).rejects.toThrow(/연결/);
	});
	it("surfaces rejected commands instead of acknowledging success", async () => {
		const client = transport("reject");
		try {
			await client.start(process.cwd());
			await expect(client.request({ type: "prompt", message: "x" })).rejects.toThrow("fixture rejected");
		} finally {
			await client.close();
		}
	});
	it.each(["exit", "invalid", "wrong-command"])("rejects failed startup: %s", async (mode) => {
		const client = transport(mode);
		await expect(client.start(process.cwd())).rejects.toThrow();
		await client.close();
	});
	it("rejects pending commands promptly when child crashes", async () => {
		const client = transport("crash-on-prompt", 5000);
		try {
			await client.start(process.cwd());
			await expect(client.request({ type: "prompt", message: "x" })).rejects.toThrow(/종료/);
		} finally {
			await client.close();
		}
	});
	it("times out uncertain requests without replay", async () => {
		// Allow native process startup under parallel test load; the requested response never arrives.
		const client = transport("timeout", 500);
		try {
			await client.start(process.cwd());
			await expect(client.request({ type: "get_messages" })).rejects.toThrow(/자동 재전송하지/);
		} finally {
			await client.close();
		}
	});
	it("redacts stderr secrets split across chunks", async () => {
		const client = transport("stderr");
		const lines: string[] = [];
		client.subscribe((e) => {
			if (e.kind === "diagnostic") lines.push(e.message);
		});
		try {
			await client.start(process.cwd());
			await new Promise((resolve) => setTimeout(resolve, 25));
			expect(lines.join("\n")).toContain("[REDACTED]");
			expect(lines.join("\n")).not.toContain("FAKE_TEST");
		} finally {
			await client.close();
		}
	});
	it("rejects spawn failure without an unhandled process error", async () => {
		const client = new RpcAgentTransport({ executable: "/missing/prime-fixture", args: [], env: {} });
		await expect(client.start(process.cwd())).rejects.toThrow();
		await client.close();
	});
});
