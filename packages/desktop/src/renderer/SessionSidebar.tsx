import { useState } from "react";
import type { DesktopSnapshot, SavedSession } from "../shared/dto";
import { Icon } from "./Icon";

function relativeTime(value: string): string {
	const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
	if (!Number.isFinite(minutes)) return "";
	if (minutes < 1) return "지금";
	if (minutes < 60) return `${minutes}분`;
	if (minutes < 1440) return `${Math.floor(minutes / 60)}시간`;
	if (minutes < 10080) return `${Math.floor(minutes / 1440)}일`;
	return new Date(value).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}
export function SessionSidebar({
	snapshot,
	sessions,
	disabled,
	loading,
	error,
	onOpen,
	onProject,
	onCreate,
	onRemove,
	onRefresh,
	filter = "",
}: {
	snapshot: DesktopSnapshot;
	sessions: SavedSession[];
	disabled: boolean;
	loading: boolean;
	error: string | null;
	onOpen: (session: SavedSession) => void;
	onProject: (path: string) => void;
	onCreate: (path: string) => void;
	onRemove: (path: string) => void;
	onRefresh: () => void;
	filter?: string;
}) {
	const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
	const [allRecent, setAllRecent] = useState(false);
	const active = (session: SavedSession) =>
		session.projectPath === snapshot.project?.path && session.id === snapshot.state?.sessionId;
	const entries = [...sessions];
	if (snapshot.project && snapshot.state && !entries.some(active)) {
		entries.unshift({
			id: snapshot.state.sessionId,
			path: snapshot.state.sessionFile ?? "",
			projectPath: snapshot.project.path,
			title:
				snapshot.state.sessionName ||
				snapshot.messages.find((message) => message.role === "user")?.content.slice(0, 120) ||
				"새 세션",
			modified: new Date(snapshot.messages.at(-1)?.timestamp ?? Date.now()).toISOString(),
		});
	}
	const query = filter.trim().toLocaleLowerCase();
	const visible = entries.filter(
		(item) =>
			!query ||
			`${item.title} ${snapshot.recent.find((project) => project.path === item.projectPath)?.name ?? "일반 대화"}`
				.toLocaleLowerCase()
				.includes(query),
	);
	const recent = [...visible].sort((a, b) => b.modified.localeCompare(a.modified));
	const row = (session: SavedSession, showProject = false) => (
		<button
			type="button"
			key={session.path || `${session.projectPath}:${session.id}`}
			className={`session-link ${active(session) ? "selected" : ""}`}
			aria-current={active(session) ? "page" : undefined}
			disabled={disabled || (!session.path && (!active(session) || snapshot.connection !== "connected"))}
			title={`${session.title}\n${session.projectPath}\n${new Date(session.modified).toLocaleString("ko-KR")}`}
			onClick={() => {
				if (!active(session) || snapshot.connection !== "connected") onOpen(session);
			}}
		>
			<Icon name={active(session) && snapshot.state?.isStreaming ? "activity" : "chat"} />
			<span className="session-label">
				<span>{session.title}</span>
				{showProject && (
					<small>
						{snapshot.recent.find((project) => project.path === session.projectPath)?.name ?? "일반 대화"}
					</small>
				)}
			</span>
			<time dateTime={session.modified}>{relativeTime(session.modified)}</time>
		</button>
	);
	return (
		<div className="sidebar-scroll">
			<section aria-labelledby="project-section-title" hidden={!!query}>
				<div className="section-heading">
					<h2 id="project-section-title">프로젝트</h2>
					<button
						type="button"
						className="icon-button"
						aria-label="세션 목록 새로고침"
						disabled={loading}
						onClick={onRefresh}
					>
						<Icon name="refresh" />
					</button>
				</div>
				{snapshot.recent.length === 0 && <p className="sidebar-empty">폴더를 열어 프로젝트를 추가하세요.</p>}
				<nav aria-label="프로젝트별 세션">
					{snapshot.recent.map((project) => {
						const items = entries.filter((session) => session.projectPath === project.path);
						const expanded = !collapsed[project.path];
						return (
							<div className="project-group" key={project.path}>
								<div className="folder-row">
									<button
										type="button"
										className={`folder-toggle ${expanded ? "expanded" : ""}`}
										aria-label={`${project.name} 세션 ${expanded ? "접기" : "펼치기"}`}
										aria-expanded={expanded}
										onClick={() => setCollapsed((current) => ({ ...current, [project.path]: expanded }))}
									>
										<Icon name="chevron" />
									</button>
									<button
										type="button"
										className="folder-name"
										title={project.path}
										disabled={disabled}
										onClick={() => onProject(project.path)}
									>
										<Icon name="folder" />
										<span>{project.name}</span>
									</button>
									<div className="folder-actions">
										<button
											type="button"
											className="icon-button"
											aria-label={`${project.name} 새 세션`}
											title="새 세션"
											disabled={disabled || !snapshot.cliPath}
											onClick={() => {
												setCollapsed((current) => ({ ...current, [project.path]: false }));
												onCreate(project.path);
											}}
										>
											<Icon name="plus" />
										</button>
										<button
											type="button"
											className="icon-button"
											aria-label={`${project.name} 최근 목록에서 제거`}
											title="프로젝트 목록에서 제거 (파일은 유지)"
											disabled={disabled}
											onClick={() => onRemove(project.path)}
										>
											<Icon name="close" />
										</button>
									</div>
								</div>
								{expanded && (
									<div className="folder-sessions">
										{items.length ? (
											items.map((item) => row(item))
										) : (
											<button
												type="button"
												className="empty-session"
												disabled={disabled || !snapshot.cliPath}
												onClick={() => onCreate(project.path)}
											>
												<Icon name="plus" />첫 세션 시작하기
											</button>
										)}
									</div>
								)}
							</div>
						);
					})}
				</nav>
			</section>
			<section aria-labelledby="recent-section-title" className="recent-sessions">
				<div className="section-heading">
					<h2 id="recent-section-title">{query ? `검색 결과 · ${recent.length}` : "최근"}</h2>
				</div>
				<nav aria-label="최근 세션">{(allRecent ? recent : recent.slice(0, 8)).map((item) => row(item, true))}</nav>
				{recent.length === 0 && (
					<p className="sidebar-empty">{query ? "일치하는 대화가 없습니다." : "최근 대화가 여기에 표시됩니다."}</p>
				)}
				{recent.length > 8 && (
					<button type="button" className="show-more" onClick={() => setAllRecent((value) => !value)}>
						{allRecent ? "간략히 보기" : `모두 보기 · ${recent.length}`}
					</button>
				)}
			</section>
			{error && (
				<p className="sidebar-error" role="status">
					{error}
				</p>
			)}
		</div>
	);
}
