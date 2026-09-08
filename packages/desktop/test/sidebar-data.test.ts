import { appendFile, mkdir, mkdtemp, realpath, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Redactor } from "../src/main/agent/redaction";
import { AttachmentStore } from "../src/main/attachments/attachment-store";
import { SessionCatalog, sessionDirectory } from "../src/main/sessions/session-catalog";
import { validateRequest } from "../src/shared/ipc-contract";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function root() {
	const path = await realpath(await mkdtemp(join(tmpdir(), "prime-sidebar-")));
	roots.push(path);
	return path;
}
const lines = (...items: unknown[]) => `${items.map((item) => JSON.stringify(item)).join("\n")}\n`;
describe("saved session catalog", () => {
	it("groups actual sessions by cwd, sorts activity, refreshes renamed metadata and supports imported files", async () => {
		const base = await root();
		const directory = join(base, "sessions");
		const a = join(base, "a");
		const b = join(base, "b");
		await Promise.all([mkdir(directory), mkdir(a), mkdir(b)]);
		const first = join(directory, "first.jsonl");
		const second = join(base, "imported.jsonl");
		await writeFile(
			first,
			lines(
				{ type: "session", id: "first", cwd: a },
				{ type: "message", message: { role: "user", content: "첫 번째 요청", timestamp: 1000 } },
			),
		);
		await writeFile(
			second,
			lines(
				{ type: "session", id: "second", cwd: b },
				{
					type: "message",
					message: { role: "user", content: [{ type: "text", text: "다른 프로젝트" }], timestamp: 2000 },
				},
			),
		);
		await writeFile(
			join(directory, "unrelated.jsonl"),
			lines({ type: "session", id: "unrelated", cwd: "/unregistered" }),
		);
		await writeFile(join(directory, "invalid.jsonl"), "not-json\n");
		const projects = [a, b].map((path) => ({ path, name: path, lastOpened: "now" }));
		const catalog = new SessionCatalog(directory, new Redactor({}));
		const result = await catalog.list(projects, [second]);
		expect(result.map((session) => session.id)).toEqual(["second", "first"]);
		expect(result[0].projectPath).toBe(b);
		expect(result[1].title).toBe("첫 번째 요청");
		await appendFile(
			first,
			lines(
				{ type: "message", message: { role: "toolResult", content: "x".repeat(2 * 1024 * 1024) } },
				{ type: "session_info", name: "변경된 제목" },
			),
		);
		const updated = await catalog.list(projects, [second]);
		expect(updated[1].title).toBe("변경된 제목");
		expect(updated[1].modified).toBe(new Date(1000).toISOString());
		expect(await catalog.list([projects[0]])).toHaveLength(1);
		await rm(first);
		expect(await catalog.list(projects)).toHaveLength(0);
	});
	it("uses Prime's configured session location and allows missing directories", async () => {
		expect(sessionDirectory({}, "/fixture")).toBe("/fixture/.prime/agent/sessions");
		expect(sessionDirectory({ PRIME_AGENT_SESSION_DIR: "~/custom" }, "/fixture")).toBe("/fixture/custom");
		expect(sessionDirectory({ PRIME_AGENT_CODING_AGENT_DIR: "/agent" }, "/fixture")).toBe("/agent/sessions");
		expect(await new SessionCatalog(join(await root(), "missing"), new Redactor({})).list([])).toEqual([]);
	});
});
describe("native file attachment boundary", () => {
	it("sends selected images as bytes, references documents by quoted path and revokes removed tokens", async () => {
		const base = await root();
		const image = join(base, "photo.png");
		const document = join(base, 'report "quoted".txt');
		const bytes = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4fcAAAAASUVORK5CYII=",
			"base64",
		);
		await writeFile(image, bytes);
		await writeFile(document, "document content stays local until the agent reads it");
		const store = new AttachmentStore();
		const selected = await store.select([image, document]);
		expect(selected.map((file) => file.kind)).toEqual(["image", "file"]);
		expect(JSON.stringify(selected)).not.toContain(base);
		const prepared = await store.prepare(
			"확인해줘",
			selected.map((file) => file.id),
		);
		expect(prepared.images).toEqual([{ type: "image", mimeType: "image/png", data: bytes.toString("base64") }]);
		expect(prepared.message).toContain(JSON.stringify(document));
		expect(prepared.message).not.toContain("document content");
		store.remove(selected[0].id);
		await expect(store.prepare("test", [selected[0].id])).rejects.toThrow(/다시 선택/);
		await expect(store.prepare("test", [image])).rejects.toThrow(/다시 선택/);
	});
	it("refuses oversized or invalid images without consuming a retryable selection", async () => {
		const base = await root();
		const image = join(base, "photo.png");
		await writeFile(image, "not an image");
		const store = new AttachmentStore();
		const [file] = await store.select([image]);
		await expect(store.prepare("", [file.id])).rejects.toThrow(/형식/);
		await truncate(image, 9 * 1024 * 1024);
		await expect(store.prepare("", [file.id])).rejects.toThrow(/8MB/);
		await expect(store.select([image])).rejects.toThrow(/8MB/);
		await expect(store.select(Array(11).fill(image))).rejects.toThrow(/10개/);
	});
	it("validates attachment-only messages and rejects forged path payloads and oversized lists", () => {
		expect(() => validateRequest("agent.prompt", { message: "", attachmentIds: ["token-123"] })).not.toThrow();
		for (const attachmentIds of [["/etc/passwd"], ["x", "x"], Array(11).fill("x"), "x", [null]])
			expect(() => validateRequest("agent.prompt", { message: "x", attachmentIds })).toThrow();
		expect(() => validateRequest("agent.prompt", { message: "", attachmentIds: [] })).toThrow();
		expect(() => validateRequest("attachment.select", { path: "/file" })).toThrow();
	});
});
