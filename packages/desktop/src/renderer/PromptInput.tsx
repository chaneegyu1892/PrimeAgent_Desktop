import { useCallback, useLayoutEffect, useRef } from "react";
import { matchesShortcut, SEND_SHORTCUTS, type SendShortcut } from "./editor-keybindings";

interface Props {
	id?: string;
	label?: string;
	helpId?: string;
	value: string;
	onChange: (value: string) => void;
	canSend: boolean;
	disabled: boolean;
	sendShortcut: SendShortcut;
}
export function PromptInput({
	value,
	onChange,
	canSend,
	disabled,
	sendShortcut,
	id = "prompt",
	label = "메시지 입력",
	helpId = "composer-help",
}: Props) {
	const input = useRef<HTMLTextAreaElement>(null);
	const composing = useRef(false);
	const resize = useCallback(() => {
		const element = input.current;
		if (!element) return;
		const style = getComputedStyle(element);
		const line = Number.parseFloat(style.lineHeight) || 24;
		const padding = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
		element.style.height = "0px";
		const rows = Math.max(1, Math.ceil((element.scrollHeight - padding) / line));
		element.style.height = `${Math.min(rows, 8) * line + padding}px`;
		element.style.overflowY = rows > 8 ? "auto" : "hidden";
	}, []);
	useLayoutEffect(() => {
		// Reading value here ties the measurement to the committed controlled text.
		if (input.current?.value === value) resize();
	}, [value, resize]);
	useLayoutEffect(() => {
		if (!input.current || typeof ResizeObserver === "undefined") return;
		let width = input.current.getBoundingClientRect().width;
		const observer = new ResizeObserver(([entry]) => {
			if (entry && entry.contentRect.width !== width) {
				width = entry.contentRect.width;
				resize();
			}
		});
		observer.observe(input.current);
		return () => observer.disconnect();
	}, [resize]);
	return (
		<>
			<label className="sr-only" htmlFor={id}>
				{label}
			</label>
			<textarea
				ref={input}
				id={id}
				className="prompt-input"
				value={value}
				rows={1}
				onChange={(event) => onChange(event.target.value)}
				onCompositionStart={() => {
					composing.current = true;
				}}
				onCompositionEnd={() => {
					composing.current = false;
				}}
				onKeyDown={(event) => {
					if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
					if (!matchesShortcut(event, SEND_SHORTCUTS[sendShortcut])) return;
					event.preventDefault();
					if (canSend && !event.repeat) event.currentTarget.form?.requestSubmit();
				}}
				maxLength={100_000}
				placeholder="작업을 요청하거나 질문하세요"
				aria-describedby={helpId}
				disabled={disabled}
			/>
		</>
	);
}
