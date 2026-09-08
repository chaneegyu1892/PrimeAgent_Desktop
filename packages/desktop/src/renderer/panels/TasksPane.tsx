import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopAPI, RequestInput, RequestName, RequestOutput } from "../../shared/desktop-api";
import type { DesktopSnapshot, ModelInfo } from "../../shared/dto";
import { type HarnessSnapshot, type HarnessTask, TASK_ROLES, type TaskRole } from "../../shared/harness-contract";
import { InteractionCards } from "../InteractionCards";
import { MarkdownMessage } from "../MarkdownMessage";
import { ProjectMemory } from "./ProjectMemory";
import "./tasks.css";

const STATUS = {
	queued: "대기",
	running: "실행 중",
	waiting: "답변 필요",
	completed: "실행 완료",
	failed: "오류",
	cancelled: "취소",
	interrupted: "중단됨",
};
export function TasksPane({
	api,
	projectPath,
	insert,
}: {
	api?: DesktopAPI;
	projectPath?: string;
	insert: (text: string) => void;
}) {
	const [data, setData] = useState<HarnessSnapshot>();
	const [selected, setSelected] = useState("");
	const [detail, setDetail] = useState<{ task: HarnessTask; snapshot: DesktopSnapshot | null }>();
	const [title, setTitle] = useState("");
	const [prompt, setPrompt] = useState("");
	const [criteria, setCriteria] = useState("");
	const [role, setRole] = useState<TaskRole>("general");
	const [dependency, setDependency] = useState("");
	const [message, setMessage] = useState("");
	const [createOpen, setCreateOpen] = useState(false);
	const [settings, setSettings] = useState(false);
	const [allProjects, setAllProjects] = useState(false);
	const [models, setModels] = useState<ModelInfo[]>([]);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const guard = useRef(false);
	const call = useCallback(
		async <K extends RequestName>(name: K, input: RequestInput<K>): Promise<RequestOutput<K>> => {
			if (!api) throw new Error("앱 연결을 확인하세요.");
			const result = await api.request(name, input);
			if (!result.ok) throw new Error(result.error);
			return result.value;
		},
		[api],
	);
	useEffect(() => {
		let live = true,
			pending = false;
		const refresh = async () => {
			if (pending) return;
			pending = true;
			try {
				const [next, task] = await Promise.all([
					call("harness.list", undefined),
					selected ? call("harness.detail", { id: selected }) : undefined,
				]);
				if (live) {
					setData(next);
					setDetail(task);
				}
			} catch (error) {
				if (live) setError(error instanceof Error ? error.message : "작업 조회 실패");
			} finally {
				pending = false;
			}
		};
		void refresh();
		const timer = setInterval(() => void refresh(), 1500);
		return () => {
			live = false;
			clearInterval(timer);
		};
	}, [call, selected]);
	async function action(work: () => Promise<void>) {
		if (guard.current) return;
		guard.current = true;
		setBusy(true);
		setError("");
		try {
			await work();
			setData(await call("harness.list", undefined));
		} catch (error) {
			setError(error instanceof Error ? error.message : "작업 요청 실패");
		} finally {
			setBusy(false);
			guard.current = false;
		}
	}
	const tasks = data?.tasks.filter((task) => allProjects || task.projectPath === projectPath) ?? [];
	const selectedTask = detail?.task.id === selected ? detail.task : data?.tasks.find((task) => task.id === selected);
	return (
		<div className="tasks-pane">
			<div className="tasks-toolbar">
				<strong>에이전트 작업</strong>
				<button type="button" onClick={() => setCreateOpen(!createOpen)}>
					새 작업
				</button>
				<button
					type="button"
					onClick={() => {
						setSettings(!settings);
						if (!settings)
							void call("model.list", undefined)
								.then(setModels)
								.catch(() => setModels([]));
					}}
				>
					실행 설정
				</button>
			</div>
			<p className="tasks-hint">
				패널을 닫아도 작업은 계속됩니다. 같은 프로젝트의 백그라운드 작업은 순서대로 실행하며, 대화와 프로젝트 파일을
				공유합니다.
			</p>
			{data && (
				<div className="tasks-toolbar">
					<label>
						<input
							type="checkbox"
							checked={allProjects}
							onChange={(event) => setAllProjects(event.target.checked)}
						/>
						모든 프로젝트
					</label>
					<button
						type="button"
						disabled={busy || !!data.error}
						onClick={() =>
							void action(async () => {
								await call("harness.configure", { ...data.config, paused: !data.config.paused });
							})
						}
					>
						{data.config.paused ? "대기열 시작" : "대기열 일시정지"}
					</button>
				</div>
			)}
			{data?.config.paused && (
				<p className="tasks-warning">대기열이 멈춰 있습니다. 실행 중인 작업은 개별 중단할 수 있습니다.</p>
			)}
			{(error || data?.error) && (
				<p className="message-error" role="alert">
					{error || data?.error}
				</p>
			)}
			{settings && data && (
				<form
					className="tasks-form"
					onSubmit={(event) => {
						event.preventDefault();
						const form = new FormData(event.currentTarget);
						const routes = { ...data.config.routes };
						for (const key of Object.keys(TASK_ROLES) as TaskRole[]) {
							const model = models.find((m) => `${m.provider}/${m.id}` === form.get(`route-${key}`));
							if (model)
								routes[key] = {
									provider: model.provider,
									modelId: model.id,
									level: String(form.get(`level-${key}`)),
								};
							else if (form.get(`route-${key}`) === "") delete routes[key];
						}
						void action(async () => {
							await call("harness.configure", {
								...data.config,
								concurrency: Number(form.get("concurrency")),
								maxTasks: Number(form.get("maxTasks")),
								timeoutMinutes: Number(form.get("timeout")),
								routes,
							});
							setSettings(false);
						});
					}}
				>
					<label>
						프로젝트 동시 실행 수
						<input
							name="concurrency"
							type="number"
							min="1"
							max="4"
							defaultValue={data.config.concurrency}
							required
						/>
					</label>
					<label>
						미완료 작업 수 한도
						<input name="maxTasks" type="number" min="1" max="100" defaultValue={data.config.maxTasks} required />
					</label>
					<label>
						응답 실행 시간 한도 (분)
						<input
							name="timeout"
							type="number"
							min="1"
							max="120"
							defaultValue={data.config.timeoutMinutes}
							required
						/>
					</label>
					<p className="tasks-hint">
						역할별 모델은 현재 연결된 Prime 모델 목록에서 선택합니다. 기본값은 각 작업의 Prime 설정을 사용합니다.
						모델 사용료는 공급자 기준이며, 시간 한도는 금액 한도가 아닙니다.
					</p>
					{(Object.keys(TASK_ROLES) as TaskRole[]).map((key) => {
						const route = data.config.routes[key];
						const saved = route ? `${route.provider}/${route.modelId}` : "";
						return (
							<div className="task-route" key={key}>
								<label>
									{TASK_ROLES[key]}
									<select name={`route-${key}`} defaultValue={saved}>
										<option value="">Prime 기본 모델</option>
										{saved && !models.some((model) => `${model.provider}/${model.id}` === saved) && (
											<option value={saved}>{saved} (저장됨)</option>
										)}
										{models.map((model) => (
											<option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>
												{model.provider} / {model.name}
											</option>
										))}
									</select>
								</label>
								<label>
									추론
									<select name={`level-${key}`} defaultValue={route?.level ?? "high"}>
										{["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((level) => (
											<option key={level}>{level}</option>
										))}
									</select>
								</label>
							</div>
						);
					})}
					<button type="submit" disabled={busy}>
						설정 저장
					</button>
				</form>
			)}
			{createOpen && (
				<form
					className="tasks-form"
					onSubmit={(event) => {
						event.preventDefault();
						if (!projectPath) return;
						void action(async () => {
							const next = await call("harness.create", {
								projectPath,
								title,
								prompt,
								role,
								criteria,
								dependencies: dependency ? [dependency] : [],
							});
							setSelected(next.tasks.at(-1)?.id ?? "");
							setCreateOpen(false);
							setTitle("");
							setPrompt("");
							setCriteria("");
							setDependency("");
						});
					}}
				>
					<label>
						작업 이름
						<input
							aria-label="작업 이름"
							value={title}
							maxLength={200}
							required
							onChange={(event) => setTitle(event.target.value)}
						/>
					</label>
					<label>
						역할
						<select value={role} onChange={(event) => setRole(event.target.value as TaskRole)}>
							{Object.entries(TASK_ROLES).map(([id, name]) => (
								<option key={id} value={id}>
									{name}
								</option>
							))}
						</select>
					</label>
					<label>
						요청 내용
						<textarea
							aria-label="작업 요청 내용"
							value={prompt}
							maxLength={40_000}
							rows={4}
							required
							onChange={(event) => setPrompt(event.target.value)}
						/>
					</label>
					<label>
						완료·검증 기준
						<textarea
							aria-label="작업 완료 기준"
							value={criteria}
							maxLength={4000}
							rows={2}
							required
							onChange={(event) => setCriteria(event.target.value)}
						/>
					</label>
					<label>
						선행 작업
						<select value={dependency} onChange={(event) => setDependency(event.target.value)}>
							<option value="">없음</option>
							{data?.tasks
								.filter((task) => task.projectPath === projectPath)
								.map((task) => (
									<option key={task.id} value={task.id}>
										{task.title} · {STATUS[task.status]}
									</option>
								))}
						</select>
					</label>
					<button type="submit" disabled={busy || !projectPath}>
						작업 등록
					</button>
				</form>
			)}
			{projectPath && <ProjectMemory api={api} projectPath={projectPath} />}
			<div className="task-list">
				{!tasks.length && (
					<p className="pane-empty">
						등록된 작업이 없습니다. 새 작업을 만들거나 에이전트에게 작업 분담을 요청하세요.
					</p>
				)}
				{tasks.map((task) => (
					<button
						className={`task-row ${task.id === selected ? "selected" : ""}`}
						type="button"
						key={task.id}
						onClick={() => {
							setSelected(task.id);
							setDetail(undefined);
							setMessage("");
						}}
					>
						<span>
							<strong>{task.title}</strong>
							<small>
								{TASK_ROLES[task.role]} · 시도 {task.attempt}
								{task.parentId ? " · 하위 작업" : ""}
							</small>
						</span>
						<span className={`task-status ${task.status}`}>{STATUS[task.status]}</span>
					</button>
				))}
			</div>
			{selectedTask && (
				<section className="task-detail" aria-label="선택한 작업 상세">
					<h3>{selectedTask.title}</h3>
					<p className="tasks-hint">{selectedTask.projectPath}</p>
					<p>{selectedTask.criteria}</p>
					{selectedTask.model && (
						<small>
							{selectedTask.model.provider} / {selectedTask.model.modelId} · {selectedTask.model.level}
						</small>
					)}
					{selectedTask.dependencies.length > 0 && (
						<div className="task-dependencies">
							선행 작업:{" "}
							{selectedTask.dependencies.map((id) => (
								<button
									type="button"
									key={id}
									onClick={() => {
										setSelected(id);
										setDetail(undefined);
									}}
								>
									{data?.tasks.find((task) => task.id === id)?.title ?? id}
								</button>
							))}
						</div>
					)}
					{selectedTask.status === "queued" &&
						selectedTask.dependencies.some(
							(id) => data?.tasks.find((task) => task.id === id)?.status !== "completed",
						) && (
							<p className="tasks-warning">
								선행 작업의 실행 완료를 기다립니다. 실패한 선행 작업은 확인 후 재개하세요.
							</p>
						)}
					<div className="tasks-toolbar">
						{["queued", "running", "waiting"].includes(selectedTask.status) && (
							<button
								type="button"
								disabled={busy}
								onClick={() =>
									void action(async () => {
										await call("harness.cancel", { id: selected });
									})
								}
							>
								작업·하위 작업 중단
							</button>
						)}
						{["failed", "cancelled", "interrupted"].includes(selectedTask.status) && (
							<button
								type="button"
								disabled={busy}
								onClick={() =>
									void action(async () => {
										await call("harness.resume", { id: selected });
									})
								}
							>
								기존 변경 확인 후 재개
							</button>
						)}
						{selectedTask.result && (
							<button
								type="button"
								onClick={() =>
									insert(
										`작업 ${selectedTask.title}의 결과와 완료 기준을 검토해줘.\n기준: ${selectedTask.criteria}\n${selectedTask.result}`,
									)
								}
							>
								대화에서 결과 검토
							</button>
						)}
					</div>
					{selectedTask.error && <p className="message-error">{selectedTask.error}</p>}
					{detail?.task.id === selected && detail.snapshot && (
						<>
							<InteractionCards
								items={detail.snapshot.interactions}
								respond={(reply) => call("harness.respond", { id: selected, reply })}
							/>
							{["running", "waiting"].includes(selectedTask.status) && (
								<form
									className="tasks-form"
									onSubmit={(event) => {
										event.preventDefault();
										void action(async () => {
											await call("harness.message", { id: selected, message });
											setMessage("");
										});
									}}
								>
									<label>
										작업 중 추가 지시
										<textarea
											rows={2}
											value={message}
											required
											maxLength={40_000}
											onChange={(event) => setMessage(event.target.value)}
										/>
									</label>
									<button type="submit" disabled={busy}>
										지시 보내기
									</button>
								</form>
							)}
							{detail.snapshot.activity.slice(-5).map((activity) => (
								<details key={activity.id}>
									<summary>{activity.label}</summary>
									<pre>{activity.detail}</pre>
								</details>
							))}
							{detail.snapshot.messages
								.filter((item) => item.role === "assistant")
								.slice(-1)
								.map((item) => (
									<MarkdownMessage key={item.timestamp ?? "live"} content={item.content} />
								))}
						</>
					)}
					{selectedTask.result && (
						<>
							<p className="tasks-hint">실행 완료는 검증 통과를 뜻하지 않습니다. 아래 근거를 확인하세요.</p>
							<MarkdownMessage content={selectedTask.result} />
						</>
					)}
				</section>
			)}
		</div>
	);
}
