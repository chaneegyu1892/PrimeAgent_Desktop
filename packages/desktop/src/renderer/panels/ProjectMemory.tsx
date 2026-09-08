import { useRef, useState } from "react";
import type { DesktopAPI } from "../../shared/desktop-api";
import type { ProjectMemoryEntry } from "../../shared/harness-contract";
import { panelError, panelRequest } from "./panel-api";

export function ProjectMemory({ api, projectPath }: { api?: DesktopAPI; projectPath: string }) {
	const [entries, setEntries] = useState<ProjectMemoryEntry[]>([]);
	const [open, setOpen] = useState(false);
	const [key, setKey] = useState("");
	const [content, setContent] = useState("");
	const [source, setSource] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const guard = useRef(false);
	async function action(work: () => Promise<ProjectMemoryEntry[]>) {
		if (guard.current) return;
		guard.current = true;
		setBusy(true);
		setError("");
		try {
			setEntries(await work());
		} catch (error) {
			setError(panelError(error));
		} finally {
			setBusy(false);
			guard.current = false;
		}
	}
	return (
		<section className="project-memory">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => {
					setOpen(!open);
					if (!open) void action(() => panelRequest(api, "harness.memoryList", { projectPath, query: "" }));
				}}
			>
				프로젝트 기억
			</button>
			{open && (
				<>
					<p className="tasks-hint">
						프로젝트의 결정과 규칙을 근거와 함께 보관합니다. 자동 학습이나 비밀 값 저장소가 아닙니다.
					</p>
					{error && (
						<p role="alert" className="message-error">
							{error}
						</p>
					)}
					{entries.map((entry) => (
						<details key={entry.key}>
							<summary>{entry.key}</summary>
							<p>{entry.content}</p>
							<small>근거: {entry.source}</small>
							<div className="tasks-toolbar">
								<button
									type="button"
									onClick={() => {
										setKey(entry.key);
										setContent(entry.content);
										setSource(entry.source);
									}}
								>
									편집
								</button>
								<button
									type="button"
									disabled={busy}
									onClick={() =>
										void action(() =>
											panelRequest(api, "harness.memoryForget", { projectPath, key: entry.key }),
										)
									}
								>
									잊기
								</button>
							</div>
						</details>
					))}
					<form
						className="tasks-form"
						onSubmit={(event) => {
							event.preventDefault();
							void action(async () => {
								const next = await panelRequest(api, "harness.memorySave", {
									projectPath,
									key,
									content,
									source,
								});
								setKey("");
								setContent("");
								setSource("");
								return next;
							});
						}}
					>
						<label>
							기억 제목
							<input value={key} maxLength={120} required onChange={(event) => setKey(event.target.value)} />
						</label>
						<label>
							기억 내용
							<textarea
								rows={3}
								value={content}
								maxLength={8000}
								required
								onChange={(event) => setContent(event.target.value)}
							/>
						</label>
						<label>
							근거·출처
							<input
								value={source}
								maxLength={1000}
								required
								onChange={(event) => setSource(event.target.value)}
							/>
						</label>
						<button type="submit" disabled={busy}>
							기억 저장
						</button>
					</form>
				</>
			)}
		</section>
	);
}
