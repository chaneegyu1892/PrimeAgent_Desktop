import { useEffect, useState } from "react";
import type { DesktopAPI } from "../../shared/desktop-api";
import type { GitReview } from "../../shared/panel-contract";
import { Icon } from "../Icon";
import { keyed } from "../keyed";
import { panelError, panelRequest } from "./panel-api";

export function ReviewPane({
	api,
	projectPath,
	insert,
}: {
	api?: DesktopAPI;
	projectPath: string;
	insert: (text: string) => void;
}) {
	const [review, setReview] = useState<GitReview | null>(null);
	const [path, setPath] = useState("");
	const [staged, setStaged] = useState(false);
	const [diff, setDiff] = useState("");
	const [error, setError] = useState("");
	const [revision, setRevision] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Refresh generation reloads the external resource.
	useEffect(() => {
		let active = true;
		setError("");
		void panelRequest(api, "panel.review", { projectPath })
			.then((value) => {
				if (active) {
					setReview(value);
					setPath((current) =>
						value.changes.some((entry) => entry.path === current) ? current : (value.changes[0]?.path ?? ""),
					);
				}
			})
			.catch((e) => {
				if (active) setError(panelError(e));
			});
		return () => {
			active = false;
		};
	}, [api, projectPath, revision]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Refresh generation reloads the external resource.
	useEffect(() => {
		let active = true;
		setDiff("");
		if (path)
			void panelRequest(api, "panel.diff", { projectPath, path, staged })
				.then((value) => {
					if (active) setDiff(value);
				})
				.catch((e) => {
					if (active) setError(panelError(e));
				});
		return () => {
			active = false;
		};
	}, [api, projectPath, path, staged, revision]);
	return (
		<div className="review-pane pane-scroll">
			<div className="pane-toolbar">
				<Icon name="review" />
				<span>{review?.branch || "변경 검토"}</span>
				<button
					type="button"
					className="icon-button"
					aria-label="변경 새로고침"
					onClick={() => setRevision((v) => v + 1)}
				>
					<Icon name="refresh" />
				</button>
			</div>
			{error && (
				<p className="pane-error" role="alert">
					{error}
				</p>
			)}
			{review && !review.isRepository ? (
				<p className="pane-empty">이 프로젝트는 Git 저장소가 아닙니다.</p>
			) : review?.changes.length === 0 ? (
				<p className="pane-empty">변경된 파일이 없습니다.</p>
			) : (
				<>
					<div className="review-files">
						{review?.changes.map((change) => (
							<button
								type="button"
								key={change.path}
								className={`file-entry ${path === change.path ? "selected" : ""}`}
								onClick={() => setPath(change.path)}
							>
								<code>{change.status.trim()}</code>
								<span>{change.path}</span>
							</button>
						))}
					</div>
					<div className="pane-toolbar">
						<label>
							<input type="checkbox" checked={staged} onChange={(e) => setStaged(e.target.checked)} /> 스테이징된
							변경
						</label>
						<button
							type="button"
							disabled={!path}
							onClick={() =>
								insert(
									`이 파일의 변경 사항을 검토해줘: ${JSON.stringify(`${projectPath}/${path}`)}${staged ? " (스테이징된 변경)" : ""}`,
								)
							}
						>
							검토 요청 작성
						</button>
					</div>
					<pre className="diff-preview">
						{keyed(diff.split("\n"), (line) => line).map(({ item: line, key }) => (
							<span
								key={key}
								className={
									line.startsWith("+")
										? "diff-add"
										: line.startsWith("-")
											? "diff-remove"
											: line.startsWith("@@")
												? "diff-hunk"
												: ""
								}
							>
								{line}
								{"\n"}
							</span>
						))}
					</pre>
				</>
			)}
		</div>
	);
}
