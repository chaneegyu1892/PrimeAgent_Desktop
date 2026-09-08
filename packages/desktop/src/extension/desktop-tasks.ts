import type { TaskSpec } from "../shared/harness-contract";
import { TASK_ROLES } from "../shared/harness-contract";

export const desktopTaskTool = {
	name: "desktop_tasks",
	label: "에이전트 작업",
	description:
		"Create, inspect and coordinate persistent background tasks in Prime Desktop. Each task uses an independent Prime session and configured role model. Same-project workers run sequentially; never wait inside a worker for queued child jobs. List/detail returns task IDs, dependencies, results and waiting status. User approvals remain in Desktop UI. No automatic model fallback or retry of failed writes. Tasks share the project files.",
	promptSnippet: "Delegate bounded work, track dependencies, inspect results and intervene in background agent tasks.",
	promptGuidelines: [
		"Use delegation when it materially helps the user's authorized task. Provide concrete acceptance criteria. Tasks can call paid models using the user's configured provider. Stay within the task and runtime limits. Return task IDs and surface pending questions.",
		"Completed means the model turn ended; inspect evidence before claiming the user's objective is achieved. Failed/interrupted tasks require explicit user resume, not automatic replay.",
	],
	executionMode: "sequential" as const,
	parameters: {
		type: "object",
		properties: {
			action: { type: "string", enum: ["list", "create", "detail", "message", "cancel"] },
			id: { type: "string" },
			message: { type: "string" },
			task: {
				type: "object",
				properties: {
					title: { type: "string" },
					prompt: { type: "string" },
					role: { type: "string", enum: Object.keys(TASK_ROLES) },
					dependencies: { type: "array", items: { type: "string" } },
					criteria: { type: "string" },
				},
				required: ["title", "prompt", "role", "dependencies", "criteria"],
				additionalProperties: false,
			},
		},
		required: ["action"],
		additionalProperties: false,
	},
	async execute(
		_id: string,
		params: { action: string; id?: string; message?: string; task?: TaskSpec },
		signal?: AbortSignal,
	) {
		const url = process.env.PRIME_DESKTOP_TASK_URL,
			token = process.env.PRIME_DESKTOP_TASK_TOKEN;
		if (!url || !token || !/^http:\/\/127\.0\.0\.1:\d+\/tasks$/.test(url))
			throw new Error("Prime Desktop 작업 연결이 없습니다.");
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
			body: JSON.stringify(params),
			signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
		});
		if (!response.ok) throw new Error("작업 브리지 연결 실패");
		const result = (await response.json()) as { ok: boolean; value?: unknown; error?: string };
		if (!result.ok) throw new Error(result.error ?? "작업 요청 실패");
		return { content: [{ type: "text" as const, text: JSON.stringify(result.value) }], details: {} };
	},
};
export default function desktopTasks(pi: { registerTool(tool: typeof desktopTaskTool): void }) {
	pi.registerTool(desktopTaskTool);
}
