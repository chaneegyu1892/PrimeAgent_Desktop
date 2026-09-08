import type { DesktopSnapshot } from "./dto";
import { type InteractionReply, validateInteractionReply } from "./interactions";

export const TASK_ROLES = {
	general: "일반 작업",
	explore: "코드 탐색",
	research: "자료 조사",
	plan: "설계·계획",
	implement: "구현",
	review: "독립 검토",
	visual: "화면·디자인",
	verify: "검증",
} as const;
export type TaskRole = keyof typeof TASK_ROLES;
export type TaskStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled" | "interrupted";
export interface TaskSpec {
	title: string;
	prompt: string;
	role: TaskRole;
	dependencies: string[];
	criteria: string;
}
export interface HarnessTask extends TaskSpec {
	id: string;
	projectPath: string;
	parentId?: string;
	status: TaskStatus;
	createdAt: string;
	updatedAt: string;
	sessionFile?: string;
	result: string;
	error?: string;
	attempt: number;
	model?: { provider: string; modelId: string; level: string };
}
export interface HarnessConfig {
	paused: boolean;
	concurrency: number;
	maxTasks: number;
	timeoutMinutes: number;
	routes: Partial<Record<TaskRole, { provider: string; modelId: string; level: string }>>;
}
export interface HarnessSnapshot {
	tasks: HarnessTask[];
	config: HarnessConfig;
	error?: string;
}
export interface ProjectMemoryEntry {
	key: string;
	content: string;
	source: string;
	updatedAt: string;
}
export interface HarnessRequests {
	"harness.memoryList": { input: { projectPath: string; query: string }; output: ProjectMemoryEntry[] };
	"harness.memorySave": {
		input: { projectPath: string; key: string; content: string; source: string };
		output: ProjectMemoryEntry[];
	};
	"harness.memoryForget": { input: { projectPath: string; key: string }; output: ProjectMemoryEntry[] };
	"harness.list": { input: undefined; output: HarnessSnapshot };
	"harness.create": { input: TaskSpec & { projectPath: string }; output: HarnessSnapshot };
	"harness.configure": { input: HarnessConfig; output: HarnessSnapshot };
	"harness.cancel": { input: { id: string }; output: HarnessSnapshot };
	"harness.resume": { input: { id: string }; output: HarnessSnapshot };
	"harness.detail": { input: { id: string }; output: { task: HarnessTask; snapshot: DesktopSnapshot | null } };
	"harness.message": { input: { id: string; message: string }; output: undefined };
	"harness.respond": { input: { id: string; reply: InteractionReply }; output: undefined };
}
export type HarnessRequestName = keyof HarnessRequests;
const object = (v: unknown): Record<string, unknown> => {
	if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("작업 요청 형식을 확인하세요.");
	return v as Record<string, unknown>;
};
const exact = (v: Record<string, unknown>, keys: string[]) => {
	if (Object.keys(v).length !== keys.length || keys.some((key) => !Object.hasOwn(v, key)))
		throw new Error("작업 요청 항목을 확인하세요.");
};
const text = (v: unknown, limit: number, empty = false) => {
	if (typeof v !== "string" || v.includes("\0") || v.length > limit || (!empty && !v.trim()))
		throw new Error("작업 내용의 길이와 형식을 확인하세요.");
};
export function validateTaskSpec(input: unknown): asserts input is TaskSpec {
	const v = object(input);
	exact(v, ["title", "prompt", "role", "dependencies", "criteria"]);
	text(v.title, 200);
	text(v.prompt, 40_000);
	text(v.criteria, 4000);
	if (typeof v.role !== "string" || !Object.hasOwn(TASK_ROLES, v.role)) throw new Error("역할을 선택하세요.");
	if (
		!Array.isArray(v.dependencies) ||
		v.dependencies.length > 20 ||
		new Set(v.dependencies).size !== v.dependencies.length
	)
		throw new Error("선행 작업 목록을 확인하세요.");
	for (const id of v.dependencies) text(id, 64);
}
export function validateHarnessConfig(input: unknown): asserts input is HarnessConfig {
	const v = object(input);
	exact(v, ["paused", "concurrency", "maxTasks", "timeoutMinutes", "routes"]);
	if (typeof v.paused !== "boolean") throw new Error("대기열 설정을 확인하세요.");
	for (const [key, max] of [
		["concurrency", 4],
		["maxTasks", 100],
		["timeoutMinutes", 120],
	] as const)
		if (!Number.isInteger(v[key]) || Number(v[key]) < 1 || Number(v[key]) > max)
			throw new Error("실행 한도를 확인하세요.");
	for (const [role, value] of Object.entries(object(v.routes))) {
		if (!Object.hasOwn(TASK_ROLES, role)) throw new Error("모델 역할을 확인하세요.");
		const route = object(value);
		exact(route, ["provider", "modelId", "level"]);
		text(route.provider, 200);
		text(route.modelId, 200);
		if (!["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(String(route.level)))
			throw new Error("추론 수준을 확인하세요.");
	}
}
export function validateHarnessRequest(name: string, input: unknown): asserts name is HarnessRequestName {
	if (name === "harness.list") {
		if (input !== undefined) throw new Error("잘못된 작업 요청입니다.");
		return;
	}
	if (name === "harness.configure") return validateHarnessConfig(input);
	const v = object(input);
	if (["harness.memoryList", "harness.memorySave", "harness.memoryForget"].includes(name)) {
		exact(
			v,
			name === "harness.memoryList"
				? ["projectPath", "query"]
				: name === "harness.memorySave"
					? ["projectPath", "key", "content", "source"]
					: ["projectPath", "key"],
		);
		text(v.projectPath, 4096);
		if (name === "harness.memoryList") text(v.query, 500, true);
		else text(v.key, 120);
		if (name === "harness.memorySave") {
			text(v.content, 8000);
			text(v.source, 1000);
		}
		return;
	}
	if (name === "harness.create") {
		const { projectPath, ...spec } = v;
		text(projectPath, 4096);
		return validateTaskSpec(spec);
	}
	if (!["harness.cancel", "harness.resume", "harness.detail", "harness.message", "harness.respond"].includes(name))
		throw new Error("허용되지 않은 작업 요청입니다.");
	exact(v, name === "harness.message" ? ["id", "message"] : name === "harness.respond" ? ["id", "reply"] : ["id"]);
	text(v.id, 64);
	if (name === "harness.message") text(v.message, 40_000);
	if (name === "harness.respond") validateInteractionReply(v.reply);
}
