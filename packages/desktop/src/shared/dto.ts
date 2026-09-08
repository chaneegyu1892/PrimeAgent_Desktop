import type { AgentNotice, Interaction } from "./interactions";
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
export interface Project {
	kind?: "personal";
	path: string;
	name: string;
	lastOpened: string;
}
export interface SavedSession {
	id: string;
	path: string;
	projectPath: string;
	title: string;
	modified: string;
}
export interface Attachment {
	id: string;
	name: string;
	size: number;
	kind: "image" | "file";
}
export interface PromptPayload {
	message: string;
	attachmentIds?: string[];
}
export interface ModelInfo {
	id: string;
	provider: string;
	name: string;
	reasoning: boolean;
}
export interface AgentState {
	sessionId: string;
	sessionFile?: string;
	sessionName?: string;
	model?: ModelInfo;
	thinkingLevel: string;
	isStreaming: boolean;
	isCompacting: boolean;
	queuedCount: number;
	steering: string[];
	followUps: string[];
}
export interface Message {
	role: string;
	content: string;
	timestamp?: number;
	toolName?: string;
	toolCallId?: string;
	error?: string;
}
export interface Activity {
	id: string;
	type: string;
	label: string;
	detail: string;
	time: string;
	isError: boolean;
}
export interface Diagnostic {
	time: string;
	level: "info" | "error";
	message: string;
}
export interface DesktopSnapshot {
	initializing?: boolean;
	interactions: Interaction[];
	notices: AgentNotice[];
	runStatus: "idle" | "running" | "retrying" | "stopping" | "stopped" | "completed" | "error";
	revision: number;
	connection: ConnectionStatus;
	project: Project | null;
	recent: Project[];
	cliPath: string | null;
	state: AgentState | null;
	messages: Message[];
	activity: Activity[];
	diagnostics: Diagnostic[];
	error: string | null;
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export const EMPTY_SNAPSHOT: DesktopSnapshot = {
	interactions: [],
	notices: [],
	runStatus: "idle",
	revision: 0,
	connection: "disconnected",
	project: null,
	recent: [],
	cliPath: null,
	state: null,
	messages: [],
	activity: [],
	diagnostics: [],
	error: null,
};
