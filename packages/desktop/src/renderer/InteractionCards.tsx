import { useEffect, useId, useRef, useState } from "react";
import type { DesktopSnapshot } from "../shared/dto";
import type { Interaction, InteractionReply } from "../shared/interactions";
import "./interactions.css";

export function InteractionCards({
	items,
	respond,
}: {
	items: Interaction[];
	respond: (reply: InteractionReply) => Promise<unknown>;
}) {
	const pending = items.filter((item) => item.status === "pending" || item.status === "sending");
	const history = items.filter((item) => item.status !== "pending" && item.status !== "sending");
	return (
		<div className="interaction-list">
			{history.length > 1 && (
				<details className="interaction-history">
					<summary>이전 요청 {history.length - 1}개</summary>
					{history.slice(0, -1).map((item) => (
						<InteractionCard key={item.id} item={item} respond={respond} />
					))}
				</details>
			)}
			{history.slice(-1).map((item) => (
				<InteractionCard key={item.id} item={item} respond={respond} />
			))}
			{pending.map((item) => (
				<InteractionCard key={item.id} item={item} respond={respond} />
			))}
		</div>
	);
}
function InteractionCard({
	item,
	respond,
}: {
	item: Interaction;
	respond: (reply: InteractionReply) => Promise<unknown>;
}) {
	const [text, setText] = useState(item.prefill);
	const inputId = useId();
	const [busy, setBusy] = useState(false);
	const guard = useRef(false);
	const [error, setError] = useState("");
	const [now, setNow] = useState(Date.now);
	const pending = item.status === "pending";
	useEffect(() => {
		if (!pending || !item.expiresAt) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [pending, item.expiresAt]);
	const expired = !!item.expiresAt && now >= item.expiresAt;
	const disabled = !pending || busy || expired;
	async function send(reply: InteractionReply) {
		if (disabled || guard.current) return;
		guard.current = true;
		setBusy(true);
		setError("");
		try {
			await respond(reply);
		} catch (error) {
			setError(error instanceof Error ? error.message : "응답을 전달하지 못했습니다.");
		} finally {
			guard.current = false;
			setBusy(false);
		}
	}
	const labels = {
		pending: expired ? "시간 만료" : "답변 대기",
		sending: "전달 중",
		answered: "응답 전달됨",
		cancelled: "요청 취소됨",
		expired: "시간 만료",
		closed: "요청 종료됨",
	};
	return (
		<section className={`interaction-card ${item.status}`} aria-label={item.title}>
			<div className="interaction-meta">
				<span>{labels[item.status]}</span>
				{pending && item.expiresAt && <small>{Math.max(0, Math.ceil((item.expiresAt - now) / 1000))}초 남음</small>}
			</div>
			<h3>{item.title}</h3>
			{item.message && <p>{item.message}</p>}
			{pending || item.status === "sending" ? (
				<>
					{item.method === "select" && (
						<div className="interaction-options">
							{item.options.map((option, index) => (
								<button
									type="button"
									// biome-ignore lint/suspicious/noArrayIndexKey: Option positions are immutable protocol identities within this request.
									key={`${item.id}-option-${index}`}
									disabled={disabled}
									onClick={() => void send({ id: item.id, action: "choose", option: index })}
								>
									{option}
								</button>
							))}
						</div>
					)}
					{item.method === "confirm" && (
						<div className="interaction-actions">
							<button
								type="button"
								disabled={disabled}
								onClick={() => void send({ id: item.id, action: "confirm", confirmed: false })}
							>
								거절
							</button>
							<button
								type="button"
								className="primary"
								disabled={disabled}
								onClick={() => void send({ id: item.id, action: "confirm", confirmed: true })}
							>
								승인
							</button>
						</div>
					)}
					{(item.method === "input" || item.method === "editor") && (
						<form
							onSubmit={(event) => {
								event.preventDefault();
								void send({ id: item.id, action: "submit", text });
							}}
						>
							<label htmlFor={inputId}>{item.method === "editor" ? "내용 편집" : "답변 입력"}</label>
							<textarea
								id={inputId}
								rows={item.method === "editor" ? 6 : 2}
								value={text}
								maxLength={100_000}
								placeholder={item.placeholder}
								disabled={disabled}
								onChange={(event) => setText(event.target.value)}
							/>
							<button type="submit" className="primary" disabled={disabled}>
								답변 보내기
							</button>
						</form>
					)}
					<button
						type="button"
						className="interaction-cancel"
						disabled={disabled}
						onClick={() => void send({ id: item.id, action: "cancel" })}
					>
						요청 취소
					</button>
				</>
			) : (
				item.answer && <p className="interaction-answer">{item.answer}</p>
			)}
			{error && (
				<p className="message-error" role="alert">
					{error}
				</p>
			)}
		</section>
	);
}
export function AgentNotices({ snapshot, insert }: { snapshot: DesktopSnapshot; insert: (text: string) => void }) {
	return (
		<div className="agent-notices">
			{snapshot.notices.map((notice) => (
				<div key={notice.id} className={notice.isError ? "agent-notice error" : "agent-notice"}>
					<small>
						{notice.kind === "draft"
							? "에이전트가 제안한 입력"
							: notice.kind === "status"
								? "작업 상태"
								: notice.kind === "title"
									? "작업 제목"
									: "에이전트 알림"}
					</small>
					<p>{notice.text}</p>
					{notice.kind === "draft" && (
						<button type="button" onClick={() => insert(notice.text)}>
							입력창에 추가
						</button>
					)}
				</div>
			))}
		</div>
	);
}
export function flowLabel(snapshot: DesktopSnapshot): string {
	if (snapshot.interactions.some((item) => item.status === "pending" || item.status === "sending"))
		return "사용자 답변 대기 중";
	if (snapshot.connection === "error") return "연결이 끊겼습니다. 다시 연결해 주세요.";
	if (snapshot.runStatus === "stopping") return "작업을 중단하고 있습니다";
	if (snapshot.state?.isCompacting) return "대화를 압축하고 있습니다";
	if (snapshot.runStatus === "retrying") return "일시적 오류로 재시도 중";
	if (snapshot.state?.isStreaming) return "Prime Agent 실행 중";
	return {
		idle: "",
		running: "요청 처리 중",
		completed: "작업 완료",
		stopped: "작업 중단됨",
		error: "작업 오류 · 내용을 확인해 주세요",
		stopping: "작업을 중단하고 있습니다",
		retrying: "재시도 중",
	}[snapshot.runStatus];
}
