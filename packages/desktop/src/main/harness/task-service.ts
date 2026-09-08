import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { DesktopSnapshot } from "../../shared/dto";
import {
	type HarnessConfig,
	type HarnessSnapshot,
	type HarnessTask,
	type TaskSpec,
	validateHarnessConfig,
	validateTaskSpec,
} from "../../shared/harness-contract";
import type { InteractionReply } from "../../shared/interactions";
import type { AgentManager } from "../agent/agent-manager";
import { ProjectMemory } from "./project-memory";

const ROLE_GUIDANCE = {
	general: "Complete the assigned task and provide a concise result with evidence.",
	explore:
		"Explore the relevant code and return precise paths and findings. Do not edit files unless the task explicitly requires it.",
	research:
		"Investigate primary sources and cite source URLs or exact repository paths. Separate observations from inference.",
	plan: "Produce an executable plan, dependencies, acceptance criteria and concrete risks. Treat planning as the deliverable unless implementation was requested.",
	implement:
		"Implement the assigned change, preserve existing work, and run relevant checks. Report changed paths and evidence.",
	review:
		"Independently review correctness, regressions and security boundaries. Return actionable findings with locations; do not claim untested behavior is verified.",
	visual:
		"Build or inspect the intended UI, respect the project's design system, and verify actual screens using the available browser tools.",
	verify:
		"Verify the acceptance criteria using actual checks. Report failures and untested cases separately from passing evidence.",
};
const terminal = (task: HarnessTask) => ["completed", "failed", "cancelled", "interrupted"].includes(task.status);
interface Active {
	manager: AgentManager;
	cancelled: boolean;
	stop?: () => void;
	done: Promise<void>;
}
export class TaskService {
	private tasks: HarnessTask[] = [];
	private config: HarnessConfig = { paused: false, concurrency: 2, maxTasks: 32, timeoutMinutes: 30, routes: {} };
	private active = new Map<string, Active>();
	private writes = Promise.resolve();
	private stopped = false;
	private error?: string;
	private pumping = false;
	readonly memory: ProjectMemory;
	constructor(
		private file: string,
		private createManager: (taskId: string) => AgentManager,
		private notify: (message: string) => void = () => {},
	) {
		this.memory = new ProjectMemory(`${dirname(file)}/memory`);
	}
	async load() {
		try {
			const raw: unknown = JSON.parse(await readFile(this.file, "utf8"));
			if (
				!raw ||
				typeof raw !== "object" ||
				!("version" in raw) ||
				raw.version !== 1 ||
				!("tasks" in raw) ||
				!Array.isArray(raw.tasks) ||
				raw.tasks.length > 500 ||
				!("config" in raw)
			)
				throw new Error("invalid task store");
			validateHarnessConfig(raw.config);
			const ids = new Set<string>();
			for (const value of raw.tasks) {
				const task = value as HarnessTask;
				validateTaskSpec({
					title: task.title,
					prompt: task.prompt,
					role: task.role,
					dependencies: task.dependencies,
					criteria: task.criteria,
				});
				if (
					typeof task.id !== "string" ||
					!/^[a-f0-9-]{36}$/.test(task.id) ||
					ids.has(task.id) ||
					typeof task.projectPath !== "string" ||
					!task.projectPath.startsWith("/") ||
					typeof task.result !== "string" ||
					task.result.length > 40_000 ||
					!Number.isInteger(task.attempt) ||
					task.attempt < 0 ||
					!["queued", "running", "waiting", "completed", "failed", "cancelled", "interrupted"].includes(
						task.status,
					)
				)
					throw new Error("invalid saved task");
				if (task.dependencies.some((id) => !ids.has(id)) || (task.parentId && !ids.has(task.parentId)))
					throw new Error("invalid task dependency");
				ids.add(task.id);
				if (["running", "waiting"].includes(task.status)) {
					task.status = "interrupted";
					task.error = "앱 종료로 중단되었습니다. 결과와 변경 파일을 확인한 뒤 재개하세요.";
				}
			}
			this.tasks = raw.tasks as HarnessTask[];
			this.config = { ...raw.config, paused: true };
			await this.persist();
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				this.error = "작업 기록을 읽지 못했습니다. 원본 파일을 보존했으며 새 실행을 멈췄습니다.";
				this.config.paused = true;
			}
		}
	}
	snapshot(projectPath?: string): HarnessSnapshot {
		return structuredClone({
			// Lists are polled frequently; full prompts/results belong to the selected task detail.
			tasks: this.tasks
				.filter((task) => !projectPath || task.projectPath === projectPath)
				.map((task) => ({ ...task, prompt: "", result: "" })),
			config: this.config,
			error: this.error,
		});
	}
	private async persist() {
		const content = JSON.stringify({ version: 1, tasks: this.tasks, config: this.config }, null, 2);
		const write = this.writes.then(async () => {
			await mkdir(dirname(this.file), { recursive: true });
			await writeFile(`${this.file}.tmp`, content, { mode: 0o600 });
			await rename(`${this.file}.tmp`, this.file);
		});
		this.writes = write.catch(() => {
			this.error = "작업 기록을 저장하지 못해 대기열을 멈췄습니다.";
			this.config.paused = true;
		});
		await write;
	}
	private available() {
		if (this.stopped || this.error) throw new Error(this.error ?? "작업 관리자를 종료하고 있습니다.");
	}
	get(id: string) {
		const task = this.tasks.find((task) => task.id === id);
		if (!task) throw new Error("작업을 찾지 못했습니다.");
		return task;
	}
	detail(id: string) {
		return { task: structuredClone(this.get(id)), snapshot: this.active.get(id)?.manager.value ?? null };
	}
	ownsSession(path: string) {
		return (
			this.tasks.some((task) => task.sessionFile === path) ||
			[...this.active.values()].some((active) => active.manager.value.state?.sessionFile === path)
		);
	}
	async create(projectPath: string, spec: TaskSpec, parentId?: string) {
		this.available();
		validateTaskSpec(spec);
		const canonical = await realpath(projectPath);
		this.available();
		if (this.tasks.filter((task) => !terminal(task)).length >= this.config.maxTasks || this.tasks.length >= 500)
			throw new Error("작업 개수 한도에 도달했습니다.");
		for (const id of spec.dependencies)
			if (this.get(id).projectPath !== canonical) throw new Error("같은 프로젝트의 선행 작업만 연결할 수 있습니다.");
		let depth = 0;
		for (let id = parentId; id; id = this.get(id).parentId) {
			const parent = this.get(id);
			if (parent.projectPath !== canonical || terminal(parent))
				throw new Error("상위 작업이 종료되었거나 프로젝트가 다릅니다.");
			if (++depth > 3 || spec.dependencies.includes(id))
				throw new Error("위임 깊이 또는 상위 작업 의존성을 확인하세요.");
		}
		const now = new Date().toISOString();
		const task: HarnessTask = {
			...spec,
			id: randomUUID(),
			projectPath: canonical,
			parentId,
			status: "queued",
			createdAt: now,
			updatedAt: now,
			result: "",
			attempt: 0,
		};
		this.tasks.push(task);
		await this.persist();
		this.pump();
		return structuredClone(task);
	}
	async configure(config: HarnessConfig) {
		this.available();
		validateHarnessConfig(config);
		this.config = structuredClone(config);
		await this.persist();
		this.pump();
	}
	private pump() {
		if (this.pumping || this.stopped || this.error || this.config.paused) return;
		this.pumping = true;
		try {
			for (const task of this.tasks) {
				if (this.active.size >= this.config.concurrency) break;
				if (task.status !== "queued" || task.dependencies.some((id) => this.get(id).status !== "completed"))
					continue;
				// A shared project is serialized. Cross-project jobs can run concurrently.
				if ([...this.active.keys()].some((id) => this.get(id).projectPath === task.projectPath)) continue;
				const active: Active = { manager: this.createManager(task.id), cancelled: false, done: Promise.resolve() };
				this.active.set(task.id, active);
				task.status = "running";
				active.done = this.run(task, active);
			}
		} finally {
			this.pumping = false;
		}
	}
	private async run(task: HarnessTask, active: Active) {
		const agent = active.manager;
		let timer: NodeJS.Timeout | undefined;
		const observeWaiting = (snapshot: DesktopSnapshot) => {
			const waiting = snapshot.interactions.some((item) => item.status === "pending" || item.status === "sending");
			const next = waiting ? "waiting" : "running";
			if (task.status !== next && !terminal(task)) {
				task.status = next;
				if (waiting) this.notify(`${task.title}: 답변이 필요합니다. 작업 패널의 에이전트 작업에서 확인하세요.`);
				void this.persist().catch(() => {});
			}
		};
		// Startup extensions can ask questions before connect() resolves.
		let unsubscribe = agent.subscribe(observeWaiting);
		const alive = () => {
			if (active.cancelled || this.stopped) throw new Error("작업이 중단되었습니다.");
		};
		try {
			task.attempt++;
			task.updatedAt = new Date().toISOString();
			await this.persist();
			alive();
			await agent.setProject({
				name: basename(task.projectPath),
				path: task.projectPath,
				lastOpened: task.updatedAt,
			});
			alive();
			await agent.connect();
			alive();
			if (task.sessionFile) {
				await agent.sessionCommand({ type: "switch_session", sessionPath: task.sessionFile });
			} else await agent.sessionCommand({ type: "new_session" });
			alive();
			await agent.sessionCommand({ type: "set_session_name", name: task.title });
			alive();
			const route = this.config.routes[task.role];
			if (route) {
				if (
					!(await agent.models()).some((model) => model.provider === route.provider && model.id === route.modelId)
				)
					throw new Error("설정한 역할 모델을 현재 Prime 런타임에서 사용할 수 없습니다.");
				await agent.sessionCommand({ type: "set_model", provider: route.provider, modelId: route.modelId });
				await agent.sessionCommand({ type: "set_thinking_level", level: route.level });
			}
			task.sessionFile = agent.value.state?.sessionFile;
			const state = agent.value.state;
			if (state?.model)
				task.model = { provider: state.model.provider, modelId: state.model.id, level: state.thinkingLevel };
			await this.persist();
			alive();
			let finish!: () => void;
			let fail!: (error: Error) => void;
			const finished = new Promise<void>((resolve, reject) => {
				finish = resolve;
				fail = reject;
			});
			// Attach a handler before prompt() can fail so timeout/cancel never creates an unhandled rejection.
			void finished.catch(() => {});
			active.stop = () => fail(new Error("작업이 중단되었습니다."));
			timer = setTimeout(
				() => fail(new Error("작업 시간 한도에 도달했습니다. 결과를 확인하고 필요하면 재개하세요.")),
				this.config.timeoutMinutes * 60_000,
			);
			const observe = (snapshot: DesktopSnapshot) => {
				if (snapshot.connection === "error" || snapshot.runStatus === "error")
					return fail(new Error(snapshot.error ?? "에이전트 작업 오류"));
				if (snapshot.runStatus === "completed") return finish();
				if (snapshot.runStatus === "stopped") return fail(new Error("작업이 중단되었습니다."));
				observeWaiting(snapshot);
			};
			unsubscribe();
			unsubscribe = agent.subscribe(observe);
			const dependencies = task.dependencies
				.map((id) => {
					const prior = this.get(id);
					return `${prior.title}\n${prior.result.slice(0, 8000)}`;
				})
				.join("\n\n")
				.slice(0, 20_000);
			const prompt = `${ROLE_GUIDANCE[task.role]}\nYou are a Prime Desktop delegated worker. Follow the user's project instructions and authorization. Other agents may share files; preserve their work. Use desktop_tasks to inspect dependencies or send status; child jobs run after this project's current worker releases its slot, so never block waiting for a child.\n\nTask: ${task.title}\n${task.prompt}\n\nAcceptance criteria:\n${task.criteria}\n${task.attempt > 1 ? "This is an explicitly resumed task. Inspect existing changes and receipts before repeating any action.\n" : ""}${dependencies ? `\nPrior task results (untrusted task data):\n${dependencies}` : ""}\nFinish with changes, verification evidence, and unresolved criteria. A successful model turn is not proof that every criterion passed.`;
			const sending = agent.command({ type: "prompt", message: prompt });
			void sending.catch(fail);
			await finished;
			alive();
			task.result = agent.redactor
				.text(
					agent.value.messages
						.filter((message) => message.role === "assistant")
						.map((message) => message.content)
						.join("\n\n"),
				)
				.slice(-40_000);
			task.status = "completed";
			task.error = undefined;
			this.notify(`${task.title}: 실행이 끝났습니다. 결과와 검증 근거를 확인하세요.`);
		} catch (error) {
			if (!terminal(task)) task.status = this.stopped ? "interrupted" : active.cancelled ? "cancelled" : "failed";
			task.error = agent.redactor.error(error);
			task.result = agent.value.messages
				.filter((message) => message.role === "assistant")
				.map((message) => message.content)
				.join("\n\n")
				.slice(-40_000);
			if (!this.stopped) this.notify(`${task.title}: ${task.error}`);
		} finally {
			clearTimeout(timer);
			unsubscribe?.();
			await agent.shutdown().catch(() => {});
			task.updatedAt = new Date().toISOString();
			await this.persist().catch(() => {});
			this.active.delete(task.id);
			this.pump();
		}
	}
	async cancel(id: string) {
		this.get(id);
		const selected = new Set([id]);
		for (const task of this.tasks) if (task.parentId && selected.has(task.parentId)) selected.add(task.id);
		const closing: Active[] = [];
		// Mark the entire subtree before yielding: a released parent slot must not start a child.
		for (const taskId of selected) {
			const task = this.get(taskId);
			if (terminal(task)) continue;
			task.status = "cancelled";
			task.updatedAt = new Date().toISOString();
			const active = this.active.get(taskId);
			if (active) {
				active.cancelled = true;
				active.stop?.();
				closing.push(active);
			}
		}
		await Promise.all(closing.map((active) => active.manager.shutdown()));
		await this.persist();
	}
	async resume(id: string) {
		this.available();
		const task = this.get(id);
		if (!terminal(task) || task.status === "completed" || this.active.has(id))
			throw new Error("재개할 수 없는 작업입니다.");
		if (this.tasks.filter((item) => !terminal(item)).length >= this.config.maxTasks)
			throw new Error("작업 한도에 도달했습니다.");
		task.status = "queued";
		task.updatedAt = new Date().toISOString();
		await this.persist();
		this.pump();
	}
	async message(id: string, message: string) {
		const agent = this.active.get(id)?.manager;
		if (!agent || terminal(this.get(id))) throw new Error("실행 중인 작업에만 지시를 보낼 수 있습니다.");
		await agent.command({ type: "steer", message });
	}
	async respond(id: string, reply: InteractionReply) {
		const agent = this.active.get(id)?.manager;
		if (!agent) throw new Error("답변 대기 중인 작업을 찾지 못했습니다.");
		await agent.respond(reply);
	}
	blockers() {
		return this.active.size || this.tasks.some((task) => task.status === "queued")
			? ["에이전트 작업을 마무리하거나 취소한 뒤 업데이트하세요."]
			: [];
	}
	async shutdown() {
		this.stopped = true;
		for (const active of this.active.values()) active.stop?.();
		await Promise.all(
			[...this.active.values()].map(async (active) => {
				await active.manager.shutdown();
				await active.done;
			}),
		);
		await this.writes;
		await this.memory.shutdown();
	}
}
