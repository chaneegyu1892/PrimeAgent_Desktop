import type { DesktopSnapshot } from "./dto";
import { type InteractionReply, validateInteractionReply } from "./interactions";

export interface FileEntry {
	path: string;
	name: string;
	directory: boolean;
	symlink: boolean;
}
export interface FilePreview {
	path: string;
	kind: "text" | "image" | "binary";
	content: string;
	size: number;
	truncated: boolean;
}
export interface GitChange {
	path: string;
	status: string;
	originalPath?: string;
}
export interface GitReview {
	branch: string;
	changes: GitChange[];
	isRepository: boolean;
}
export interface BrowserTab {
	id: string;
	title: string;
	url: string;
	active: boolean;
}
export interface TerminalState {
	id: string;
	projectPath: string;
	output: string;
	offset: number;
	running: boolean;
}
export type PanelEvent =
	| { type: "terminal"; state: TerminalState }
	| { type: "chat"; projectPath: string; snapshot: DesktopSnapshot };
export const PANEL_CHANNEL = "prime-desktop:panel";
export interface PanelRequests {
	"panel.files": {
		input: { projectPath: string; path: string };
		output: { entries: FileEntry[]; truncated: boolean };
	};
	"panel.file": { input: { projectPath: string; path: string }; output: FilePreview };
	"panel.review": { input: { projectPath: string }; output: GitReview };
	"panel.diff": { input: { projectPath: string; path: string; staged: boolean }; output: string };
	"panel.terminalOpen": { input: { projectPath: string }; output: TerminalState };
	"panel.terminalWrite": { input: { id: string; data: string }; output: undefined };
	"panel.terminalResize": { input: { id: string; cols: number; rows: number }; output: undefined };
	"panel.terminalClose": { input: { id: string }; output: undefined };
	"panel.browserTabs": { input: undefined; output: BrowserTab[] };
	"panel.browserOpen": { input: { url: string }; output: undefined };
	"panel.browserRead": { input: { id: string }; output: string };
	"panel.chatState": { input: { projectPath: string }; output: DesktopSnapshot | null };
	"panel.chatRespond": { input: { projectPath: string; reply: InteractionReply }; output: undefined };
	"panel.chatSend": {
		input: { projectPath: string; message: string; mode?: "auto" | "steer" | "followUp" };
		output: undefined;
	};
	"panel.chatAbort": { input: { projectPath: string }; output: undefined };
	"panel.chatNew": { input: { projectPath: string }; output: undefined };
}
export type PanelRequestName = keyof PanelRequests;
const schema: Record<
	Exclude<PanelRequestName, "panel.chatRespond">,
	Record<string, "string" | "number" | "boolean">
> = {
	"panel.files": { projectPath: "string", path: "string" },
	"panel.file": { projectPath: "string", path: "string" },
	"panel.review": { projectPath: "string" },
	"panel.diff": { projectPath: "string", path: "string", staged: "boolean" },
	"panel.terminalOpen": { projectPath: "string" },
	"panel.terminalWrite": { id: "string", data: "string" },
	"panel.terminalResize": { id: "string", cols: "number", rows: "number" },
	"panel.terminalClose": { id: "string" },
	"panel.browserTabs": {},
	"panel.browserOpen": { url: "string" },
	"panel.browserRead": { id: "string" },
	"panel.chatState": { projectPath: "string" },
	"panel.chatSend": { projectPath: "string", message: "string" },
	"panel.chatAbort": { projectPath: "string" },
	"panel.chatNew": { projectPath: "string" },
};
export function validatePanelRequest(name: string, input: unknown): asserts name is PanelRequestName {
	if (name === "panel.chatRespond") {
		if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("응답 형식을 확인하세요.");
		const obj = input as { projectPath?: unknown; reply?: unknown };
		validatePanelRequest("panel.chatState", { projectPath: obj.projectPath });
		if (Object.keys(input).length !== 2) throw new Error("응답 형식을 확인하세요.");
		validateInteractionReply(obj.reply);
		return;
	}
	if (name === "panel.chatSend" && input && typeof input === "object" && "mode" in input) {
		const { mode, ...rest } = input;
		if (typeof mode !== "string" || !["auto", "steer", "followUp"].includes(mode))
			throw new Error("전송 방식을 확인하세요.");
		validatePanelRequest(name, rest);
		return;
	}
	if (!Object.hasOwn(schema, name)) throw new Error("허용되지 않은 패널 요청입니다.");
	const fields = schema[name as keyof typeof schema];
	if (!Object.keys(fields).length) {
		if (input !== undefined) throw new Error("잘못된 요청입니다.");
		return;
	}
	if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("잘못된 요청입니다.");
	const obj = input as Record<string, unknown>;
	if (Object.keys(obj).length !== Object.keys(fields).length) throw new Error("잘못된 요청입니다.");
	for (const [key, type] of Object.entries(fields)) {
		const value = obj[key];
		if (typeof value !== type) throw new Error("잘못된 요청입니다.");
		if (
			typeof value === "string" &&
			(value.length > (key === "message" ? 100_000 : key === "data" ? 65_536 : 4096) ||
				(key !== "data" && value.includes("\0")) ||
				(key !== "path" && key !== "data" && !value.trim()))
		)
			throw new Error("입력 길이나 형식을 확인하세요.");
		if (typeof value === "number" && (!Number.isInteger(value) || value < 2 || value > 500))
			throw new Error("터미널 크기가 올바르지 않습니다.");
	}
}
