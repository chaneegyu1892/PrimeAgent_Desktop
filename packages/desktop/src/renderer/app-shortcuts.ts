import { parsePanelShortcut } from "./panels/panel-shortcuts";
export const DEFAULT_APP_KEYBINDINGS = { newChat: "Meta+N", search: "Meta+K" };
export type AppShortcuts = typeof DEFAULT_APP_KEYBINDINGS;
export const APP_SHORTCUT_LABELS: Record<keyof AppShortcuts, string> = { newChat: "새 대화", search: "대화 검색" };
const key = "prime-desktop:app-shortcuts";
export function readAppShortcuts(): AppShortcuts {
	try {
		const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
		return Object.fromEntries(
			Object.entries(DEFAULT_APP_KEYBINDINGS).map(([name, fallback]) => [
				name,
				typeof saved[name] === "string" && parsePanelShortcut(saved[name]) ? saved[name] : fallback,
			]),
		) as AppShortcuts;
	} catch {
		return { ...DEFAULT_APP_KEYBINDINGS };
	}
}
export function saveAppShortcuts(value: AppShortcuts): void {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		/* Applies for this window. */
	}
}
