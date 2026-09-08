import { type CapabilityRequestName, validateCapabilityRequest } from "./capability-contract";
import type { RequestName } from "./desktop-api";
import { validateInteractionReply } from "./interactions";
import { type PanelRequestName, validatePanelRequest } from "./panel-contract";
export const REQUEST_CHANNEL = "prime-desktop:request";
export const SNAPSHOT_CHANNEL = "prime-desktop:snapshot";
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const fields: Record<Exclude<RequestName, PanelRequestName | CapabilityRequestName>, readonly string[]> = {
	"update.status": [],
	"update.check": [],
	"update.download": [],
	"update.install": [],
	"app.snapshot": [],
	"app.copyText": ["text"],
	"project.selectDirectory": [],
	"project.openRecent": ["path"],
	"project.removeRecent": ["path"],
	"settings.selectCli": [],
	"settings.detectCli": [],
	"agent.connect": [],
	"agent.respond": [],
	"agent.reconnect": [],
	"agent.disconnect": [],
	"agent.prompt": ["message"],
	"agent.steer": ["message"],
	"agent.followUp": ["message"],
	"attachment.select": [],
	"attachment.remove": ["id"],
	"agent.abort": [],
	"agent.refresh": [],
	"agent.copyDiagnostics": [],
	"session.new": [],
	"session.newGeneral": [],
	"session.list": [],
	"session.open": ["path", "projectPath"],
	"session.create": ["path"],
	"session.resume": [],
	"session.setName": ["name"],
	"model.list": [],
	"model.select": ["provider", "modelId"],
	"model.setThinkingLevel": ["level"],
};
export function record(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
export function validateRequest(name: unknown, input: unknown): asserts name is RequestName {
	if (typeof name === "string" && name.startsWith("capability.")) {
		validateCapabilityRequest(name, input);
		return;
	}
	if (name === "agent.respond") {
		validateInteractionReply(input);
		return;
	}
	if (typeof name === "string" && name.startsWith("panel.")) {
		validatePanelRequest(name, input);
		return;
	}
	if (typeof name !== "string" || !Object.hasOwn(fields, name)) throw new Error("허용되지 않은 요청입니다.");
	const expected = fields[name as Exclude<RequestName, PanelRequestName | CapabilityRequestName>];
	if (expected.length === 0) {
		if (input !== undefined) throw new Error("요청 인자가 올바르지 않습니다.");
		return;
	}
	const obj = record(input);
	if (["agent.prompt", "agent.steer", "agent.followUp"].includes(name) && "attachmentIds" in obj) {
		const ids = obj.attachmentIds;
		if (
			!Array.isArray(ids) ||
			ids.length > 10 ||
			new Set(ids).size !== ids.length ||
			ids.some((id) => typeof id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(id)) ||
			Object.keys(obj).some((key) => !["message", "attachmentIds"].includes(key))
		)
			throw new Error("첨부파일 목록이 올바르지 않습니다.");
		if (
			typeof obj.message !== "string" ||
			obj.message.length > 100_000 ||
			obj.message.includes("\0") ||
			(!obj.message.trim() && ids.length === 0)
		)
			throw new Error("메시지 또는 첨부파일을 추가하세요.");
		return;
	}
	if (Object.keys(obj).length !== expected.length) throw new Error("요청 인자가 올바르지 않습니다.");
	for (const key of expected) {
		const value = obj[key];
		const max = key === "message" || key === "text" ? 100_000 : key === "path" || key === "projectPath" ? 4096 : 512;
		if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) {
			throw new Error(`${key}: 비어 있거나 허용 길이를 넘는 값입니다.`);
		}
	}
	if (name === "model.setThinkingLevel" && !THINKING_LEVELS.includes(obj.level as (typeof THINKING_LEVELS)[number])) {
		throw new Error("지원하지 않는 thinking level입니다.");
	}
}
