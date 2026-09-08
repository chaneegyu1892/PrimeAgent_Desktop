// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type { DesktopAPI, RequestInput, RequestName, RequestOutput } from "../src/shared/desktop-api";
import type { DesktopSnapshot, Result, SavedSession } from "../src/shared/dto";
import { EMPTY_SNAPSHOT } from "../src/shared/dto";
import type { Interaction } from "../src/shared/interactions";

afterEach(() => {
	cleanup();
	localStorage.clear();
});
function fakeApi() {
	const calls: { name: string; input: unknown }[] = [];
	let subscriber: ((snapshot: DesktopSnapshot) => void) | undefined;
	let revision = 1;
	const initial: DesktopSnapshot = {
		...structuredClone(EMPTY_SNAPSHOT),
		revision,
		connection: "connected",
		project: { path: "/fixture", name: "fixture", lastOpened: "now" },
		cliPath: "/fixture/prime-agent",
		state: {
			sessionId: "session",
			isStreaming: false,
			isCompacting: false,
			thinkingLevel: "high",
			queuedCount: 0,
			steering: [],
			followUps: [],
		},
	};
	let reject = false;
	const sessions: SavedSession[] = [];
	const unsubscribe = vi.fn();
	const api: DesktopAPI = {
		subscribePanel: () => () => {},
		request: async <K extends RequestName>(name: K, input: RequestInput<K>): Promise<Result<RequestOutput<K>>> => {
			calls.push({ name, input });
			if (reject && name.startsWith("agent.")) return { ok: false, error: "fixture send failed" };
			return {
				ok: true,
				value: (name === "model.list"
					? []
					: name === "app.snapshot"
						? initial
						: name === "session.list"
							? sessions
							: name === "attachment.select"
								? [{ id: "fixture-image", name: "photo.png", size: 1024, kind: "image" }]
								: undefined) as RequestOutput<K>,
			};
		},
		subscribe: (listener) => {
			subscriber = listener;
			return unsubscribe;
		},
	};
	return {
		api,
		calls,
		sessions,
		initial,
		unsubscribe,
		reject: () => {
			reject = true;
		},
		emit: (patch: Partial<DesktopSnapshot>) => subscriber?.({ ...initial, ...patch, revision: ++revision }),
	};
}
describe("desktop conversation", () => {
	it("shows a projectless welcome, migrates startup drafts only to the restored session and persists text", async () => {
		const fake = fakeApi();
		const restoredState = fake.initial.state!;
		fake.initial.project = { path: "/general", name: "일반 대화", kind: "personal", lastOpened: "now" };
		fake.initial.state = null;
		fake.initial.connection = "connecting";
		fake.initial.initializing = true;
		const view = render(<App api={fake.api} />);
		await screen.findByRole("heading", { name: "무엇을 함께 해볼까요?" });
		const input = screen.getByLabelText("메시지 입력") as HTMLTextAreaElement;
		fireEvent.change(input, { target: { value: "시작 중 작성한 초안" } });
		expect((screen.getByRole("button", { name: "전송" }) as HTMLButtonElement).disabled).toBe(false);
		act(() => fake.emit({ initializing: true, state: { ...restoredState, sessionId: "transient" } }));
		expect(input.value).toBe("시작 중 작성한 초안");
		act(() => fake.emit({ initializing: false, connection: "connected", state: restoredState }));
		expect(input.value).toBe("시작 중 작성한 초안");
		view.unmount();
		fake.initial.initializing = false;
		fake.initial.connection = "connected";
		fake.initial.state = restoredState;
		render(<App api={fake.api} />);
		await waitFor(() =>
			expect((screen.getByLabelText("메시지 입력") as HTMLTextAreaElement).value).toBe("시작 중 작성한 초안"),
		);
	});
	it("finds general conversations by title and starts a new general chat through its shortcut", async () => {
		const fake = fakeApi();
		fake.sessions.push({
			id: "general",
			path: "/general.jsonl",
			projectPath: "/general",
			title: "아이디어 정리",
			modified: new Date().toISOString(),
		});
		render(<App api={fake.api} />);
		await screen.findByText("아이디어 정리");
		fireEvent.change(screen.getByLabelText("대화 검색"), { target: { value: "아이디어" } });
		expect(screen.getByRole("heading", { name: "검색 결과 · 1" })).toBeTruthy();
		expect(screen.getByText("일반 대화")).toBeTruthy();
		fireEvent.keyDown(window, { key: "n", metaKey: true });
		await waitFor(() => expect(fake.calls.some((call) => call.name === "session.newGeneral")).toBe(true));
	});
	it("shows pending choices without selecting them and replies through the interaction channel", async () => {
		const fake = fakeApi();
		const item: Interaction = {
			id: "choice",
			method: "select",
			title: "어떻게 진행할까요?",
			options: ["방법 A", "방법 B"],
			message: "",
			placeholder: "",
			prefill: "",
			status: "pending",
		};
		fake.initial.interactions = [item];
		render(<App api={fake.api} />);
		await screen.findByRole("button", { name: "방법 B" });
		expect(fake.calls.some((call) => call.name === "agent.respond")).toBe(false);
		fireEvent.change(screen.getByLabelText("메시지 입력"), { target: { value: "유지할 초안" } });
		fireEvent.click(screen.getByRole("button", { name: "방법 B" }));
		await waitFor(() =>
			expect(fake.calls).toContainEqual({
				name: "agent.respond",
				input: { id: "choice", action: "choose", option: 1 },
			}),
		);
		act(() => fake.emit({ interactions: [{ ...item, status: "answered", answer: "방법 B" }] }));
		expect(screen.queryByRole("button", { name: "방법 B" })).toBeNull();
		expect((screen.getByLabelText("메시지 입력") as HTMLTextAreaElement).value).toBe("유지할 초안");
	});
	it("preserves answer text on failure and never executes markup in a confirmation", async () => {
		const fake = fakeApi();
		fake.initial.interactions = [
			{
				id: "input",
				method: "editor",
				title: "계획 수정",
				message: "<script>bad()</script>",
				options: [],
				placeholder: "",
				prefill: "기존 계획",
				status: "pending",
			},
		];
		render(<App api={fake.api} />);
		await screen.findByLabelText("내용 편집");
		fake.reject();
		fireEvent.change(screen.getByLabelText("내용 편집"), { target: { value: "수정한 계획" } });
		fireEvent.click(screen.getByRole("button", { name: "답변 보내기" }));
		await screen.findByRole("alert");
		expect(document.querySelector("script")).toBeNull();
		expect((screen.getByLabelText("내용 편집") as HTMLTextAreaElement).value).toBe("수정한 계획");
	});
	it("preserves the main draft across panel layouts and applies customized panel shortcuts", async () => {
		const fake = fakeApi();
		const view = render(<App api={fake.api} />);
		await screen.findByRole("heading", { name: "fixture" });
		fireEvent.change(screen.getByLabelText("메시지 입력"), { target: { value: "작업 중인 초안" } });
		fireEvent.click(screen.getByRole("button", { name: "작업 패널" }));
		expect(view.container.querySelectorAll(".panel-launch")).toHaveLength(6);
		fireEvent.click(screen.getByRole("button", { name: "패널을 아래로 이동" }));
		expect(view.container.querySelector(".tools-bottom")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "패널 확대" }));
		expect(view.container.querySelector(".tools-expanded")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "패널 크기 복원" }));
		fireEvent.click(screen.getByRole("button", { name: "단축키 설정" }));
		fireEvent.change(screen.getByLabelText("파일 단축키"), { target: { value: "Shift+Ctrl+G" } });
		fireEvent.click(screen.getByRole("button", { name: "저장" }));
		expect(screen.getByRole("alert").textContent).toContain("겹치지 않는");
		fireEvent.change(screen.getByLabelText("파일 단축키"), { target: { value: "Meta+J" } });
		fireEvent.click(screen.getByRole("button", { name: "저장" }));
		expect(JSON.parse(localStorage.getItem("prime-desktop:panel-shortcuts")!).files).toBe("Meta+J");
		fireEvent.click(screen.getByRole("button", { name: "작업 패널 닫기" }));
		fireEvent.keyDown(window, { key: "j", metaKey: true, isComposing: true });
		expect(screen.queryByRole("complementary", { name: "작업 패널" })).toBeNull();
		fireEvent.keyDown(window, { key: "j", metaKey: true });
		await screen.findByLabelText("파일 이름 필터");
		expect((screen.getByLabelText("메시지 입력") as HTMLTextAreaElement).value).toBe("작업 중인 초안");
		expect(fake.calls.some((call) => call.name === "agent.prompt")).toBe(false);
	});
	it("groups saved sessions by project, toggles folders, and opens a recent session", async () => {
		const fake = fakeApi();
		fake.initial.recent = [fake.initial.project!, { path: "/other", name: "other", lastOpened: "now" }];
		fake.sessions.push(
			{
				id: "saved",
				path: "/saved.jsonl",
				projectPath: "/fixture",
				title: "이전 대화",
				modified: new Date().toISOString(),
			},
			{
				id: "other",
				path: "/other.jsonl",
				projectPath: "/other",
				title: "다른 폴더의 대화",
				modified: new Date().toISOString(),
			},
		);
		const view = render(<App api={fake.api} />);
		await screen.findAllByText("이전 대화");
		expect(screen.getByRole("heading", { name: "프로젝트" })).toBeTruthy();
		expect(screen.getByRole("heading", { name: "최근" })).toBeTruthy();
		expect(view.container.querySelectorAll(".project-group")).toHaveLength(2);
		fireEvent.click(screen.getByRole("button", { name: "fixture 세션 접기" }));
		expect(screen.getAllByText("이전 대화")).toHaveLength(1);
		fireEvent.click(
			within(screen.getByRole("navigation", { name: "최근 세션" })).getByRole("button", {
				name: /다른 폴더의 대화/,
			}),
		);
		await waitFor(() =>
			expect(fake.calls).toContainEqual({
				name: "session.open",
				input: { path: "/other.jsonl", projectPath: "/other" },
			}),
		);
	});
	it("keeps attachment-only failed sends and isolates composer drafts across sessions", async () => {
		const fake = fakeApi();
		render(<App api={fake.api} />);
		await screen.findByRole("heading", { name: "fixture" });
		fireEvent.click(screen.getByRole("button", { name: "파일 첨부" }));
		await screen.findByText("photo.png");
		await waitFor(() =>
			expect((screen.getByRole("button", { name: "전송" }) as HTMLButtonElement).disabled).toBe(false),
		);
		fake.reject();
		fireEvent.click(screen.getByRole("button", { name: "전송" }));
		await screen.findByRole("alert");
		expect(fake.calls).toContainEqual({
			name: "agent.prompt",
			input: { message: "", attachmentIds: ["fixture-image"] },
		});
		expect(screen.getByText("photo.png")).toBeTruthy();
		fireEvent.change(screen.getByLabelText("메시지 입력"), { target: { value: "세션별 초안" } });
		act(() => fake.emit({ state: { ...fake.initial.state!, sessionId: "second" } }));
		expect(screen.queryByText("photo.png")).toBeNull();
		expect((screen.getByLabelText("메시지 입력") as HTMLTextAreaElement).value).toBe("");
		act(() => fake.emit({ state: fake.initial.state }));
		expect(screen.getByText("photo.png")).toBeTruthy();
		expect((screen.getByLabelText("메시지 입력") as HTMLTextAreaElement).value).toBe("세션별 초안");
		fireEvent.click(screen.getByRole("button", { name: "photo.png 첨부 제거" }));
		await waitFor(() => expect(screen.queryByText("photo.png")).toBeNull());
	});
	it("sends with Enter and leaves Shift+Enter to native newline insertion", async () => {
		const fake = fakeApi();
		render(<App api={fake.api} />);
		await screen.findByRole("heading", { name: "fixture" });
		const input = screen.getByLabelText("메시지 입력");
		fireEvent.change(input, { target: { value: "첫 줄\n둘째 줄" } });
		expect(fireEvent.keyDown(input, { key: "Enter", shiftKey: true })).toBe(true);
		expect(fake.calls.filter((call) => call.name === "agent.prompt")).toHaveLength(0);
		fireEvent.keyDown(input, { key: "Enter" });
		await waitFor(() =>
			expect(fake.calls.filter((call) => call.name === "agent.prompt")).toEqual([
				{ name: "agent.prompt", input: { message: "첫 줄\n둘째 줄" } },
			]),
		);
		await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(""));
	});
	it("does not submit composition confirmation, legacy IME Enter or repeated keys", async () => {
		const fake = fakeApi();
		render(<App api={fake.api} />);
		await screen.findByRole("heading", { name: "fixture" });
		const input = screen.getByLabelText("메시지 입력");
		fireEvent.change(input, { target: { value: "한글 입력" } });
		fireEvent.compositionStart(input);
		fireEvent.keyDown(input, { key: "Enter" });
		fireEvent.compositionEnd(input);
		fireEvent.keyDown(input, { key: "Enter", isComposing: true });
		fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
		fireEvent.keyDown(input, { key: "Enter", repeat: true });
		expect(fake.calls.filter((call) => call.name === "agent.prompt")).toHaveLength(0);
		fireEvent.keyDown(input, { key: "Enter" });
		await waitFor(() => expect(fake.calls.filter((call) => call.name === "agent.prompt")).toHaveLength(1));
	});
	it("blocks empty messages, accepts a disconnected send for preparation and steers an active run", async () => {
		const fake = fakeApi();
		render(<App api={fake.api} />);
		await screen.findByRole("heading", { name: "fixture" });
		const input = screen.getByLabelText("메시지 입력");
		fireEvent.keyDown(input, { key: "Enter" });
		fireEvent.change(input, { target: { value: "요청" } });
		act(() => fake.emit({ connection: "disconnected" }));
		fireEvent.keyDown(input, { key: "Enter" });
		await waitFor(() => expect(fake.calls.filter((call) => call.name === "agent.prompt")).toHaveLength(1));
		await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(""));
		act(() => fake.emit({ state: { ...fake.initial.state!, isStreaming: true } }));
		fireEvent.change(input, { target: { value: "추가 지시" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(fake.calls.filter((call) => call.name === "agent.prompt")).toHaveLength(1);
		await waitFor(() => expect(fake.calls.some((call) => call.name === "agent.steer")).toBe(true));
	});
	it("honors the persisted configurable send shortcut", async () => {
		localStorage.setItem("prime-desktop:send-shortcut", "modifierEnter");
		const fake = fakeApi();
		render(<App api={fake.api} />);
		await screen.findByRole("heading", { name: "fixture" });
		const input = screen.getByLabelText("메시지 입력");
		fireEvent.change(input, { target: { value: "설정된 전송" } });
		expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(true);
		expect(fake.calls.filter((call) => call.name === "agent.prompt")).toHaveLength(0);
		fireEvent.keyDown(input, { key: "Enter", metaKey: true });
		await waitFor(() => expect(fake.calls.filter((call) => call.name === "agent.prompt")).toHaveLength(1));
	});
	it("toggles navigation and activity without losing the draft", async () => {
		const fake = fakeApi();
		const view = render(<App api={fake.api} />);
		await screen.findByRole("heading", { name: "fixture" });
		const input = screen.getByLabelText("메시지 입력") as HTMLTextAreaElement;
		fireEvent.change(input, { target: { value: "작성 중" } });
		expect((view.container.querySelector("#activity-panel") as HTMLElement).hidden).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "실행 내역" }));
		expect((view.container.querySelector("#activity-panel") as HTMLElement).hidden).toBe(false);
		fireEvent.click(screen.getByRole("button", { name: "프로젝트 목록" }));
		expect((view.container.querySelector("#projects-panel") as HTMLElement).hidden).toBe(true);
		expect(input.value).toBe("작성 중");
	});
	it("formats assistant headings, lists, tables and code while preserving literal user input", async () => {
		const fake = fakeApi();
		const view = render(<App api={fake.api} />);
		await screen.findByRole("heading", { name: "fixture" });
		act(() =>
			fake.emit({
				messages: [
					{ role: "user", content: "## 이 입력은 그대로" },
					{
						role: "assistant",
						content: [
							"## 프로젝트 구조",
							"**핵심 구성**과 `src/main.ts`입니다.",
							"- 화면\n- 실행 엔진",
							"| 폴더 | 역할 |\n| --- | --- |\n| src | 앱 코드 |",
							"```text\nsrc/\n  main.ts\n```",
						].join("\n\n"),
					},
				],
			}),
		);
		expect(screen.getByRole("heading", { name: "프로젝트 구조" })).toBeTruthy();
		expect(screen.getByText("핵심 구성").tagName).toBe("STRONG");
		expect(screen.getAllByRole("listitem")).toHaveLength(2);
		expect(screen.getByRole("cell", { name: "앱 코드" })).toBeTruthy();
		expect(view.container.querySelector("pre code")?.textContent).toBe("src/\n  main.ts\n");
		expect(view.container.querySelector(".message.user .message-content")?.textContent).toBe("## 이 입력은 그대로");
	});
	it("updates an unfinished streamed code block and enables another prompt after completion", async () => {
		const fake = fakeApi();
		const view = render(<App api={fake.api} />);
		await screen.findByRole("heading", { name: "fixture" });
		act(() =>
			fake.emit({
				state: { ...fake.initial.state!, isStreaming: true },
				messages: [{ role: "assistant", timestamp: 1, content: "## 결과\n\n```ts\nconst" }],
			}),
		);
		expect(view.container.querySelector("pre code")?.textContent).toContain("const");
		fireEvent.change(screen.getByLabelText("메시지 입력"), { target: { value: "다음 요청" } });
		expect((screen.getByRole("button", { name: "전송" }) as HTMLButtonElement).disabled).toBe(false);
		act(() =>
			fake.emit({
				state: { ...fake.initial.state!, isStreaming: false },
				messages: [
					{ role: "assistant", timestamp: 1, content: "## 결과\n\n```ts\nconst x = 1;\n```\n\n완료했습니다." },
				],
			}),
		);
		expect(view.container.querySelectorAll(".message.assistant")).toHaveLength(1);
		expect(view.container.querySelector("pre code")?.textContent).toBe("const x = 1;\n");
		expect(screen.getByText("완료했습니다.")).toBeTruthy();
		expect((screen.getByRole("button", { name: "전송" }) as HTMLButtonElement).disabled).toBe(false);
	});
	it("does not create executable HTML, navigable links or remote images from replies", async () => {
		const fake = fakeApi();
		const view = render(<App api={fake.api} />);
		await screen.findByRole("heading", { name: "fixture" });
		act(() =>
			fake.emit({
				messages: [
					{
						role: "assistant",
						content:
							'<script>alert(1)</script>\n\n<img src="https://example.com/track">\n\n[위험](javascript:alert%281%29) [문서](https://example.com) ![미리보기](https://example.com/image.png)',
					},
				],
			}),
		);
		expect(
			view.container.querySelector(
				".markdown-body script, .markdown-body img, .markdown-body a, .markdown-body iframe",
			),
		).toBeNull();
		expect(screen.getByText("문서")).toBeTruthy();
		expect(screen.getByText("미리보기")).toBeTruthy();
	});
	it("sends prompt, steering and follow-up through the typed bridge", async () => {
		const fake = fakeApi();
		render(<App api={fake.api} />);
		await screen.findByRole("heading", { name: "fixture" });
		for (const [mode, command] of [
			["prompt", "agent.prompt"],
			["steer", "agent.steer"],
			["followUp", "agent.followUp"],
		]) {
			fireEvent.change(screen.getByLabelText("전송 방식"), { target: { value: mode } });
			fireEvent.change(screen.getByLabelText("메시지 입력"), { target: { value: "테스트 요청" } });
			fireEvent.click(screen.getByRole("button", { name: "전송" }));
			await waitFor(() => expect(fake.calls.some((call) => call.name === command)).toBe(true));
			await waitFor(() => expect((screen.getByLabelText("메시지 입력") as HTMLTextAreaElement).value).toBe(""));
		}
	});
	it("renders streamed text safely, enables abort, routes input to steering during execution", async () => {
		const fake = fakeApi();
		render(<App api={fake.api} />);
		await screen.findByRole("heading", { name: "fixture" });
		act(() =>
			fake.emit({
				state: { ...fake.initial.state!, isStreaming: true },
				messages: [{ role: "assistant", content: "<script>danger()</script> 한글" }],
			}),
		);
		expect(screen.getByText("<script>danger()</script> 한글")).toBeTruthy();
		expect(document.querySelector("script")).toBeNull();
		fireEvent.change(screen.getByLabelText("메시지 입력"), { target: { value: "request" } });
		expect((screen.getByRole("button", { name: "전송" }) as HTMLButtonElement).disabled).toBe(false);
		fireEvent.click(screen.getByRole("button", { name: "중단" }));
		await waitFor(() => expect(fake.calls.some((call) => call.name === "agent.abort")).toBe(true));
	});
	it("keeps a failed prompt in the composer for user review", async () => {
		const fake = fakeApi();
		render(<App api={fake.api} />);
		await screen.findByRole("heading", { name: "fixture" });
		fake.reject();
		fireEvent.change(screen.getByLabelText("메시지 입력"), { target: { value: "keep me" } });
		fireEvent.click(screen.getByRole("button", { name: "전송" }));
		await screen.findByRole("alert");
		expect((screen.getByLabelText("메시지 입력") as HTMLTextAreaElement).value).toBe("keep me");
	});
	it("unsubscribes from main events on unmount", async () => {
		const fake = fakeApi();
		const view = render(<App api={fake.api} />);
		await screen.findByRole("heading", { name: "fixture" });
		view.unmount();
		expect(fake.unsubscribe).toHaveBeenCalledOnce();
	});
});
