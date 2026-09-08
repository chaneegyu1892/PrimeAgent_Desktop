import { useEffect, useState } from "react";
import type { DesktopAPI } from "../../shared/desktop-api";
import type { FileEntry, FilePreview } from "../../shared/panel-contract";
import { Icon } from "../Icon";
import { panelError, panelRequest } from "./panel-api";

export function FilesPane({
	api,
	projectPath,
	insert,
}: {
	api?: DesktopAPI;
	projectPath: string;
	insert: (text: string) => void;
}) {
	const [path, setPath] = useState("");
	const [entries, setEntries] = useState<FileEntry[]>([]);
	const [preview, setPreview] = useState<FilePreview | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [error, setError] = useState("");
	const [filter, setFilter] = useState("");
	const [revision, setRevision] = useState(0);
	const [truncated, setTruncated] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Refresh generation reloads the external resource.
	useEffect(() => {
		let active = true;
		setError("");
		void panelRequest(api, "panel.files", { projectPath, path })
			.then((result) => {
				if (active) {
					setEntries(result.entries);
					setTruncated(result.truncated);
				}
			})
			.catch((e) => {
				if (active) setError(panelError(e));
			});
		return () => {
			active = false;
		};
	}, [api, projectPath, path, revision]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Refresh generation reloads the external resource.
	useEffect(() => {
		if (selected === null) return;
		let active = true;
		setError("");
		setPreview(null);
		void panelRequest(api, "panel.file", { projectPath, path: selected })
			.then((value) => {
				if (active) setPreview(value);
			})
			.catch((e) => {
				if (active) setError(panelError(e));
			});
		return () => {
			active = false;
		};
	}, [api, projectPath, selected, revision]);
	return (
		<div className="files-pane pane-scroll">
			<div className="pane-toolbar">
				<button
					type="button"
					className="icon-button"
					aria-label="상위 폴더"
					disabled={!path}
					onClick={() => {
						setPath(path.split("/").slice(0, -1).join("/"));
						setSelected(null);
						setPreview(null);
					}}
				>
					<Icon name="arrow" />
				</button>
				<span title={path}>{path || "프로젝트 파일"}</span>
				<button
					type="button"
					className="icon-button"
					aria-label="파일 새로고침"
					onClick={() => setRevision((v) => v + 1)}
				>
					<Icon name="refresh" />
				</button>
			</div>
			<input
				className="pane-search"
				aria-label="파일 이름 필터"
				placeholder="이 폴더에서 파일 찾기"
				value={filter}
				onChange={(e) => setFilter(e.target.value)}
			/>
			{error && (
				<p role="alert" className="pane-error">
					{error}
				</p>
			)}
			<div className={`file-browser ${preview ? "has-preview" : ""}`}>
				<nav aria-label="파일 목록">
					{entries
						.filter((entry) => entry.name.toLowerCase().includes(filter.toLowerCase()))
						.map((entry) => (
							<button
								type="button"
								className={`file-entry ${selected === entry.path ? "selected" : ""}`}
								key={entry.path}
								title={entry.path}
								onClick={() => {
									if (entry.directory) {
										setPath(entry.path);
										setFilter("");
										setSelected(null);
										setPreview(null);
									} else setSelected(entry.path);
								}}
							>
								<Icon name={entry.directory ? "folder" : "file"} />
								<span>{entry.name}</span>
								{entry.symlink && <small>링크</small>}
							</button>
						))}
				</nav>
				{truncated && <p className="muted small">처음 500개 항목을 표시합니다.</p>}
			</div>
			{preview && (
				<section className="file-preview" aria-label="파일 미리보기">
					<div className="pane-toolbar">
						<span title={preview.path}>{preview.path}</span>
						<button
							type="button"
							onClick={() => insert(`파일 참고: ${JSON.stringify(`${projectPath}/${preview.path}`)}`)}
						>
							대화에 넣기
						</button>
					</div>
					{preview.kind === "text" ? (
						<pre>{preview.content}</pre>
					) : preview.kind === "image" ? (
						<img src={preview.content} alt={preview.path} />
					) : (
						<p className="pane-empty">이 파일 형식은 미리보기를 지원하지 않습니다.</p>
					)}
					{preview.truncated && <p className="muted small">파일이 커서 일부만 표시합니다.</p>}
				</section>
			)}
		</div>
	);
}
