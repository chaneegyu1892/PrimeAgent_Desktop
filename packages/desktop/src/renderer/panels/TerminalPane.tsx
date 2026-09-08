import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import type { DesktopAPI } from "../../shared/desktop-api";
import type { TerminalState } from "../../shared/panel-contract";
import { Icon } from "../Icon";
import { panelError, panelRequest } from "./panel-api";
import "@xterm/xterm/css/xterm.css";

export function TerminalPane({ api, projectPath }: { api?: DesktopAPI; projectPath: string }) {
	const container = useRef<HTMLElement>(null);
	const [state, setState] = useState<TerminalState | null>(null);
	const [error, setError] = useState("");
	const [restart, setRestart] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Refresh generation reloads the external resource.
	useEffect(() => {
		if (!container.current || !api) return;
		const terminal = new Terminal({
			fontFamily: '"SFMono-Regular", Menlo, monospace',
			fontSize: 12,
			cursorBlink: true,
			scrollback: 3000,
			theme: { background: "#111111", foreground: "#e5e5df", cursor: "#b8ca96", selectionBackground: "#59634488" },
		});
		const fit = new FitAddon();
		terminal.loadAddon(fit);
		terminal.open(container.current);
		let active = true;
		let last: TerminalState | null = null;
		const apply = (next: TerminalState) => {
			if (!active || next.projectPath !== projectPath || (last?.id === next.id && last.offset > next.offset)) return;
			const delta = next.offset - (last?.offset ?? 0);
			if (!last || last.id !== next.id || delta > next.output.length) {
				terminal.reset();
				terminal.write(next.output);
			} else if (delta > 0) terminal.write(next.output.slice(-delta));
			last = next;
			setState(next);
		};
		const resize = () => {
			if (!container.current?.clientWidth || !container.current?.clientHeight) return;
			fit.fit();
			if (last?.running)
				void panelRequest(api, "panel.terminalResize", {
					id: last.id,
					cols: Math.max(2, Math.min(500, terminal.cols)),
					rows: Math.max(2, Math.min(500, terminal.rows)),
				}).catch(() => {});
		};
		const unsubscribe = api.subscribePanel((event) => {
			if (event.type === "terminal") apply(event.state);
		});
		const input = terminal.onData((data) => {
			if (last?.running)
				void panelRequest(api, "panel.terminalWrite", { id: last.id, data }).catch((e) => {
					if (active) setError(panelError(e));
				});
		});
		setError("");
		void panelRequest(api, "panel.terminalOpen", { projectPath })
			.then((value) => {
				apply(value);
				if (active) {
					resize();
					terminal.focus();
				}
			})
			.catch((e) => {
				if (active) setError(panelError(e));
			});
		const observer = new ResizeObserver(resize);
		observer.observe(container.current);
		return () => {
			active = false;
			unsubscribe();
			input.dispose();
			observer.disconnect();
			terminal.dispose();
		};
	}, [api, projectPath, restart]);
	return (
		<div className="terminal-pane">
			<div className="pane-toolbar">
				<Icon name="terminal" />
				<span>zsh · {state?.running ? "실행 중" : "종료됨"}</span>
				{state?.running ? (
					<button
						type="button"
						onClick={() =>
							void panelRequest(api, "panel.terminalClose", { id: state.id }).catch((e) =>
								setError(panelError(e)),
							)
						}
					>
						터미널 종료
					</button>
				) : (
					<button type="button" onClick={() => setRestart((v) => v + 1)}>
						새 터미널
					</button>
				)}
			</div>
			{error && (
				<p className="pane-error" role="alert">
					{error}
				</p>
			)}
			<section className="terminal-surface" ref={container} aria-label="프로젝트 터미널" />
		</div>
	);
}
