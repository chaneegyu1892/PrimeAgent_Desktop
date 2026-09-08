import { useEffect, useRef, useState } from "react";
import type { DesktopAPI } from "../../shared/desktop-api";
import type { DesktopSnapshot } from "../../shared/dto";
import { readSendShortcut } from "../editor-keybindings";
import { Icon } from "../Icon";
import { AgentNotices, flowLabel, InteractionCards } from "../InteractionCards";
import { keyed } from "../keyed";
import { MarkdownMessage } from "../MarkdownMessage";
import { PromptInput } from "../PromptInput";
import { panelError, panelRequest } from "./panel-api";

export function SideChatPane({
	api,
	projectPath,
	context,
}: {
	api?: DesktopAPI;
	projectPath: string;
	context: string;
}) {
	const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null);
	const [text, setText] = useState("");
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);
	const [mode, setMode] = useState<"auto" | "steer" | "followUp">("auto");
	const sending = useRef(false);
	const scroll = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!api) return;
		let active = true;
		const accept = (value: DesktopSnapshot | null) => {
			if (active)
				setSnapshot((previous) => (!previous || (value && value.revision >= previous.revision) ? value : previous));
		};
		const unsubscribe = api.subscribePanel((event) => {
			if (event.type === "chat" && event.projectPath === projectPath) accept(event.snapshot);
		});
		void panelRequest(api, "panel.chatState", { projectPath })
			.then(accept)
			.catch((e) => {
				if (active) setError(panelError(e));
			});
		return () => {
			active = false;
			unsubscribe();
		};
	}, [api, projectPath]);
	const lastMessage = snapshot?.messages.at(-1);
	useEffect(() => {
		if (lastMessage && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
	}, [lastMessage]);
	const waiting = snapshot?.interactions.some((item) => item.status === "pending" || item.status === "sending");
	const running = !!snapshot?.state?.isStreaming || !!snapshot?.state?.isCompacting || !!waiting;
	const canSend = !!api && !!text.trim() && !pending;
	return (
		<div className="side-chat-pane">
			<div className="pane-toolbar">
				<span>본 대화와 별도 세션</span>
				<button
					type="button"
					disabled={pending || running || !snapshot}
					onClick={() =>
						void panelRequest(api, "panel.chatNew", { projectPath }).catch((e) => setError(panelError(e)))
					}
				>
					새 사이드 채팅
				</button>
			</div>
			<div className="side-chat-messages" ref={scroll}>
				{keyed(snapshot?.messages ?? [], (message) => `${message.role}:${message.timestamp}`).map(
					({ item: message, key }) => (
						<article key={key} className={`side-message ${message.role}`}>
							<strong>{message.role === "user" ? "나" : "Prime"}</strong>
							{message.role === "assistant" ? (
								<MarkdownMessage content={message.content} />
							) : (
								<p>{message.content}</p>
							)}
						</article>
					),
				)}
				{!snapshot?.messages.length && (
					<div className="pane-empty">
						<Icon name="chat" />
						<h3>옆에서 이어가는 대화</h3>
						<p>본 작업을 열어 둔 채 별도 질문을 할 수 있습니다.</p>
					</div>
				)}
				{snapshot && (
					<>
						<AgentNotices
							snapshot={snapshot}
							insert={(value) => setText((current) => `${current}${current ? "\n\n" : ""}${value}`)}
						/>
						<InteractionCards
							items={snapshot.interactions}
							respond={(reply) => panelRequest(api, "panel.chatRespond", { projectPath, reply })}
						/>
						{flowLabel(snapshot) && (
							<p role="status" className="flow-status">
								{flowLabel(snapshot)}
							</p>
						)}
						{snapshot.state && snapshot.state.queuedCount > 0 && (
							<p className="pane-caption">
								대기 중 {snapshot.state.queuedCount}개 ·{" "}
								{[...snapshot.state.steering, ...snapshot.state.followUps].join(" · ")}
							</p>
						)}
					</>
				)}
			</div>
			{(error || snapshot?.error) && (
				<p className="pane-error" role="alert">
					{error || snapshot?.error}
				</p>
			)}
			<form
				className="side-chat-composer"
				onSubmit={(e) => {
					e.preventDefault();
					if (!canSend || sending.current) return;
					const submitted = text;
					sending.current = true;
					setPending(true);
					setError("");
					void panelRequest(api, "panel.chatSend", { projectPath, message: submitted, mode })
						.then(() => setText((current) => (current === submitted ? "" : current)))
						.catch((err) => setError(panelError(err)))
						.finally(() => {
							sending.current = false;
							setPending(false);
						});
				}}
			>
				<PromptInput
					id="side-prompt"
					label="사이드 채팅 메시지"
					helpId="side-chat-help"
					value={text}
					onChange={setText}
					canSend={canSend}
					disabled={!api}
					sendShortcut={readSendShortcut()}
				/>
				<div className="pane-toolbar">
					<button
						type="button"
						disabled={!context}
						onClick={() => setText((current) => `${current}${current ? "\n\n" : ""}본 대화 참고:\n${context}`)}
					>
						본 대화 참고
					</button>
					<label className="sr-only" htmlFor="side-send-mode">
						사이드 채팅 전송 방식
					</label>
					<select
						id="side-send-mode"
						value={mode}
						onChange={(event) => setMode(event.target.value as "auto" | "steer" | "followUp")}
					>
						<option value="auto">{running ? "추가 지시 (자동)" : "메시지"}</option>
						<option value="steer">추가 지시</option>
						<option value="followUp">후속 작업</option>
					</select>
					{(running || pending) && (
						<button
							type="button"
							aria-label="사이드 채팅 중단"
							onClick={() =>
								void panelRequest(api, "panel.chatAbort", { projectPath }).catch((e) => setError(panelError(e)))
							}
						>
							<Icon name="stop" />
						</button>
					)}
					<button type="submit" className="primary icon-button" aria-label="사이드 채팅 전송" disabled={!canSend}>
						<Icon name="arrow" />
					</button>
				</div>
			</form>
			<p className="pane-caption" id="side-chat-help">
				{readSendShortcut() === "enter" ? "Enter 전송" : "⌘ / Ctrl + Enter 전송"} · Shift + Enter 줄바꿈
			</p>
		</div>
	);
}
