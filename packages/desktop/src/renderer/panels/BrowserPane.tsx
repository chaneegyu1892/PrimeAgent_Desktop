import { useEffect, useState } from "react";
import type { DesktopAPI } from "../../shared/desktop-api";
import type { BrowserTab } from "../../shared/panel-contract";
import { Icon } from "../Icon";
import { panelError, panelRequest } from "./panel-api";

export function BrowserPane({ api, insert }: { api?: DesktopAPI; insert: (text: string) => void }) {
	const [tabs, setTabs] = useState<BrowserTab[]>([]);
	const [url, setUrl] = useState("");
	const [revision, setRevision] = useState(0);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [page, setPage] = useState<{ tab: BrowserTab; text: string } | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Refresh generation reloads the external resource.
	useEffect(() => {
		let active = true;
		setLoading(true);
		setError("");
		void panelRequest(api, "panel.browserTabs", undefined)
			.then((value) => {
				if (active) setTabs(value);
			})
			.catch((e) => {
				if (active) setError(panelError(e));
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [api, revision]);
	async function run(work: () => Promise<void>) {
		setLoading(true);
		setError("");
		try {
			await work();
		} catch (e) {
			setError(panelError(e));
		} finally {
			setLoading(false);
		}
	}
	return (
		<div className="browser-pane pane-scroll">
			<div className="pane-toolbar">
				<Icon name="browser" />
				<strong>Aside</strong>
				<span className="browser-mode">외부 브라우저 연결</span>
				<button
					type="button"
					className="icon-button"
					aria-label="Aside 탭 새로고침"
					disabled={loading}
					onClick={() => setRevision((v) => v + 1)}
				>
					<Icon name="refresh" />
				</button>
			</div>
			<form
				className="browser-address"
				onSubmit={(e) => {
					e.preventDefault();
					void run(async () => {
						await panelRequest(api, "panel.browserOpen", { url });
						setRevision((v) => v + 1);
					});
				}}
			>
				<input
					aria-label="웹 주소"
					type="url"
					required
					placeholder="https:// 또는 http://localhost:3000"
					value={url}
					onChange={(e) => setUrl(e.target.value)}
				/>
				<button type="submit" disabled={loading || !url}>
					열기
				</button>
			</form>
			{error && (
				<p className="pane-error" role="alert">
					{error}
				</p>
			)}
			{loading && (
				<p className="pane-loading" role="status">
					Aside에 연결 중…
				</p>
			)}
			<p className="pane-caption">주소는 Aside 창에서 열립니다. 열린 탭의 내용을 읽어 대화에 참고할 수 있습니다.</p>
			<div className="browser-tabs">
				{tabs.map((tab) => (
					<button
						type="button"
						className={`browser-tab ${page?.tab.id === tab.id ? "selected" : ""}`}
						key={tab.id}
						title={tab.url}
						disabled={loading}
						onClick={() =>
							void run(async () => {
								const text = await panelRequest(api, "panel.browserRead", { id: tab.id });
								setPage({ tab, text });
							})
						}
					>
						<Icon name="browser" />
						<span>
							<strong>{tab.title || "제목 없는 탭"}</strong>
							<small>{tab.url}</small>
						</span>
						{tab.active && <i />}
					</button>
				))}
			</div>
			{page && (
				<section className="browser-preview" aria-label="페이지 내용">
					<div className="pane-toolbar">
						<span>{page.tab.title}</span>
						<button
							type="button"
							onClick={() =>
								insert(`Aside 페이지 참고: ${page.tab.title}\n${page.tab.url}\n\n${page.text.slice(0, 24_000)}`)
							}
						>
							대화에 넣기
						</button>
					</div>
					<pre>{page.text}</pre>
				</section>
			)}
		</div>
	);
}
