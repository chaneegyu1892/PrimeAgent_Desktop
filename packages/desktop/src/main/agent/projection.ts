import type { AgentState, Message, ModelInfo } from "../../shared/dto";
import { record } from "../../shared/ipc-contract";
import type { Redactor } from "./redaction";

export function modelInfo(value: unknown): ModelInfo | undefined {
	const model = record(value);
	if (typeof model.id !== "string" || typeof model.provider !== "string") return undefined;
	return {
		id: model.id,
		provider: model.provider,
		name: typeof model.name === "string" ? model.name : model.id,
		reasoning: model.reasoning === true,
	};
}
export function projectState(value: unknown, redactor: Redactor): AgentState {
	const state = record(value);
	if (typeof state.sessionId !== "string" || typeof state.isStreaming !== "boolean")
		throw new Error("Prime Agent 버전의 세션 응답 형식을 확인하세요.");
	const actions = record(state.sessionActions);
	const strings = (v: unknown) =>
		Array.isArray(v)
			? v
					.filter((s): s is string => typeof s === "string")
					.slice(0, 50)
					.map((s) => redactor.text(s))
			: [];
	return {
		sessionId: state.sessionId,
		sessionFile: typeof state.sessionFile === "string" ? state.sessionFile : undefined,
		sessionName: typeof state.sessionName === "string" ? redactor.text(state.sessionName) : undefined,
		model: modelInfo(state.model),
		thinkingLevel: typeof state.thinkingLevel === "string" ? state.thinkingLevel : "unknown",
		isStreaming: state.isStreaming,
		isCompacting: state.isCompacting === true,
		queuedCount: typeof actions.queuedCount === "number" ? actions.queuedCount : 0,
		steering: strings(actions.steering),
		followUps: strings(actions.followUps),
	};
}
export function contentText(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value
		.map((item) => {
			const block = record(item);
			if (block.type === "text" && typeof block.text === "string") return block.text;
			if (block.type === "thinking" && typeof block.thinking === "string") return block.thinking;
			if (block.type === "toolCall") return `[${String(block.name ?? "tool")}]`;
			if (block.type === "image") return "[이미지]";
			return "";
		})
		.filter(Boolean)
		.join("\n");
}
export function projectMessage(value: unknown, redactor: Redactor): Message | null {
	const message = record(value);
	if (typeof message.role !== "string") return null;
	return {
		role: message.role,
		content: redactor
			.text(contentText(message.content) || (typeof message.output === "string" ? message.output : ""))
			.slice(0, 100_000),
		timestamp: typeof message.timestamp === "number" ? message.timestamp : undefined,
		toolName: typeof message.toolName === "string" ? message.toolName : undefined,
		toolCallId: typeof message.toolCallId === "string" ? message.toolCallId : undefined,
		error: typeof message.errorMessage === "string" ? redactor.text(message.errorMessage) : undefined,
	};
}
