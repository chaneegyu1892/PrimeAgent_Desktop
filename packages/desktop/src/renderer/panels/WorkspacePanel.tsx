import { useEffect, useState } from "react";
import type { DesktopAPI } from "../../shared/desktop-api";
import type { DesktopSnapshot } from "../../shared/dto";
import { readAppShortcuts } from "../app-shortcuts";
import { Icon } from "../Icon";
import { BrowserPane } from "./BrowserPane";
import { FilesPane } from "./FilesPane";
import {
	DEFAULT_PANEL_KEYBINDINGS,
	type Pane,
	parsePanelShortcut,
	savePanelShortcuts,
	shortcutLabel,
} from "./panel-shortcuts";
import { ReviewPane } from "./ReviewPane";
import { SideChatPane } from "./SideChatPane";
import { TasksPane } from "./TasksPane";
import { TerminalPane } from "./TerminalPane";

import "./panels.css";

export const PANE_LABELS: Record<Pane, string> = {
	review: "검토",
	terminal: "터미널",
	browser: "브라우저",
	files: "파일",
	chat: "사이드 채팅",
	tasks: "에이전트 작업",
};
const icons = {
	review: "review",
	terminal: "terminal",
	browser: "browser",
	files: "folder",
	chat: "chat",
	tasks: "activity",
} as const;
export function WorkspacePanel({
	api,
	snapshot,
	pane,
	setPane,
	open,
	close,
	dock,
	setDock,
	expanded,
	setExpanded,
	shortcuts,
	setShortcuts,
	insert,
}: {
	api?: DesktopAPI;
	snapshot: DesktopSnapshot;
	pane: Pane | null;
	setPane: (pane: Pane | null) => void;
	open: boolean;
	close: () => void;
	dock: "right" | "bottom";
	setDock: (dock: "right" | "bottom") => void;
	expanded: boolean;
	setExpanded: (expanded: boolean) => void;
	shortcuts: Record<Pane, string>;
	setShortcuts: (shortcuts: Record<Pane, string>) => void;
	insert: (text: string) => void;
}) {
	const [visited, setVisited] = useState<Set<string>>(new Set());
	const [settings, setSettings] = useState(false);
	const [draft, setDraft] = useState(shortcuts);
	const [error, setError] = useState("");
	const projectPath = snapshot.project?.path;
	useEffect(() => {
		if (open && pane) setVisited((previous) => new Set([...previous, `${projectPath}:${pane}`]));
	}, [open, pane, projectPath]);
	return (
		<aside className={`workspace-panel dock-${dock}`} id="workspace-panel" hidden={!open} aria-label="작업 패널">
			<header className="panel-header">
				<button
					type="button"
					className="panel-home-button"
					onClick={() => {
						setPane(null);
						setSettings(false);
					}}
				>
					작업 패널{pane && <span> / {PANE_LABELS[pane]}</span>}
				</button>
				<div>
					<button
						type="button"
						className="icon-button"
						aria-label={expanded ? "패널 크기 복원" : "패널 확대"}
						onClick={() => setExpanded(!expanded)}
					>
						<Icon name="expand" />
					</button>
					<button
						type="button"
						className="icon-button"
						aria-label={dock === "right" ? "패널을 아래로 이동" : "패널을 오른쪽으로 이동"}
						onClick={() => setDock(dock === "right" ? "bottom" : "right")}
					>
						<Icon name={dock === "right" ? "bottom" : "panelRight"} />
					</button>
					<button type="button" className="icon-button" aria-label="작업 패널 닫기" onClick={close}>
						<Icon name="panelRight" />
					</button>
				</div>
			</header>
			{pane && (
				<nav className="panel-tabs" aria-label="패널 도구">
					{(Object.keys(PANE_LABELS) as Pane[]).map((name) => (
						<button
							type="button"
							key={name}
							aria-label={PANE_LABELS[name]}
							aria-pressed={pane === name}
							title={`${PANE_LABELS[name]} · ${shortcutLabel(shortcuts[name])}`}
							onClick={() => setPane(name)}
						>
							<Icon name={icons[name]} />
							<span>{PANE_LABELS[name]}</span>
						</button>
					))}
				</nav>
			)}
			{!pane && (
				<div className="panel-launcher">
					{(Object.keys(PANE_LABELS) as Pane[]).map((name) => (
						<button
							type="button"
							className="panel-launch"
							key={name}
							onClick={() => {
								setPane(name);
								setSettings(false);
							}}
						>
							<Icon name={icons[name]} />
							<span>{PANE_LABELS[name]}</span>
							<kbd>{shortcutLabel(shortcuts[name])}</kbd>
						</button>
					))}
					<button
						type="button"
						className="shortcut-settings"
						onClick={() => {
							setDraft(shortcuts);
							setSettings(!settings);
						}}
					>
						단축키 설정
					</button>
					{settings && (
						<form
							className="panel-shortcut-settings"
							onSubmit={(e) => {
								e.preventDefault();
								if (
									Object.values(draft).some((value) => !parsePanelShortcut(value)) ||
									Object.values(draft).some((value) =>
										Object.values(readAppShortcuts()).some(
											(reserved) =>
												JSON.stringify(parsePanelShortcut(value)) ===
												JSON.stringify(parsePanelShortcut(reserved)),
										),
									) ||
									new Set(Object.values(draft).map((value) => JSON.stringify(parsePanelShortcut(value))))
										.size < Object.keys(PANE_LABELS).length
								) {
									setError("겹치지 않는 단축키를 입력하세요. 예: Meta+T");
									return;
								}
								setShortcuts(draft);
								savePanelShortcuts(draft);
								setError("");
								setSettings(false);
							}}
						>
							<p>Meta = ⌘ · Ctrl = ⌃ · Alt = ⌥</p>
							{(Object.keys(PANE_LABELS) as Pane[]).map((name) => (
								<label key={name}>
									{PANE_LABELS[name]}
									<input
										aria-label={`${PANE_LABELS[name]} 단축키`}
										value={draft[name]}
										onChange={(e) => setDraft({ ...draft, [name]: e.target.value })}
									/>
								</label>
							))}
							{error && <p role="alert">{error}</p>}
							<button type="button" onClick={() => setDraft({ ...DEFAULT_PANEL_KEYBINDINGS })}>
								기본값
							</button>
							<button type="submit">저장</button>
						</form>
					)}
				</div>
			)}
			<div className="panel-content" hidden={!pane} key={projectPath ?? "no-project"}>
				{!projectPath && pane !== "browser" && pane !== "tasks" && (
					<p className="pane-empty">왼쪽에서 프로젝트 폴더를 열어주세요.</p>
				)}
				{visited.has(`${projectPath}:tasks`) && (
					<div className="pane-host" hidden={pane !== "tasks"}>
						<TasksPane api={api} projectPath={projectPath} insert={insert} />
					</div>
				)}
				{visited.has(`${projectPath}:review`) && projectPath && (
					<div className="pane-host" hidden={pane !== "review"}>
						<ReviewPane api={api} projectPath={projectPath} insert={insert} />
					</div>
				)}
				{visited.has(`${projectPath}:files`) && projectPath && (
					<div className="pane-host" hidden={pane !== "files"}>
						<FilesPane api={api} projectPath={projectPath} insert={insert} />
					</div>
				)}
				{visited.has(`${projectPath}:terminal`) && projectPath && (
					<div className="pane-host" hidden={pane !== "terminal"}>
						<TerminalPane api={api} projectPath={projectPath} />
					</div>
				)}
				{visited.has(`${projectPath}:browser`) && (
					<div className="pane-host" hidden={pane !== "browser"}>
						<BrowserPane api={api} insert={insert} />
					</div>
				)}
				{visited.has(`${projectPath}:chat`) && projectPath && (
					<div className="pane-host" hidden={pane !== "chat"}>
						<SideChatPane
							api={api}
							projectPath={projectPath}
							context={snapshot.messages
								.slice(-8)
								.map((message) => `${message.role}: ${message.content}`)
								.join("\n\n")
								.slice(-12_000)}
						/>
					</div>
				)}
			</div>
		</aside>
	);
}
