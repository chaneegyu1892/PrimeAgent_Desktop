export type InteractionReply = { id: string } & (
	| { action: "cancel" }
	| { action: "choose"; option: number }
	| { action: "confirm"; confirmed: boolean }
	| { action: "submit"; text: string }
);
export interface Interaction {
	id: string;
	method: "select" | "confirm" | "input" | "editor";
	title: string;
	message: string;
	options: string[];
	prefill: string;
	placeholder: string;
	expiresAt?: number;
	status: "pending" | "sending" | "answered" | "cancelled" | "expired" | "closed";
	answer?: string;
}
export interface AgentNotice {
	id: string;
	kind: "notify" | "status" | "widget" | "draft" | "title";
	text: string;
	isError: boolean;
}
export function validateInteractionReply(input: unknown): asserts input is InteractionReply {
	if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("응답 형식이 올바르지 않습니다.");
	const obj = input as Record<string, unknown>;
	if (typeof obj.id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(obj.id))
		throw new Error("요청 ID가 올바르지 않습니다.");
	const fields =
		obj.action === "cancel"
			? ["id", "action"]
			: obj.action === "choose"
				? ["id", "action", "option"]
				: obj.action === "confirm"
					? ["id", "action", "confirmed"]
					: obj.action === "submit"
						? ["id", "action", "text"]
						: [];
	if (
		!fields.length ||
		Object.keys(obj).length !== fields.length ||
		Object.keys(obj).some((key) => !fields.includes(key))
	)
		throw new Error("응답 항목이 올바르지 않습니다.");
	if (
		obj.action === "choose" &&
		(typeof obj.option !== "number" || !Number.isInteger(obj.option) || obj.option < 0 || obj.option > 199)
	)
		throw new Error("선택지를 확인하세요.");
	if (obj.action === "confirm" && typeof obj.confirmed !== "boolean") throw new Error("확인 값을 선택하세요.");
	if (
		obj.action === "submit" &&
		(typeof obj.text !== "string" || obj.text.length > 100_000 || obj.text.includes("\0"))
	)
		throw new Error("입력 내용을 확인하세요.");
}
