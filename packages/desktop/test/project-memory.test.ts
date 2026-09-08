import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { Redactor } from "../src/main/agent/redaction";
import { ProjectMemory } from "../src/main/harness/project-memory";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
it("isolates project memories, serializes updates, searches and forgets across restart", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "prime-memory-")));
	roots.push(root);
	await mkdir(join(root, "other"));
	const store = new ProjectMemory(join(root, "state"), new Redactor({ TEST_TOKEN: "fixture_secret_123456789" }));
	await Promise.all([
		store.save(root, { key: "Style", content: "Use Korean UI", source: "user decision" }),
		store.save(root, { key: "Build", content: "Use npm run check", source: "package.json" }),
	]);
	expect(await store.list(root, "Korean")).toHaveLength(1);
	expect(await store.list(join(root, "other"))).toEqual([]);
	await expect(
		store.save(root, { key: "Secret", content: "fixture_secret_123456789", source: "bad" }),
	).rejects.toThrow("비밀");
	await store.forget(root, "Style");
	expect((await new ProjectMemory(join(root, "state")).list(root)).map((entry) => entry.key)).toEqual(["Build"]);
	const file = join(root, "state", (await readdir(join(root, "state")))[0]);
	await writeFile(file, "bad json");
	await expect(store.save(root, { key: "X", content: "Y", source: "Z" })).rejects.toThrow("보존");
	expect(await readFile(file, "utf8")).toBe("bad json");
});
