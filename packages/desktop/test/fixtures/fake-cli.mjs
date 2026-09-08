#!/usr/bin/env node
// Deterministic offline test process. No providers, credentials, files, or shell tools.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const mode = process.env.PRIME_TEST_MODE;
if (process.env.PRIME_TEST_REQUIRE_QUESTION_TOOL) {
	const extension = process.argv[process.argv.indexOf("--extension") + 1];
	if (!extension || !readFileSync(extension, "utf8").includes("desktop_ask_user"))
		throw new Error("Bundled question tool is missing or unreadable from external Node");
}
const markdown = [
	"## 프로젝트 구조",
	"한글 테스트 😀\u2028줄\u2029끝 — **주요 구성**을 정리했습니다.",
	"- `src/main` — 세션과 로컬 작업을 관리합니다.\n- `src/renderer` — 대화 화면을 표시합니다.",
	"| 경로 | 역할 |\n| --- | --- |\n| src/main | 실행과 연결 관리 |\n| src/renderer | 대화와 도구 결과 표시 |",
	"```text\nsrc/\n├── main/\n│   └── index.ts\n└── renderer/\n    └── App.tsx\n```",
	"> 파일을 수정하지 않고 구조만 확인했습니다.",
].join("\n\n");
const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
let messages = [];
let streaming = false;
let session = process.env.PRIME_TEST_SESSION_DIR ? `fake-${process.pid}` : "fake-session";
let name;
let thinking = "high";
let timer;
let activeFile;
const save = () => {
	if (!process.env.PRIME_TEST_SESSION_DIR) return;
	mkdirSync(process.env.PRIME_TEST_SESSION_DIR, { recursive: true });
	activeFile ??= join(process.env.PRIME_TEST_SESSION_DIR, `${session}.jsonl`);
	const entries = [
		{ type: "session", id: session, cwd: process.cwd(), timestamp: new Date().toISOString() },
		...(name ? [{ type: "session_info", name }] : []),
		...messages.map((message) => ({ type: "message", message })),
	];
	writeFileSync(activeFile, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
};
const model = {
	id: "offline",
	provider: "fixture",
	name: "Offline fixture",
	reasoning: true,
	headers: { Authorization: "should-never-reach-renderer" },
};
const state = () => ({
	sessionId: session,
	sessionFile: activeFile,
	sessionName: name,
	model,
	thinkingLevel: thinking,
	isStreaming: streaming,
	isCompacting: false,
	sessionActions: { queuedCount: 0, steering: [], followUps: [] },
});
const finish = () => {
	clearTimeout(timer);
	streaming = false;
	save();
	emit({ type: "agent_end", messages });
};
if (mode === "exit") process.exit(23);
if (mode === "invalid") process.stdout.write("not-json\n");
if (mode === "stderr") {
	process.stderr.write("api_key=sk-FAKE_TEST_");
	setTimeout(() => process.stderr.write("SECRET_123456\n"), 5);
}
const uiPending = new Map();
let uiCounter = 0;
const ask = (method, done, timeout) => {
	const id = `ui-${process.pid}-${++uiCounter}`;
	uiPending.set(id, done);
	emit({
		type: "extension_ui_request",
		id,
		method,
		title: `작업 확인 · ${method}`,
		message: "다음 단계로 진행할까요?",
		options: ["빠른 수정", "원인부터 분석"],
		prefill: "기존 초안",
		placeholder: "답변을 입력하세요",
		...(timeout ? { timeout } : {}),
	});
	if (timeout)
		setTimeout(() => {
			if (uiPending.delete(id)) done({ cancelled: true });
		}, timeout);
};
let startupAsked = false;
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	while (true) {
		const end = buffer.indexOf("\n");
		if (end === -1) break;
		const raw = buffer.slice(0, end);
		buffer = buffer.slice(end + 1);
		if (!raw) continue;
		const cmd = JSON.parse(raw);
		if (cmd.type === "extension_ui_response") {
			if (process.env.PRIME_TEST_UI_LOG)
				appendFileSync(process.env.PRIME_TEST_UI_LOG, `${JSON.stringify({ session, ...cmd })}\n`);
			const done = uiPending.get(cmd.id);
			uiPending.delete(cmd.id);
			done?.(cmd);
			continue;
		}
		if (
			(mode === "blocking-session" && cmd.type === "new_session") ||
			(mode === "startup-dialog" && cmd.type === "get_state" && !startupAsked)
		) {
			startupAsked = true;
			ask("confirm", (response) =>
				emit({
					type: "response",
					command: cmd.type,
					id: cmd.id,
					success: true,
					data: cmd.type === "get_state" ? state() : { cancelled: response.confirmed !== true },
				}),
			);
			continue;
		}
		if (cmd.type === "prompt" && cmd.message.includes("[interaction:")) {
			streaming = true;
			messages.push({ role: "user", content: cmd.message, timestamp: Date.now() });
			save();
			emit({ type: "response", command: cmd.type, id: cmd.id, success: true });
			emit({ type: "agent_start" });
			const kind = cmd.message.match(/\[interaction:(.*?)\]/)?.[1];
			if (kind === "all") {
				const steps = ["select", "confirm", "input", "editor"];
				const next = () => (steps.length ? ask(steps.shift(), next) : finish());
				next();
			} else if (kind === "parallel") {
				ask("input", () => {
					if (!uiPending.size) finish();
				});
				ask("confirm", () => {
					if (!uiPending.size) finish();
				});
			} else ask(["timeout", "crash"].includes(kind) ? "input" : kind, finish, kind === "timeout" ? 250 : undefined);
			emit({
				type: "extension_ui_request",
				id: "notice",
				method: "notify",
				message: "선택을 기다리는 동안에도 작업 내용을 확인할 수 있습니다.",
			});
			emit({ type: "extension_ui_request", id: "draft", method: "set_editor_text", text: "제안된 추가 지시" });
			if (kind === "crash") setTimeout(() => process.exit(24), 150);
			continue;
		}
		if (mode === "timeout" && cmd.type !== "get_state") continue;
		if (mode === "crash-on-prompt" && cmd.type === "prompt") process.exit(24);
		if (mode === "reject-switch" && cmd.type === "switch_session") {
			emit({ type: "response", command: cmd.type, id: cmd.id, success: true, data: { cancelled: true } });
			continue;
		}
		if (mode === "reject" && cmd.type === "prompt") {
			emit({ type: "response", command: cmd.type, id: cmd.id, success: false, error: "fixture rejected prompt" });
			continue;
		}
		let data;
		if (cmd.type === "get_state") data = state();
		else if (cmd.type === "get_messages") data = { messages };
		else if (cmd.type === "get_available_models") data = { models: [model] };
		else if (cmd.type === "new_session") {
			session = `fake-${process.pid}-${Date.now()}`;
			messages = [];
			name = undefined;
			activeFile = undefined;
			save();
			data = { cancelled: false };
		} else if (cmd.type === "switch_session") {
			if (process.env.PRIME_TEST_SESSION_DIR) {
				const entries = readFileSync(cmd.sessionPath, "utf8")
					.trim()
					.split("\n")
					.map((line) => JSON.parse(line));
				session = entries[0].id;
				name = entries.findLast((entry) => entry.type === "session_info")?.name;
				messages = entries.filter((entry) => entry.type === "message").map((entry) => entry.message);
				activeFile = cmd.sessionPath;
			} else session = "resumed-fixture";
			data = { cancelled: false };
		} else if (cmd.type === "set_session_name") {
			name = cmd.name;
			save();
		} else if (cmd.type === "set_thinking_level") thinking = cmd.level;
		emit({
			type: "response",
			command: mode === "wrong-command" ? "wrong" : cmd.type,
			id: cmd.id,
			success: true,
			data,
		});
		if (cmd.type === "prompt") {
			streaming = true;
			const user = {
				role: "user",
				content: cmd.images?.length ? [{ type: "text", text: cmd.message }, ...cmd.images] : cmd.message,
				timestamp: Date.now(),
			};
			messages.push(user);
			emit({ type: "agent_start" });
			emit({ type: "message_start", message: user });
			emit({ type: "message_end", message: user });
			const assistant = {
				role: "assistant",
				content: [
					{ type: "text", text: process.env.PRIME_TEST_MARKDOWN ? markdown : "한글 테스트 😀\u2028줄\u2029끝" },
				],
				timestamp: Date.now() + 1,
			};
			messages.push(assistant);
			emit({ type: "message_start", message: { ...assistant, content: [] } });
			const serialized = Buffer.from(`${JSON.stringify({ type: "message_update", message: assistant })}\n`);
			// Split UTF-8 bytes and Unicode separators across multiple writes.
			for (let i = 0; i < serialized.length; i += 7) process.stdout.write(serialized.subarray(i, i + 7));
			emit({ type: "message_end", message: assistant });
			emit({
				type: "tool_execution_start",
				toolCallId: "fixture-tool",
				toolName: "ipython",
				args: { code: "print('offline fixture')" },
			});
			emit({
				type: "tool_execution_update",
				toolCallId: "fixture-tool",
				toolName: "ipython",
				partialResult: { content: [{ type: "text", text: "fixture progress" }] },
			});
			timer = setTimeout(() => {
				emit({
					type: "tool_execution_end",
					toolCallId: "fixture-tool",
					toolName: "ipython",
					result: { content: [{ type: "text", text: "offline fixture complete" }] },
					isError: false,
				});
				finish();
			}, 4000);
		}
		if (cmd.type === "steer" || cmd.type === "follow_up")
			emit({
				type: "session_action_update",
				actions: {
					queuedCount: 1,
					steering: cmd.type === "steer" ? [cmd.message] : [],
					followUps: cmd.type === "follow_up" ? [cmd.message] : [],
				},
			});
		if (cmd.type === "abort") {
			uiPending.clear();
			finish();
		}
	}
});
process.stdin.on("end", () => {
	clearTimeout(timer);
	if (process.env.PRIME_TEST_EXIT_MARKER) writeFileSync(process.env.PRIME_TEST_EXIT_MARKER, "closed");
	process.exit(0);
});
