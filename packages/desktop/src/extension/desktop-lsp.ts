import { spawn } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { JsonRpcConnection } from "../../vendor/omo/lsp/json-rpc-connection";

interface LspInput {
	action: "diagnostics" | "definition" | "references" | "symbols" | "rename_preview";
	path: string;
	line?: number;
	column?: number;
	newName?: string;
}
export async function lspOperation(
	root: string,
	input: LspInput,
	serverPath: string,
	runtimePath: string,
	signal?: AbortSignal,
) {
	const methods = {
		diagnostics: "textDocument/diagnostic",
		definition: "textDocument/definition",
		references: "textDocument/references",
		symbols: "textDocument/documentSymbol",
		rename_preview: "textDocument/rename",
	};
	if (!input || !Object.hasOwn(methods, input.action) || typeof input.path !== "string")
		throw new Error("LSP 요청 형식을 확인하세요.");
	const base = await realpath(root),
		path = await realpath(resolve(base, input.path)),
		rel = relative(base, path);
	if (
		!rel ||
		rel.startsWith("..") ||
		isAbsolute(rel) ||
		!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(path) ||
		(await stat(path)).size > 2_000_000
	)
		throw new Error("프로젝트 안의 2 MB 이하 TypeScript·JavaScript 파일을 선택하세요.");
	const uri = pathToFileURL(path).href;
	const env = { ...process.env };
	delete env.NODE_OPTIONS;
	delete env.ELECTRON_RUN_AS_NODE;
	const child = spawn(process.execPath, [serverPath, "--stdio"], {
		cwd: base,
		env,
		stdio: ["pipe", "pipe", "pipe"],
		shell: false,
	});
	child.stderr.resume();
	const connection = new JsonRpcConnection(child.stdout, child.stdin);
	const controller = new AbortController();
	const deadline = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
	child.on("error", (error) => controller.abort(error));
	connection.onError((error) => controller.abort(error));
	connection.onClose(() => controller.abort(new Error("LSP 서버가 종료되었습니다.")));
	connection.onRequest("workspace/configuration", (params) => {
		const items = (params as { items?: unknown[] })?.items;
		return Array.isArray(items) ? items.map(() => ({})) : [];
	});
	connection.onRequest("workspace/applyEdit", () => ({
		applied: false,
		failureReason: "Desktop LSP is preview-only. Apply reviewed changes through desktop_code.",
	}));
	connection.onRequest("client/registerCapability", () => null);
	let published: unknown[] | undefined;
	connection.onNotification("textDocument/publishDiagnostics", (params) => {
		const data = params as { uri?: string; diagnostics?: unknown[] };
		if (data.uri === uri && Array.isArray(data.diagnostics)) published = data.diagnostics;
	});
	connection.listen();
	try {
		const initialized = await connection.sendRequest<{ capabilities: { diagnosticProvider?: unknown } }>(
			"initialize",
			{
				processId: process.pid,
				rootUri: pathToFileURL(base).href,
				capabilities: {
					workspace: { configuration: true },
					textDocument: { publishDiagnostics: { versionSupport: true } },
				},
				initializationOptions: {
					tsserver: { path: runtimePath },
					preferences: { includeInlayParameterNameHints: "none" },
				},
				workspaceFolders: [{ uri: pathToFileURL(base).href, name: "project" }],
			},
			{ signal: deadline },
		);
		await connection.sendNotification("initialized", {});
		await connection.sendNotification("textDocument/didOpen", {
			textDocument: {
				uri,
				languageId: /\.tsx$/.test(path)
					? "typescriptreact"
					: /\.jsx$/.test(path)
						? "javascriptreact"
						: /\.[cm]?ts$/.test(path)
							? "typescript"
							: "javascript",
				version: 1,
				text: await readFile(path, "utf8"),
			},
		});
		let value: unknown;
		if (input.action === "diagnostics" && !initialized.capabilities.diagnosticProvider) {
			await connection.sendRequest("textDocument/documentSymbol", { textDocument: { uri } }, { signal: deadline });
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(done, 2500);
				const abort = () => {
					clearTimeout(timer);
					reject(deadline.reason);
				};
				function done() {
					deadline.removeEventListener("abort", abort);
					resolve();
				}
				if (deadline.aborted) abort();
				else deadline.addEventListener("abort", abort, { once: true });
			});
			value = {
				diagnostics: published ?? [],
				received: published !== undefined,
				complete: false,
				note: "Push diagnostics observed for 2.5s; empty results are not proof of a clean project. Run the project's typecheck for a complete verdict.",
			};
		} else {
			const position = { line: (input.line ?? 1) - 1, character: (input.column ?? 1) - 1 };
			if (
				!Number.isInteger(position.line) ||
				!Number.isInteger(position.character) ||
				position.line < 0 ||
				position.character < 0
			)
				throw new Error("위치는 1부터 시작하는 정수여야 합니다.");
			if (
				input.action === "rename_preview" &&
				(typeof input.newName !== "string" || !input.newName.trim() || input.newName.length > 200)
			)
				throw new Error("새 이름을 입력하세요.");
			value = await connection.sendRequest(
				methods[input.action],
				{
					textDocument: { uri },
					position,
					...(input.action === "references" ? { context: { includeDeclaration: true } } : {}),
					...(input.action === "rename_preview" ? { newName: input.newName } : {}),
				},
				{ signal: deadline },
			);
		}
		const text = JSON.stringify({ path: rel, action: input.action, previewOnly: true, result: value });
		if (text.length > 200_000) throw new Error("LSP 결과가 너무 큽니다. 더 좁은 대상에서 조회하세요.");
		return text;
	} finally {
		await connection.sendRequest("shutdown", undefined, { signal: AbortSignal.timeout(1000) }).catch(() => {});
		await connection.sendNotification("exit").catch(() => {});
		child.stdin.end();
		if (child.exitCode === null && child.signalCode === null)
			await new Promise<void>((resolve) => {
				const timer = setTimeout(() => child.kill("SIGTERM"), 1500);
				const kill = setTimeout(() => child.kill("SIGKILL"), 3000);
				child.once("close", () => {
					clearTimeout(timer);
					clearTimeout(kill);
					resolve();
				});
			});
		connection.dispose();
	}
}
export const desktopLspTool = {
	name: "desktop_lsp",
	label: "코드 정의·참조·진단",
	description:
		"Built-in TypeScript/JavaScript language intelligence: diagnostics, definition, references, document symbols, and rename_preview. Position line/column is 1-based UTF-16. Rename returns proposed WorkspaceEdit only; it never writes files. Diagnostics may be a partial push snapshot; run project checks for a final verdict. Each request owns and closes its language server.",
	executionMode: "sequential" as const,
	parameters: {
		type: "object",
		properties: {
			action: { type: "string", enum: ["diagnostics", "definition", "references", "symbols", "rename_preview"] },
			path: { type: "string" },
			line: { type: "integer" },
			column: { type: "integer" },
			newName: { type: "string" },
		},
		required: ["action", "path"],
		additionalProperties: false,
	},
	async execute(_id: string, params: LspInput, signal?: AbortSignal, _update?: unknown, context?: { cwd?: string }) {
		const server = process.env.PRIME_DESKTOP_LSP_SERVER,
			runtime = process.env.PRIME_DESKTOP_LSP_RUNTIME;
		if (!server || !runtime) throw new Error("내장 LSP 경로가 없습니다. 앱 연결을 확인하세요.");
		return {
			content: [
				{
					type: "text" as const,
					text: await lspOperation(context?.cwd ?? process.cwd(), params, server, runtime, signal),
				},
			],
			details: {},
		};
	},
};
export default function desktopLsp(pi: { registerTool(tool: typeof desktopLspTool): void }) {
	pi.registerTool(desktopLspTool);
}
