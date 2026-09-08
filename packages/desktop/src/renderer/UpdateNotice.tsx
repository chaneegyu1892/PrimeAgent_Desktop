import { useEffect, useRef, useState } from "react";
import type { DesktopAPI } from "../shared/desktop-api";
import type { UpdateRequests, UpdateStatus } from "../shared/update-contract";
import { Icon } from "./Icon";
import "./updates.css";

export function UpdateNotice({ api }: { api?: DesktopAPI }) {
	const [status, setStatus] = useState<UpdateStatus | null>(null);
	const [open, setOpen] = useState(false);
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);
	const dialog = useRef<HTMLDialogElement>(null);
	const sequence = useRef(0);
	useEffect(() => {
		if (!api) return;
		let active = true;
		let timer: ReturnType<typeof setTimeout>;
		const poll = async () => {
			const id = ++sequence.current;
			try {
				const result = await api.request("update.status", undefined);
				if (active && id === sequence.current && result.ok && result.value?.phase) setStatus(result.value);
			} catch {
				/* Keep the last notification when IPC is temporarily unavailable. */
			}
			if (active) timer = setTimeout(() => void poll(), 2000);
		};
		void poll();
		return () => {
			active = false;
			clearTimeout(timer);
		};
	}, [api]);
	useEffect(() => {
		if (open && dialog.current && !dialog.current.open) dialog.current.showModal();
	}, [open]);
	async function action(name: keyof UpdateRequests) {
		if (!api || pending) return;
		setPending(true);
		setError("");
		const id = ++sequence.current;
		try {
			const result = await api.request(name, undefined);
			if (!result.ok) setError(result.error);
			else if (id === sequence.current) setStatus(result.value);
		} catch {
			setError("업데이트 요청을 처리하지 못했습니다. 다시 시도하세요.");
		} finally {
			setPending(false);
		}
	}
	const phase = status?.phase;
	const label =
		phase === "available"
			? "새 업데이트 사용 가능"
			: phase === "ready"
				? "업데이트 설치 준비됨"
				: phase === "downloading"
					? `다운로드 중 · ${Math.floor(status?.percent ?? 0)}%`
					: phase === "installing"
						? "업데이트 적용 중"
						: "앱 업데이트";
	return (
		<>
			<button
				type="button"
				className={`update-notice ${phase === "available" || phase === "ready" ? "has-update" : ""}`}
				onClick={() => setOpen(true)}
			>
				<Icon name="refresh" />
				<span>{label}</span>
				{(phase === "available" || phase === "ready") && <i aria-hidden="true" />}
			</button>
			{open && (
				<dialog
					ref={dialog}
					className="update-dialog"
					aria-labelledby="update-heading"
					onCancel={(event) => {
						if (phase === "installing") event.preventDefault();
						else setOpen(false);
					}}
				>
					<div className="update-heading">
						<div>
							<span className="eyebrow">PRIME DESKTOP</span>
							<h2 id="update-heading">앱 업데이트</h2>
						</div>
						<button
							type="button"
							className="icon-button"
							aria-label="업데이트 창 닫기"
							disabled={phase === "installing"}
							onClick={() => setOpen(false)}
						>
							<Icon name="close" />
						</button>
					</div>
					<p className="update-version">
						현재 버전 {status?.currentVersion ?? "확인 중"}
						{status?.version && (
							<>
								{" "}
								<span>→</span> {status.version}
							</>
						)}
					</p>
					<p>새 버전을 자동으로 확인합니다. 다운로드와 재시작은 직접 선택한 때에만 진행합니다.</p>
					{status?.setup && <p className="update-detail">{status.setup}</p>}
					{phase === "checking" && <p role="status">새 버전을 확인하고 있습니다…</p>}
					{phase === "idle" && status?.checkedAt && <p role="status">최신 버전입니다.</p>}
					{status?.notes && <pre className="update-notes">{status.notes}</pre>}
					{phase === "downloading" && (
						<div role="status">
							<progress aria-label="업데이트 다운로드" value={status?.percent ?? 0} max="100" />
							<p>{Math.floor(status?.percent ?? 0)}% · 작업을 계속하셔도 됩니다.</p>
						</div>
					)}
					{phase === "ready" && (
						<>
							<p>다운로드가 끝났습니다. 재시작하면 업데이트가 적용됩니다.</p>
							{status && status.blockers.length > 0 && (
								<ul className="update-blockers">
									{status.blockers.map((reason) => (
										<li key={reason}>{reason}</li>
									))}
								</ul>
							)}
						</>
					)}
					{phase === "installing" && <p role="status">서명을 확인하고 대화를 저장한 뒤 재시작합니다…</p>}
					{(error || status?.error) && (
						<p className="update-error" role="alert">
							{error || status?.error}
						</p>
					)}
					{status?.checkedAt && (
						<p className="update-checked">마지막 확인 · {new Date(status.checkedAt).toLocaleString("ko-KR")}</p>
					)}
					<div className="update-actions">
						<button type="button" disabled={phase === "installing"} onClick={() => setOpen(false)}>
							나중에
						</button>
						{phase === "available" ? (
							<button
								type="button"
								className="primary"
								disabled={pending || !!status?.setup}
								onClick={() => void action("update.download")}
							>
								업데이트 다운로드
							</button>
						) : phase === "ready" ? (
							<button
								type="button"
								className="primary"
								disabled={pending || !!status?.setup || !!status?.blockers.length}
								onClick={() => void action("update.install")}
							>
								재시작하여 설치
							</button>
						) : (
							<button
								type="button"
								className="primary"
								disabled={!api || pending || ["checking", "downloading", "installing"].includes(phase ?? "")}
								onClick={() => void action("update.check")}
							>
								업데이트 확인
							</button>
						)}
					</div>
				</dialog>
			)}
		</>
	);
}
