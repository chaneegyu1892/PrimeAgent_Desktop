import type { EditorShortcut } from "../editor-keybindings";
export type Pane = "review" | "terminal" | "browser" | "files" | "chat" | "tasks";
export const DEFAULT_PANEL_KEYBINDINGS: Record<Pane, string> = {
	review: "Ctrl+Shift+G",
	terminal: "Ctrl+`",
	browser: "Meta+T",
	files: "Meta+P",
	chat: "Alt+Meta+S",
	tasks: "Meta+Shift+J",
};
const key = "prime-desktop:panel-shortcuts";
export function parsePanelShortcut(value: string): EditorShortcut | null {
	const parts = value
		.toLowerCase()
		.split("+")
		.map((part) => part.trim());
	const key = parts.pop();
	if (
		!key ||
		key.length > 16 ||
		!parts.length ||
		parts.some((part) => !["meta", "ctrl", "shift", "alt"].includes(part))
	)
		return null;
	return {
		key,
		metaKey: parts.includes("meta"),
		ctrlKey: parts.includes("ctrl"),
		shiftKey: parts.includes("shift"),
		altKey: parts.includes("alt"),
	};
}
export function readPanelShortcuts(): Record<Pane, string> {
	try {
		const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
		return Object.fromEntries(
			Object.entries(DEFAULT_PANEL_KEYBINDINGS).map(([name, value]) => [
				name,
				typeof saved[name] === "string" && parsePanelShortcut(saved[name]) ? saved[name] : value,
			]),
		) as Record<Pane, string>;
	} catch {
		return { ...DEFAULT_PANEL_KEYBINDINGS };
	}
}
export function savePanelShortcuts(value: Record<Pane, string>): void {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		/* Window settings still apply. */
	}
}
export function shortcutLabel(value: string): string {
	return value
		.replace(/Meta/gi, "⌘")
		.replace(/Ctrl/gi, "⌃")
		.replace(/Shift/gi, "⇧")
		.replace(/Alt/gi, "⌥")
		.replaceAll("+", "");
}
