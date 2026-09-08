import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopAPI, RequestInput, RequestName, RequestOutput } from "../shared/desktop-api";
import type { DesktopSnapshot, ModelInfo } from "../shared/dto";
import { EMPTY_SNAPSHOT } from "../shared/dto";
import { THINKING_LEVELS } from "../shared/ipc-contract";
import { AttentionTray } from "./AttentionTray";
import { APP_SHORTCUT_LABELS, type AppShortcuts, readAppShortcuts, saveAppShortcuts } from "./app-shortcuts";
import officialLogo from "./assets/brand/primeintellect-logo.svg";
import officialSymbol from "./assets/brand/primeintellect-symbol.svg";
import officialWordmark from "./assets/brand/primeintellect-wordmark.svg";
import { CapabilityLibrary } from "./capabilities/CapabilityLibrary";
import { matchesShortcut, readSendShortcut, type SendShortcut, saveSendShortcut } from "./editor-keybindings";
import { Icon } from "./Icon";
import { AgentNotices, flowLabel, InteractionCards } from "./InteractionCards";
import { keyed } from "./keyed";
import { MarkdownMessage } from "./MarkdownMessage";
import { PromptInput } from "./PromptInput";
import { type Pane, parsePanelShortcut, readPanelShortcuts } from "./panels/panel-shortcuts";
import { WorkspacePanel } from "./panels/WorkspacePanel";
import { SessionSidebar } from "./SessionSidebar";
import { UpdateNotice } from "./UpdateNotice";
import { useDrafts } from "./use-drafts";
import { useSessions } from "./use-sessions";

const statusNames = { disconnected: "준비 대기", connecting: "준비 중", connected: "준비됨", error: "연결 확인 필요" };
const roles: Record<string, string> = {
	user: "나",
	assistant: "Prime",
	toolResult: "도구 결과",
	bashExecution: "명령 실행",
};
type SendMode = "prompt" | "steer" | "followUp";
const modes: Record<SendMode, { label: string; hint: string }> = {
	prompt: { label: "메시지", hint: "새 작업을 요청합니다." },
	steer: { label: "추가 지시", hint: "실행 중인 작업에 지시를 추가합니다. 현재 도구 실행 후 반영됩니다." },
	followUp: { label: "후속 작업", hint: "현재 작업이 끝난 뒤 실행할 작업을 예약합니다." },
};
export function App({ api = window.primeDesktop }: { api?: DesktopAPI }) {
	const [snapshot, setSnapshot] = useState<DesktopSnapshot>(EMPTY_SNAPSHOT);
	const { text, attachments, setText, setAttachments, complete } = useDrafts(snapshot);
	const sessionList = useSessions(api, snapshot);
	const [mode, setMode] = useState<SendMode>("prompt");
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState("");
	const [pending, setPending] = useState(false);
	const [sending, setSending] = useState(false);
	const sendingRef = useRef(false);
	const [sendShortcut, setSendShortcut] = useState(readSendShortcut);
	const [library, setLibrary] = useState(false);
	const [showProjects, setShowProjects] = useState(true);
	const [showActivity, setShowActivity] = useState(false);
	const [showTools, setShowTools] = useState(false);
	const [toolPane, setToolPane] = useState<Pane | null>(null);
	const [toolDock, setToolDock] = useState<"right" | "bottom">("right");
	const [toolsExpanded, setToolsExpanded] = useState(false);
	const [panelShortcuts, setPanelShortcuts] = useState(readPanelShortcuts);
	const [appShortcuts, setAppShortcuts] = useState(readAppShortcuts);
	const [search, setSearch] = useState("");
	const searchRef = useRef<HTMLInputElement>(null);
	const [awayFromBottom, setAwayFromBottom] = useState(false);
	useEffect(() => {
		const handler = (event: KeyboardEvent) => {
			if (event.isComposing || event.repeat || document.querySelector("dialog[open]")) return;
			for (const [name, value] of Object.entries(panelShortcuts)) {
				const shortcut = parsePanelShortcut(value);
				if (
					shortcut &&
					matchesShortcut(
						{
							...shortcut,
							key: event.key.toLowerCase(),
							metaKey: event.metaKey,
							ctrlKey: event.ctrlKey,
							shiftKey: event.shiftKey,
							altKey: event.altKey,
						},
						[shortcut],
					)
				) {
					event.preventDefault();
					setShowTools(true);
					setShowActivity(false);
					setToolPane(name as Pane);
					return;
				}
			}
		};
		window.addEventListener("keydown", handler, true);
		return () => window.removeEventListener("keydown", handler, true);
	}, [panelShortcuts]);
	const [panel, setPanel] = useState<"settings" | "diagnostics" | null>(null);
	const [models, setModels] = useState<ModelInfo[]>([]);
	const [sessionName, setSessionName] = useState("");
	const scroller = useRef<HTMLDivElement>(null);
	const autoScroll = useRef(true);
	const accept = useCallback(
		(next: DesktopSnapshot) => setSnapshot((previous) => (next.revision >= previous.revision ? next : previous)),
		[],
	);
	const dialogRef = useRef<HTMLDialogElement>(null);
	const latestMessage = snapshot.messages.at(-1);
	useEffect(() => {
		const dialog = dialogRef.current;
		if (panel && dialog && !dialog.open) dialog.showModal();
		return () => {
			if (dialog?.open) dialog.close();
		};
	}, [panel]);
	useEffect(() => {
		if (!api) return;
		let active = true;
		const unsubscribe = api.subscribe((value) => {
			if (active) accept(value);
		});
		void api
			.request("app.snapshot", undefined)
			.then((result) => {
				if (!active) return;
				if (result.ok) accept(result.value);
				else setError(result.error);
			})
			.catch(() => {
				if (active) setError("데스크톱 연결을 초기화하지 못했습니다.");
			});
		return () => {
			active = false;
			unsubscribe();
		};
	}, [api, accept]);
	useEffect(() => {
		if (latestMessage && autoScroll.current && scroller.current)
			scroller.current.scrollTop = scroller.current.scrollHeight;
	}, [latestMessage]);
	const connected = snapshot.connection === "connected";
	const showWelcome =
		snapshot.messages.length === 0 && snapshot.interactions.length === 0 && snapshot.notices.length === 0;
	const waiting = snapshot.interactions.some((item) => item.status === "pending" || item.status === "sending");
	const running = !!snapshot.state?.isStreaming || !!snapshot.state?.isCompacting || waiting;
	const effectiveMode = mode === "prompt" && running ? "steer" : mode;
	useEffect(() => {
		if (waiting) {
			setPanel(null);
			setLibrary(false);
		}
	}, [waiting]);
	const locked = pending || sending || snapshot.initializing || snapshot.connection === "connecting";
	const canSend = !!api && (!!text.trim() || attachments.length > 0) && !sending && !pending;
	useEffect(() => {
		const handler = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.isComposing || event.repeat || document.querySelector("dialog[open]"))
				return;
			for (const [name, value] of Object.entries(appShortcuts)) {
				const shortcut = parsePanelShortcut(value);
				if (
					!shortcut ||
					!matchesShortcut(
						{
							key: event.key.toLowerCase(),
							metaKey: event.metaKey,
							ctrlKey: event.ctrlKey,
							shiftKey: event.shiftKey,
							altKey: event.altKey,
						},
						[shortcut],
					)
				)
					continue;
				event.preventDefault();
				if (name === "search") {
					setShowProjects(true);
					requestAnimationFrame(() => searchRef.current?.focus());
				} else if (!locked && !running) void action(() => request("session.newGeneral", undefined));
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	});
	useEffect(() => {
		if (panel !== "settings" || !connected || !api) return;
		let active = true;
		void api
			.request("model.list", undefined)
			.then((result) => {
				if (active && result.ok) setModels(result.value);
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	}, [panel, connected, api]);
	async function request<K extends RequestName>(name: K, input: RequestInput<K>): Promise<RequestOutput<K>> {
		if (!api) throw new Error("Prime Desktop 앱에서 실행하세요.");
		const result = await api.request(name, input);
		if (!result.ok) throw new Error(result.error);
		const value = result.value;
		if (value && typeof value === "object" && "revision" in value) {
			const next = value as DesktopSnapshot;
			accept(next);
		}
		return value;
	}
	async function action(work: () => Promise<unknown>): Promise<void> {
		setPending(true);
		setError(null);
		setNotice("");
		try {
			await work();
		} catch (e) {
			setError(e instanceof Error ? e.message : "요청을 처리하지 못했습니다.");
		} finally {
			setPending(false);
		}
	}
	async function send(event: FormEvent) {
		event.preventDefault();
		if (!canSend || sendingRef.current) return;
		sendingRef.current = true;
		const submitted = text;
		const submittedIds = attachments.map((file) => file.id);
		setSending(true);
		setError(null);
		setNotice("");
		try {
			await request(`agent.${effectiveMode}`, {
				message: submitted,
				...(submittedIds.length ? { attachmentIds: submittedIds } : {}),
			});
			complete(submitted, submittedIds);
			if (effectiveMode !== "prompt")
				setNotice(effectiveMode === "steer" ? "추가 지시를 전달했습니다." : "후속 작업을 전달했습니다.");
		} catch (e) {
			setError(e instanceof Error ? e.message : "전송에 실패했습니다.");
		} finally {
			sendingRef.current = false;
			setSending(false);
		}
	}
	return (
		<div
			className={`desktop-shell ${showWelcome ? "is-new-chat" : ""} ${showProjects ? "" : "projects-collapsed"} ${showActivity ? "with-activity" : ""} ${showTools ? `with-tools tools-${toolDock} ${toolsExpanded ? "tools-expanded" : ""}` : ""}`}
		>
			<AttentionTray
				api={api}
				main={snapshot}
				openMain={() => {
					setToolsExpanded(false);
					setShowTools(false);
					setPanel(null);
					requestAnimationFrame(() =>
						scroller.current?.querySelector(".interaction-card.pending")?.scrollIntoView({ block: "center" }),
					);
				}}
			/>
			<aside className="projects" id="projects-panel" hidden={!showProjects}>
				<div className="brand">
					<img src={officialLogo} alt="Prime Intellect" width="184" height="31" />
					<span className="brand-caption">DESKTOP</span>
				</div>
				<button
					type="button"
					className="new-chat"
					disabled={!api || locked || running}
					onClick={() => void action(() => request("session.newGeneral", undefined))}
				>
					<Icon name="plus" /> 새 대화
				</button>
				<label className="sidebar-search">
					<Icon name="search" />
					<input
						ref={searchRef}
						aria-label="대화 검색"
						placeholder="대화 검색"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
					/>
					{search && (
						<button type="button" aria-label="검색 지우기" className="icon-button" onClick={() => setSearch("")}>
							<Icon name="close" />
						</button>
					)}
				</label>
				<button
					type="button"
					className="open-project"
					disabled={!api || locked || running}
					onClick={() => void action(() => request("project.selectDirectory", undefined))}
				>
					<Icon name="folder" /> 폴더 열기 <Icon name="plus" />
				</button>
				<SessionSidebar
					filter={search}
					snapshot={snapshot}
					sessions={sessionList.sessions}
					loading={sessionList.loading}
					error={sessionList.error}
					disabled={!api || locked || running}
					onRefresh={sessionList.refresh}
					onOpen={(session) =>
						void action(() => request("session.open", { path: session.path, projectPath: session.projectPath }))
					}
					onProject={(path) => {
						if (path !== snapshot.project?.path) void action(() => request("project.openRecent", { path }));
					}}
					onCreate={(path) => void action(() => request("session.create", { path }))}
					onRemove={(path) => void action(() => request("project.removeRecent", { path }))}
				/>
				<div className="sidebar-footer">
					<UpdateNotice api={api} />
					<button type="button" onClick={() => setLibrary(true)}>
						<Icon name="plugin" /> 확장 라이브러리
					</button>
					<span className="local-tag">Prime Desktop</span>
					<button
						type="button"
						onClick={() => {
							setPanel("settings");
							setError(null);
						}}
					>
						<Icon name="settings" /> 설정
					</button>
					<button type="button" onClick={() => setPanel("diagnostics")}>
						진단 로그
					</button>
				</div>
			</aside>
			<main className="workspace">
				<header className="workspace-header">
					<div className="workspace-title">
						<button
							type="button"
							className="icon-button"
							aria-label="프로젝트 목록"
							aria-expanded={showProjects}
							aria-controls="projects-panel"
							onClick={() => setShowProjects((value) => !value)}
						>
							<Icon name="panel" />
						</button>
						<div>
							<h1>
								{snapshot.project?.kind === "personal" || !snapshot.project
									? snapshot.state?.sessionName || "새 대화"
									: snapshot.project.name}
							</h1>
							<p className="path" title={snapshot.project?.path}>
								{snapshot.project?.kind === "personal" || !snapshot.project
									? "일반 대화"
									: snapshot.project.path}
							</p>
						</div>
					</div>
					<div className="connection-controls">
						<span className={`status ${snapshot.connection}`}>
							<i />
							{statusNames[snapshot.connection]}
						</span>
						<button
							type="button"
							className="icon-button"
							aria-label="작업 패널"
							title="작업 패널 접기·펼치기"
							aria-expanded={showTools}
							aria-controls="workspace-panel"
							onClick={() => {
								setShowTools((value) => !value);
								setShowActivity(false);
							}}
						>
							<Icon name="panelRight" />
						</button>
						<button
							type="button"
							className="activity-toggle"
							aria-label="실행 내역"
							aria-expanded={showActivity}
							aria-controls="activity-panel"
							onClick={() => {
								setShowActivity((value) => !value);
								setShowTools(false);
							}}
						>
							<Icon name="activity" />
							<span>{snapshot.activity.length > 0 ? snapshot.activity.length : "실행 내역"}</span>
						</button>
					</div>
				</header>
				<div className="session-toolbar">
					<span>{snapshot.state?.sessionName || "대화"}</span>
					<div>
						<button
							type="button"
							disabled={!connected || locked || running}
							onClick={() => void action(() => request("session.new", undefined))}
						>
							새 세션
						</button>
						<button
							type="button"
							disabled={!connected || locked || running}
							onClick={() => void action(() => request("session.resume", undefined))}
						>
							세션 열기
						</button>
						<button
							type="button"
							disabled={!connected || locked}
							onClick={() =>
								void action(() => request("agent.refresh", undefined).then(() => sessionList.refresh()))
							}
						>
							새로고침
						</button>
					</div>
				</div>
				{!api && (
					<div className="banner">
						브라우저 미리보기입니다. 폴더 선택과 에이전트 실행은 Prime Desktop 앱에서 사용할 수 있습니다.
					</div>
				)}
				{api && !snapshot.cliPath && (
					<div className="banner">
						Prime Agent 실행 파일을 찾지 못했습니다.{" "}
						<button type="button" onClick={() => setPanel("settings")}>
							설정 열기
						</button>
					</div>
				)}
				{(error || snapshot.error) && (
					<div className="banner error" role="alert">
						{error || snapshot.error}
						{snapshot.connection === "error" && (
							<>
								<button
									type="button"
									disabled={locked}
									onClick={() => void action(() => request("agent.reconnect", undefined))}
								>
									다시 연결
								</button>
								<button
									type="button"
									disabled={locked}
									onClick={() => void action(() => request("agent.connect", undefined))}
								>
									새 세션으로 연결
								</button>
							</>
						)}
						<button type="button" onClick={() => setPanel("diagnostics")}>
							진단 보기
						</button>
					</div>
				)}
				<div
					className="conversation"
					ref={scroller}
					onScroll={() => {
						const el = scroller.current;
						if (el) {
							autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
							setAwayFromBottom(!autoScroll.current);
						}
					}}
				>
					{showWelcome ? (
						<div className="empty-conversation">
							<span className="empty-symbol" aria-hidden="true">
								<img src={officialSymbol} alt="" width="72" height="52" />
							</span>
							<h2>무엇을 함께 해볼까요?</h2>
							<p>
								{snapshot.project && snapshot.project.kind !== "personal"
									? `${snapshot.project.name}에서 작업합니다. 요청을 입력하세요.`
									: "질문, 아이디어, 작업을 바로 시작하세요."}
							</p>
							<div className="suggestions">
								{(snapshot.project && snapshot.project.kind !== "personal"
									? ["프로젝트 구조를 설명해줘", "개선할 부분을 찾아줘", "테스트 실행 방법을 알려줘"]
									: ["아이디어를 함께 정리해줘", "이 내용을 쉽게 설명해줘", "작업 계획을 세워보자"]
								).map((suggestion) => (
									<button type="button" key={suggestion} onClick={() => setText(suggestion)}>
										{suggestion}
									</button>
								))}
							</div>
						</div>
					) : (
						keyed(
							snapshot.messages,
							(message) =>
								`${snapshot.state?.sessionId}:${message.timestamp ?? "undated"}:${message.role}:${message.toolCallId ?? ""}`,
						).map(({ item: message, key }) => (
							<article className={`message ${message.role}`} key={key}>
								<div className="message-meta">
									{message.role === "assistant" && <img src={officialSymbol} alt="" width="23" height="18" />}
									<strong>{roles[message.role] ?? message.role}</strong>
									{message.toolName && <span>{message.toolName}</span>}
								</div>
								{message.role === "assistant" ? (
									<MarkdownMessage content={message.content} />
								) : (
									<div className="message-content">{message.content || "…"}</div>
								)}
								{message.error && <p className="message-error">{message.error}</p>}
								{message.content.trim() && (
									<button
										type="button"
										className="message-copy"
										aria-label={`${roles[message.role] ?? message.role} 메시지 복사`}
										onClick={() =>
											void request("app.copyText", { text: message.content })
												.then(() => setNotice("메시지를 복사했습니다."))
												.catch(() => setError("복사하지 못했습니다."))
										}
									>
										<Icon name="copy" />
										복사
									</button>
								)}
							</article>
						))
					)}
					<AgentNotices
						snapshot={snapshot}
						insert={(value) => setText((current) => `${current}${current ? "\n\n" : ""}${value}`)}
					/>
					<InteractionCards items={snapshot.interactions} respond={(reply) => request("agent.respond", reply)} />
					{flowLabel(snapshot) && (
						<div className="flow-status" role="status">
							{flowLabel(snapshot)}
						</div>
					)}
				</div>
				<div className="composer-dock">
					{awayFromBottom && (
						<button
							type="button"
							className="jump-to-bottom"
							onClick={() => {
								if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
								autoScroll.current = true;
								setAwayFromBottom(false);
							}}
						>
							최근 메시지로 이동 ↓
						</button>
					)}
					{sending && !connected && (
						<p className="notice" role="status">
							대화를 준비하고 있습니다. 준비되면 요청을 한 번 전달합니다.
						</p>
					)}
					<form className="composer" onSubmit={(event) => void send(event)}>
						{running && (
							<p className="intervention-hint">
								{waiting ? "위 요청 카드에서 답변할 수 있습니다. " : ""}
								{effectiveMode === "followUp"
									? "현재 작업이 끝난 뒤 처리할 요청을 예약합니다."
									: "지금 보내면 현재 작업에 추가 지시로 전달합니다."}
							</p>
						)}
						{snapshot.state && snapshot.state.queuedCount > 0 && (
							<div className="queue" role="status">
								대기 중 {snapshot.state.queuedCount}개
								{keyed([...snapshot.state.steering, ...snapshot.state.followUps], (item) => item).map(
									({ item, key }) => (
										<span key={key}>{item}</span>
									),
								)}
							</div>
						)}
						{attachments.length > 0 && (
							<section className="attachment-list" aria-label="첨부파일 목록">
								{attachments.map((file) => (
									<div className="attachment-chip" key={file.id}>
										<Icon name={file.kind === "image" ? "image" : "file"} />
										<span>
											<strong title={file.name}>{file.name}</strong>
											<small>
												{file.kind === "image" ? "이미지" : "로컬 파일 참조"} ·{" "}
												{file.size < 1024 * 1024
													? `${Math.max(1, Math.round(file.size / 1024))} KB`
													: `${(file.size / 1024 / 1024).toFixed(1)} MB`}
											</small>
										</span>
										<button
											type="button"
											className="icon-button"
											aria-label={`${file.name} 첨부 제거`}
											disabled={sending}
											onClick={() =>
												void action(async () => {
													await request("attachment.remove", { id: file.id });
													setAttachments((current) => current.filter((item) => item.id !== file.id));
												})
											}
										>
											<Icon name="close" />
										</button>
									</div>
								))}
							</section>
						)}
						<PromptInput
							value={text}
							onChange={setText}
							canSend={canSend}
							disabled={!api}
							sendShortcut={sendShortcut}
						/>
						<div className="composer-bottom">
							<div className="composer-options">
								<button
									type="button"
									className="icon-button attach-button"
									aria-label="파일 첨부"
									title="파일 첨부 · 이미지는 직접 전달, 문서는 로컬 경로 참조"
									disabled={!api || locked || attachments.length >= 10}
									onClick={() =>
										void action(async () => {
											const selected = await request("attachment.select", undefined);
											if (attachments.length + selected.length > 10) {
												for (const file of selected) await request("attachment.remove", { id: file.id });
												throw new Error("한 메시지에 최대 10개를 첨부할 수 있습니다.");
											}
											setAttachments((current) => [...current, ...selected]);
										})
									}
								>
									<Icon name="attach" />
								</button>
								<label className="sr-only" htmlFor="send-mode">
									전송 방식
								</label>
								<select
									id="send-mode"
									value={mode}
									title={modes[effectiveMode].hint}
									onChange={(event) => setMode(event.target.value as SendMode)}
								>
									{Object.entries(modes).map(([value, item]) => (
										<option key={value} value={value}>
											{value === "prompt" && running ? "추가 지시 (자동)" : item.label}
										</option>
									))}
								</select>
								<button
									type="button"
									className="model-chip"
									onClick={() => setPanel("settings")}
									title="모델과 추론 수준 설정"
								>
									{snapshot.state?.model?.name ?? "모델 준비 중"}
									{snapshot.state && ` · ${snapshot.state.thinkingLevel}`}
								</button>
							</div>
							<div className="composer-actions">
								<button
									type="button"
									className="icon-button stop"
									aria-label="중단"
									title="현재 작업 중단"
									disabled={
										!connected && snapshot.connection !== "connecting" && !snapshot.initializing && !sending
									}
									onClick={() => {
										void request("agent.abort", undefined).catch((e) =>
											setError(e instanceof Error ? e.message : "중단에 실패했습니다."),
										);
									}}
								>
									<Icon name="stop" />
								</button>
								<button
									type="submit"
									className="primary send-button"
									aria-label={sending ? "전송 중…" : "전송"}
									title="메시지 전송"
									disabled={!canSend}
								>
									<Icon name="arrow" />
								</button>
							</div>
						</div>
					</form>
					<div className="composer-help" id="composer-help">
						<span>
							{!connected
								? "준비 중에도 작성할 수 있습니다. 전송하면 준비 후 전달합니다."
								: running && mode === "prompt"
									? "실행 중에는 추가 지시로 전송됩니다. 후속 작업으로 예약할 수도 있습니다."
									: mode !== "prompt"
										? modes[mode].hint
										: snapshot.project?.kind === "personal"
											? "일반 대화 · 초안은 이 기기에 보관됩니다."
											: "이 프로젝트에서 작업합니다. 초안은 자동 보관됩니다."}
						</span>
						<span>
							{sendShortcut === "enter" ? "Enter 전송" : "⌘ / Ctrl + Enter 전송"} · Shift + Enter 줄바꿈
						</span>
					</div>
					{notice && (
						<p role="status" className="notice">
							{notice}
						</p>
					)}
				</div>
			</main>
			<WorkspacePanel
				api={api}
				snapshot={snapshot}
				pane={toolPane}
				setPane={setToolPane}
				open={showTools}
				close={() => {
					setShowTools(false);
					setToolsExpanded(false);
				}}
				dock={toolDock}
				setDock={setToolDock}
				expanded={toolsExpanded}
				setExpanded={setToolsExpanded}
				shortcuts={panelShortcuts}
				setShortcuts={setPanelShortcuts}
				insert={(value) => setText((current) => `${current}${current ? "\n\n" : ""}${value}`)}
			/>
			<aside className="activity-panel" id="activity-panel" hidden={!showActivity}>
				<div className="activity-heading">
					<h2>실행 내역</h2>
					<button
						type="button"
						className="icon-button"
						aria-label="실행 내역 닫기"
						onClick={() => setShowActivity(false)}
					>
						<Icon name="close" />
					</button>
				</div>
				<p className="muted small">도구 실행과 재시도 상태</p>
				{snapshot.activity.length === 0 && (
					<p className="activity-empty">작업을 시작하면 실행 과정이 표시됩니다.</p>
				)}
				<div className="activity-list">
					{snapshot.activity.map((item) => (
						<details className={`activity-item ${item.isError ? "error" : ""}`} key={item.id}>
							<summary>
								<strong>{item.label}</strong>
								<span>
									{item.type.endsWith("_start")
										? "실행 중"
										: item.type.endsWith("_update")
											? "진행 중"
											: item.type.endsWith("_interrupted")
												? "중단됨"
												: item.isError
													? "오류"
													: "완료"}
								</span>
							</summary>
							<pre>{item.detail || "추가 출력 없음"}</pre>
						</details>
					))}
				</div>
				<div className="session-info">
					<span className="eyebrow">SESSION</span>
					<code>{snapshot.state?.sessionId ?? "세션 없음"}</code>
					<p>앱을 종료하면 일반 RPC 작업도 종료됩니다.</p>
				</div>
			</aside>
			{library && (
				<CapabilityLibrary
					api={api}
					close={() => setLibrary(false)}
					insert={(value) => setText((current) => `${value}${current}`)}
					canApply={!locked && !running}
					apply={async () => {
						await request("agent.reconnect", undefined);
					}}
				/>
			)}
			{panel && (
				<dialog ref={dialogRef} className="modal" aria-labelledby="panel-title" onCancel={() => setPanel(null)}>
					<div className="modal-heading">
						<h2 id="panel-title">{panel === "settings" ? "설정" : "진단 로그"}</h2>
						<button type="button" aria-label="닫기" onClick={() => setPanel(null)}>
							닫기
						</button>
					</div>
					{panel === "settings" ? (
						<>
							<div className="about-brand">
								<img src={officialWordmark} alt="Prime Intellect" width="170" height="17" />
								<span>Prime Desktop</span>
							</div>
							<div className="setting-group">
								<h3>메시지 입력</h3>
								{Object.entries(appShortcuts).map(([name, value]) => (
									<label key={name}>
										{APP_SHORTCUT_LABELS[name as keyof AppShortcuts]} 단축키
										<input
											aria-label={`${APP_SHORTCUT_LABELS[name as keyof AppShortcuts]} 단축키`}
											defaultValue={value}
											onBlur={(event) => {
												const next = event.target.value;
												const parsed = parsePanelShortcut(next);
												const duplicate = [
													...Object.entries(appShortcuts)
														.filter(([key]) => key !== name)
														.map(([, val]) => val),
													...Object.values(panelShortcuts),
												].some((val) => JSON.stringify(parsePanelShortcut(val)) === JSON.stringify(parsed));
												if (!parsed || duplicate) {
													event.target.value = value;
													setError("다른 기능과 겹치지 않는 단축키를 입력하세요. 예: Meta+N");
													return;
												}
												const updated = { ...appShortcuts, [name]: next };
												setAppShortcuts(updated);
												saveAppShortcuts(updated);
												setError(null);
											}}
										/>
									</label>
								))}
								<label>
									전송 단축키
									<select
										aria-label="전송 단축키"
										value={sendShortcut}
										onChange={(event) => {
											const value = event.target.value as SendShortcut;
											setSendShortcut(value);
											saveSendShortcut(value);
										}}
									>
										<option value="enter">Enter로 전송</option>
										<option value="modifierEnter">⌘ / Ctrl + Enter로 전송</option>
									</select>
								</label>
								<p className="muted small">
									Shift + Enter로 줄바꿈합니다. 입력창은 내용에 맞춰 최대 8줄까지 늘어납니다.
								</p>
							</div>
							<div className="setting-group">
								<h3>Prime Agent 실행 파일</h3>
								<div className="button-row">
									<button
										type="button"
										disabled={locked || running}
										onClick={() =>
											void action(() =>
												request(connected ? "agent.disconnect" : "agent.reconnect", undefined),
											)
										}
									>
										{connected ? "연결 해제" : "다시 연결"}
									</button>
								</div>
								<code className="setting-path">{snapshot.cliPath ?? "선택되지 않음"}</code>
								<div className="button-row">
									<button
										type="button"
										disabled={!api || locked || running}
										onClick={() => void action(() => request("settings.detectCli", undefined))}
									>
										자동 탐색
									</button>
									<button
										type="button"
										disabled={!api || locked || running}
										onClick={() => void action(() => request("settings.selectCli", undefined))}
									>
										파일 선택
									</button>
								</div>
								<p className="muted small">
									기존 Prime Agent 인증을 사용합니다. 인증 오류가 나면 터미널에서 prime-agent를 실행하고
									/login으로 로그인한 뒤 다시 연결하세요.
								</p>
							</div>
							<div className="setting-group">
								<h3>모델과 추론 수준</h3>
								<button
									type="button"
									disabled={!connected || locked}
									onClick={() => void action(async () => setModels(await request("model.list", undefined)))}
								>
									모델 목록 불러오기
								</button>
								{models.length > 0 && (
									<label>
										모델
										<select
											aria-label="모델"
											disabled={running || locked}
											value={`${snapshot.state?.model?.provider}/${snapshot.state?.model?.id}`}
											onChange={(event) => {
												const model = models.find((m) => `${m.provider}/${m.id}` === event.target.value);
												if (model)
													void action(() =>
														request("model.select", { provider: model.provider, modelId: model.id }),
													);
											}}
										>
											<option value="" disabled>
												모델 선택
											</option>
											{models.map((model) => (
												<option
													key={`${model.provider}/${model.id}`}
													value={`${model.provider}/${model.id}`}
												>
													{model.provider} / {model.name}
												</option>
											))}
										</select>
									</label>
								)}
								<label>
									Thinking level
									<select
										aria-label="Thinking level"
										disabled={!connected || running || locked}
										value={snapshot.state?.thinkingLevel ?? "high"}
										onChange={(event) =>
											void action(() => request("model.setThinkingLevel", { level: event.target.value }))
										}
									>
										{THINKING_LEVELS.map((level) => (
											<option key={level}>{level}</option>
										))}
									</select>
								</label>
							</div>
							<div className="setting-group">
								<h3>세션 이름</h3>
								<label className="sr-only" htmlFor="session-name">
									세션 이름
								</label>
								<input
									id="session-name"
									value={sessionName}
									maxLength={512}
									placeholder={snapshot.state?.sessionName ?? "이름 입력"}
									onChange={(event) => setSessionName(event.target.value)}
								/>
								<button
									type="button"
									disabled={!connected || running || locked || !sessionName.trim()}
									onClick={() => void action(() => request("session.setName", { name: sessionName }))}
								>
									이름 저장
								</button>
							</div>
						</>
					) : (
						<>
							<p className="muted small">
								연결 오류와 Prime Agent stderr를 확인합니다. 알려진 비밀 값은 마스킹됩니다.
							</p>
							<button
								type="button"
								disabled={!api}
								onClick={() =>
									void action(async () => {
										await request("agent.copyDiagnostics", undefined);
										setNotice("진단 로그를 복사했습니다.");
									})
								}
							>
								진단 로그 복사
							</button>
							<div className="diagnostics">
								{snapshot.diagnostics.length === 0 ? (
									<p>아직 진단 로그가 없습니다.</p>
								) : (
									keyed(snapshot.diagnostics, (item) => `${item.time}:${item.message}`).map(
										({ item, key }) => (
											<div className={`diagnostic ${item.level}`} key={key}>
												<time>{item.time}</time>
												<pre>{item.message}</pre>
											</div>
										),
									)
								)}
							</div>
						</>
					)}
					{error && (
						<p className="message-error" role="alert">
							{error}
						</p>
					)}
					{notice && <p role="status">{notice}</p>}
				</dialog>
			)}
		</div>
	);
}
