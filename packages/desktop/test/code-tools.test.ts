import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Lang } from "@ast-grep/napi";
import { afterEach, expect, it } from "vitest";
import { desktopAstTool } from "../src/extension/desktop-ast";
import { codeOperation } from "../src/extension/desktop-code";
import { lspOperation } from "../src/extension/desktop-lsp";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(content = "const value = 1;\nconsole.log(value);\n") {
	const root = await realpath(await mkdtemp(join(tmpdir(), "prime-code-")));
	roots.push(root);
	await writeFile(join(root, "index.ts"), content);
	return root;
}
it("edits hash-anchored ranges, preserves BOM/CRLF, and rejects stale or overlapping changes", async () => {
	const root = await fixture("\uFEFFconst value = 1;\r\nconsole.log(value);\r\n");
	const read = await codeOperation(root, { action: "read", path: "index.ts" });
	const anchor = read.content!.split("\n")[0].split("|")[0];
	await expect(
		codeOperation(root, {
			action: "edit",
			path: "index.ts",
			digest: read.digest,
			edits: [
				{ pos: anchor, lines: ["a"] },
				{ pos: anchor, lines: ["b"] },
			],
		}),
	).rejects.toThrow("겹칩니다");
	await codeOperation(root, {
		action: "edit",
		path: "index.ts",
		digest: read.digest,
		edits: [{ pos: anchor, lines: ["const value = 2;"] }],
	});
	const output = await readFile(join(root, "index.ts"), "utf8");
	expect(output).toBe("\uFEFFconst value = 2;\r\nconsole.log(value);\r\n");
	await expect(
		codeOperation(root, {
			action: "edit",
			path: "index.ts",
			digest: read.digest,
			edits: [{ pos: anchor, lines: ["stale"] }],
		}),
	).rejects.toThrow("변경");
});
it("rejects outside paths, symlinks, aborted writes and oversized files", async () => {
	const root = await fixture();
	await symlink(join(root, "index.ts"), join(root, "link.ts"));
	await expect(codeOperation(root, { action: "read", path: "link.ts" })).rejects.toThrow("일반 파일");
	await expect(codeOperation(root, { action: "read", path: "../outside.ts" })).rejects.toThrow();
	await expect(codeOperation(root, { action: "read", path: "index.ts" }, AbortSignal.abort())).rejects.toThrow();
	await writeFile(join(root, "large.ts"), "x".repeat(2_000_001));
	await expect(codeOperation(root, { action: "read", path: "large.ts" })).rejects.toThrow("2 MB");
});
it("uses the real embedded AST parser and reports syntax matches without editing", async () => {
	const root = await fixture("console.log('한국어');\nconsole.error('x');\n");
	const result = await desktopAstTool.execute(
		"fixture",
		{ path: "index.ts", language: Lang.TypeScript, pattern: "console.log($VALUE)" },
		undefined,
		undefined,
		{ cwd: root },
	);
	expect(JSON.parse(result.content[0].text)).toMatchObject({
		totalMatches: 1,
		matches: [{ line: 1, content: "console.log('한국어')" }],
	});
	expect(await readFile(join(root, "index.ts"), "utf8")).toContain("console.error");
});
it("runs the actual bundled LSP server for definitions, rename preview and diagnostics", async () => {
	const root = await fixture("export const value: number = 'wrong';\nconsole.log(value);\n");
	await mkdir(join(root, "src"));
	await writeFile(
		join(root, "tsconfig.json"),
		JSON.stringify({ compilerOptions: { strict: true }, include: ["index.ts"] }),
	);
	const server = resolve("node_modules/typescript-language-server/lib/cli.mjs"),
		runtime = resolve("node_modules/typescript-lsp-runtime/lib/tsserver.js");
	const definition = JSON.parse(
		await lspOperation(root, { action: "definition", path: "index.ts", line: 2, column: 14 }, server, runtime),
	);
	expect(JSON.stringify(definition.result)).toContain("index.ts");
	const rename = JSON.parse(
		await lspOperation(
			root,
			{ action: "rename_preview", path: "index.ts", line: 2, column: 14, newName: "renamed" },
			server,
			runtime,
		),
	);
	expect(JSON.stringify(rename.result)).toContain("renamed");
	expect(await readFile(join(root, "index.ts"), "utf8")).not.toContain("renamed");
	const diagnostics = JSON.parse(
		await lspOperation(root, { action: "diagnostics", path: "index.ts" }, server, runtime),
	);
	expect(JSON.stringify(diagnostics.result)).toContain("2322");
}, 40_000);
