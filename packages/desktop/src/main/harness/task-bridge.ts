import { randomBytes } from "node:crypto";
import { realpath } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { TaskSpec } from "../../shared/harness-contract";
import { validateHarnessRequest, validateTaskSpec } from "../../shared/harness-contract";
import { record } from "../../shared/ipc-contract";
import type { TaskService } from "./task-service";

export class TaskBridge {
	private server?: Server;
	private url = "";
	private pending = 0;
	blockers() {
		return this.pending ? ["에이전트 도구 요청을 처리 중입니다."] : [];
	}
	private grants = new Map<string, { project: () => string | undefined; taskId?: string }>();
	constructor(
		private tasks: TaskService,
		private installing: () => boolean = () => false,
	) {}
	async start() {
		this.server = createServer((req, res) => {
			const grant = this.grants.get(req.headers.authorization?.replace(/^Bearer /, "") ?? "");
			if (!grant || req.method !== "POST" || req.url !== "/tasks" || req.headers.origin) {
				res.writeHead(403).end();
				return;
			}
			let raw = "";
			req.setEncoding("utf8");
			req.on("data", (chunk: string) => {
				raw += chunk;
				if (Buffer.byteLength(raw) > 100_000) req.destroy();
			});
			req.on("end", () => {
				void (async () => {
					this.pending++;
					try {
						if (this.installing()) throw new Error("업데이트 중에는 새 작업을 시작할 수 없습니다.");
						const project = grant.project();
						if (!project) throw new Error("프로젝트 연결이 없습니다.");
						const projectPath = await realpath(project);
						const args = record(JSON.parse(raw));
						if (
							Object.keys(args).some(
								(key) =>
									!["action", "id", "task", "message", "query", "key", "content", "source"].includes(key),
							)
						)
							throw new Error("잘못된 작업 인자입니다.");
						let value: unknown;
						if (["memoryList", "memorySave", "memoryForget"].includes(String(args.action))) {
							const { action, ...payload } = args;
							validateHarnessRequest(`harness.${action}`, { ...payload, projectPath });
							if (action === "memorySave")
								await this.tasks.memory.save(projectPath, {
									key: args.key as string,
									content: args.content as string,
									source: args.source as string,
								});
							if (action === "memoryForget") await this.tasks.memory.forget(projectPath, args.key as string);
							value = (await this.tasks.memory.list(projectPath, String(args.query ?? ""))).slice(0, 20);
						} else if (args.action === "list") {
							const snapshot = this.tasks.snapshot(projectPath);
							value = {
								...snapshot,
								tasks: snapshot.tasks.map(
									({ prompt: _prompt, result: _result, criteria: _criteria, ...task }) => task,
								),
							};
						} else if (args.action === "create") {
							validateTaskSpec(args.task);
							value = await this.tasks.create(projectPath, args.task as TaskSpec, grant.taskId);
						} else {
							if (!["detail", "message", "cancel"].includes(String(args.action)))
								throw new Error("허용되지 않은 작업 동작입니다.");
							validateHarnessRequest(
								`harness.${args.action}`,
								args.action === "message" ? { id: args.id, message: args.message } : { id: args.id },
							);
							const task = this.tasks.get(args.id as string);
							if (task.projectPath !== projectPath)
								throw new Error("다른 프로젝트의 작업에는 접근할 수 없습니다.");
							if (args.action === "detail") {
								const detail = this.tasks.detail(task.id);
								value = {
									task: detail.task,
									activity: detail.snapshot?.activity.slice(-10),
									messages: detail.snapshot?.messages.slice(-8),
									waitingForUser: detail.snapshot?.interactions.some((item) => item.status === "pending"),
								};
							} else {
								if (grant.taskId && task.parentId !== grant.taskId)
									throw new Error("하위 작업만 제어할 수 있습니다.");
								if (args.action === "cancel") await this.tasks.cancel(task.id);
								else await this.tasks.message(task.id, args.message as string);
								value = { accepted: true };
							}
						}
						res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, value }));
					} catch (error) {
						res.writeHead(200, { "Content-Type": "application/json" }).end(
							JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "작업 요청 실패" }),
						);
					} finally {
						this.pending--;
					}
				})();
			});
		});
		this.server.requestTimeout = 30_000;
		await new Promise<void>((resolve, reject) => {
			this.server!.once("error", reject);
			this.server!.listen(0, "127.0.0.1", () => {
				this.server!.removeListener("error", reject);
				resolve();
			});
		});
		const address = this.server.address();
		if (!address || typeof address === "string") throw new Error("작업 브리지 시작 실패");
		this.url = `http://127.0.0.1:${address.port}/tasks`;
	}
	grant(project: () => string | undefined, taskId?: string) {
		const token = randomBytes(32).toString("hex");
		const boundProject = project();
		this.grants.set(token, { project: () => boundProject, taskId });
		return { PRIME_DESKTOP_TASK_URL: this.url, PRIME_DESKTOP_TASK_TOKEN: token };
	}
	async shutdown() {
		this.grants.clear();
		this.server?.closeAllConnections();
		await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
	}
}
