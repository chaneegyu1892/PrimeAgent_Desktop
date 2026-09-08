export interface EditorShortcut {
	key: string;
	shiftKey?: boolean;
	metaKey?: boolean;
	ctrlKey?: boolean;
	altKey?: boolean;
}
export const DEFAULT_EDITOR_KEYBINDINGS = {
	send: [{ key: "Enter" }],
	newline: [{ key: "Enter", shiftKey: true }],
} satisfies Record<string, EditorShortcut[]>;
export type SendShortcut = "enter" | "modifierEnter";
export const SEND_SHORTCUTS: Record<SendShortcut, EditorShortcut[]> = {
	enter: DEFAULT_EDITOR_KEYBINDINGS.send,
	modifierEnter: [
		{ key: "Enter", metaKey: true },
		{ key: "Enter", ctrlKey: true },
	],
};
export function matchesShortcut(event: EditorShortcut, shortcuts: EditorShortcut[]): boolean {
	return shortcuts.some((shortcut) =>
		(["key", "shiftKey", "metaKey", "ctrlKey", "altKey"] as const).every((field) =>
			field === "key" ? event[field] === shortcut[field] : !!event[field] === !!shortcut[field],
		),
	);
}
const STORAGE_KEY = "prime-desktop:send-shortcut";
export function readSendShortcut(): SendShortcut {
	try {
		return localStorage.getItem(STORAGE_KEY) === "modifierEnter" ? "modifierEnter" : "enter";
	} catch {
		return "enter";
	}
}
export function saveSendShortcut(value: SendShortcut): void {
	try {
		localStorage.setItem(STORAGE_KEY, value);
	} catch {
		// The preference still applies to this window if storage is unavailable.
	}
}
