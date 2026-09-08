import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { Lang, parse } from "@ast-grep/napi";

const languages = [Lang.TypeScript, Lang.Tsx, Lang.JavaScript, Lang.Html, Lang.Css];
export const desktopAstTool = {
	name: "desktop_ast",
	label: "AST 코드 검색",
	description:
		"Search an existing project file by syntax pattern using embedded ast-grep. Languages: TypeScript, Tsx, JavaScript, Html, Css. Use $NAME and $$$ for metavariables. Returns 1-based positions and matched text, up to 100 matches. This tool is read-only; inspect matches then use desktop_code for digest-checked changes.",
	executionMode: "sequential" as const,
	parameters: {
		type: "object",
		properties: {
			path: { type: "string" },
			language: { type: "string", enum: languages },
			pattern: { type: "string" },
		},
		required: ["path", "language", "pattern"],
		additionalProperties: false,
	},
	async execute(
		_id: string,
		params: { path: string; language: Lang; pattern: string },
		signal?: AbortSignal,
		_update?: unknown,
		context?: { cwd?: string },
	) {
		signal?.throwIfAborted();
		if (
			!params ||
			!languages.includes(params.language) ||
			typeof params.pattern !== "string" ||
			!params.pattern.trim() ||
			params.pattern.length > 4000 ||
			typeof params.path !== "string"
		)
			throw new Error("AST 검색 인자를 확인하세요.");
		const base = await realpath(context?.cwd ?? process.cwd()),
			path = await realpath(resolve(base, params.path)),
			rel = relative(base, path);
		if (
			!rel ||
			rel.startsWith("..") ||
			isAbsolute(rel) ||
			!(await stat(path)).isFile() ||
			(await stat(path)).size > 1_000_000
		)
			throw new Error("프로젝트 안의 1 MB 이하 파일을 선택하세요.");
		const text = new TextDecoder("utf8", { fatal: true }).decode(await readFile(path));
		signal?.throwIfAborted();
		const matches = parse(params.language, text).root().findAll(params.pattern);
		let budget = 40_000;
		const results = matches.slice(0, 100).map((node) => {
			const range = node.range(),
				content = node.text().slice(0, Math.min(budget, 4000));
			budget -= content.length;
			return {
				line: range.start.line + 1,
				column: range.start.column + 1,
				endLine: range.end.line + 1,
				content,
				truncated: content.length < node.text().length,
			};
		});
		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify({
						path: rel,
						matches: results,
						totalMatches: matches.length,
						truncated: matches.length > results.length,
					}),
				},
			],
			details: {},
		};
	},
};
export default function desktopAst(pi: { registerTool(tool: typeof desktopAstTool): void }) {
	pi.registerTool(desktopAstTool);
}
