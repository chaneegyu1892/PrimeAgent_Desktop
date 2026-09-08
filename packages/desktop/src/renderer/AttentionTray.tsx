import { useEffect, useRef, useState } from "react";
import type { DesktopAPI } from "../shared/desktop-api";
import type { DesktopSnapshot } from "../shared/dto";
import { InteractionCards } from "./InteractionCards";
export function AttentionTray({
	api,
	main,
	openMain,
}: {
	api?: DesktopAPI;
	main: DesktopSnapshot;
	openMain: () => void;
}) {
	const [chats, setChats] = useState<Record<string, DesktopSnapshot>>({});
	const [selected, setSelected] = useState<string | null>(null);
	const dialog = useRef<HTMLDialogElement>(null);
	useEffect(
		() =>
			api?.subscribePanel((event) => {
				if (event.type === "chat") setChats((previous) => ({ ...previous, [event.projectPath]: event.snapshot }));
			}),
		[api],
	);
	useEffect(() => {
		if (selected && dialog.current && !dialog.current.open) dialog.current.showModal();
		if (!selected && dialog.current?.open) dialog.current.close();
	}, [selected]);
	const waiting = (snapshot: DesktopSnapshot) =>
		snapshot.interactions.filter((item) => item.status === "pending" || item.status === "sending").length;
	return (
		<>
			<nav className="attention-strip" aria-label="답변 대기 알림">
				{waiting(main) > 0 && (
					<button type="button" onClick={openMain}>
						본 대화 · 답변 대기 {waiting(main)}
					</button>
				)}
				{Object.entries(chats)
					.filter(([, snapshot]) => waiting(snapshot) > 0)
					.map(([path, snapshot]) => (
						<button type="button" key={path} onClick={() => setSelected(path)}>
							사이드 채팅 · {snapshot.project?.name} · 답변 대기 {waiting(snapshot)}
						</button>
					))}
			</nav>
			<dialog
				className="modal attention-dialog"
				ref={dialog}
				aria-label="사이드 채팅 답변"
				onCancel={() => setSelected(null)}
			>
				<header>
					<h2>{selected ? chats[selected]?.project?.name : ""} · 사이드 채팅</h2>
					<button type="button" onClick={() => setSelected(null)}>
						닫기
					</button>
				</header>
				{selected && chats[selected] && (
					<InteractionCards
						items={chats[selected].interactions}
						respond={async (reply) => {
							if (!api) throw new Error("앱 연결을 확인하세요.");
							const result = await api.request("panel.chatRespond", { projectPath: selected, reply });
							if (!result.ok) throw new Error(result.error);
						}}
					/>
				)}
			</dialog>
		</>
	);
}
