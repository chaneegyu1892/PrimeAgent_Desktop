import { useEffect, useRef, useState } from "react";
import { CONNECTION_TEMPLATES, SKILL_SUMMARIES, SKILL_TITLES } from "../../shared/capability-catalog";
import type { CapabilitySnapshot, McpServerConfig, McpServerView, McpToolView } from "../../shared/capability-contract";
import type { DesktopAPI, RequestInput, RequestName, RequestOutput } from "../../shared/desktop-api";
import { Icon } from "../Icon";
import { MarkdownMessage } from "../MarkdownMessage";
import "./capabilities.css";

const cleanServer = (s: McpServerView): McpServerConfig => {
	const { status: _status, hasToken: _token, hasOAuth: _oauth, toolCount: _count, error: _error, ...config } = s;
	return config;
};
const statuses = { configured: "설정됨", connected: "연결 확인됨", error: "연결 확인 필요", disabled: "꺼짐" };
export function CapabilityLibrary({
	api,
	close,
	insert,
	apply,
	canApply,
}: {
	api?: DesktopAPI;
	close(): void;
	insert(text: string): void;
	apply(): Promise<void>;
	canApply: boolean;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const [tab, setTab] = useState<"skills" | "mcp" | "plugins">("skills");
	const [data, setData] = useState<CapabilitySnapshot>();
	const [query, setQuery] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const [message, setMessage] = useState("");
	const [dirty, setDirty] = useState(false);
	const [skill, setSkill] = useState<{ title: string; content: string }>();
	const [edit, setEdit] = useState<McpServerConfig>();
	const [tools, setTools] = useState<{ name: string; items: McpToolView[] }>();
	const [login, setLogin] = useState<string>();
	useEffect(() => {
		dialog.current?.showModal();
		return () => dialog.current?.close();
	}, []);
	async function request<K extends RequestName>(name: K, input: RequestInput<K>): Promise<RequestOutput<K>> {
		if (!api) throw new Error("Prime Desktop 앱에서 사용할 수 있습니다.");
		const result = await api.request(name, input);
		if (!result.ok) throw new Error(result.error);
		return result.value;
	}
	useEffect(() => {
		let active = true;
		if (api)
			void api
				.request("capability.list", undefined)
				.then((result) => {
					if (active) {
						if (result.ok) setData(result.value);
						else setError(result.error);
					}
				})
				.catch(() => {
					if (active) setError("확장 목록을 불러오지 못했습니다.");
				});
		return () => {
			active = false;
		};
	}, [api]);
	async function work(fn: () => Promise<void>) {
		setPending(true);
		setError("");
		setMessage("");
		try {
			await fn();
		} catch (e) {
			setError(e instanceof Error ? e.message : "요청에 실패했습니다.");
		} finally {
			setPending(false);
		}
	}
	const match = (value: string) => value.toLowerCase().includes(query.toLowerCase());
	const skillCount = data?.skills.filter((s) => s.enabled).length ?? 0;
	return (
		<dialog ref={dialog} className="capability-library" aria-label="확장 라이브러리" onCancel={close}>
			<header className="library-header">
				<div>
					<span className="eyebrow">PRIME DESKTOP</span>
					<h2>확장 라이브러리</h2>
					<p>작업에 맞는 능력을 더하세요.</p>
				</div>
				<button type="button" className="icon-button" aria-label="라이브러리 닫기" onClick={close}>
					<Icon name="close" />
				</button>
			</header>
			<div className="library-layout">
				<nav aria-label="확장 종류">
					{(
						[
							["skills", "Skills", data?.skills.length],
							["mcp", "MCP 연결", data?.servers.length],
							["plugins", "플러그인", data?.plugins.length],
						] as const
					).map(([id, label, count]) => (
						<button
							key={id}
							type="button"
							aria-current={tab === id ? "page" : undefined}
							onClick={() => {
								setTab(id);
								setSkill(undefined);
								setEdit(undefined);
								setTools(undefined);
								setQuery("");
							}}
						>
							<Icon name={id === "skills" ? "file" : id === "mcp" ? "browser" : "plugin"} />
							<span>{label}</span>
							<small>{count ?? "—"}</small>
						</button>
					))}
					<div className="library-summary">
						<strong>{skillCount} Skills 활성화</strong>
						<p>필요한 작업에서 에이전트가 지침을 불러옵니다.</p>
						<span>기본 도구</span>
						<p>
							사용자 질문 · MCP 탐색·호출
							<br />
							파일·명령 · Python 커널
						</p>
					</div>
				</nav>
				<section className="library-content">
					{error && (
						<p className="banner error" role="alert">
							{error}
						</p>
					)}
					{message && (
						<p className="notice" role="status">
							{message}
						</p>
					)}
					{(dirty || data?.reloadRequired) && (
						<div className="library-apply">
							<span>Skills·플러그인 변경을 새 연결에 적용합니다. 현재 대화는 보존됩니다.</span>
							<button
								type="button"
								disabled={pending || !canApply}
								onClick={() =>
									void work(async () => {
										await apply();
										setDirty(false);
										setData(await request("capability.list", undefined));
										setMessage("현재 대화에 변경을 적용했습니다. 사이드 채팅은 다시 연결할 때 반영됩니다.");
									})
								}
							>
								지금 적용
							</button>
						</div>
					)}
					{login && (
						<div className="library-apply" role="status">
							<span>브라우저에서 로그인을 완료하세요.</span>
							<button
								type="button"
								onClick={() => {
									void request("capability.logoutMcp", { id: login })
										.then(setData)
										.catch(() => setError("로그인 취소에 실패했습니다."));
								}}
							>
								로그인 취소
							</button>
						</div>
					)}
					{edit ? (
						<McpEditor
							key={edit.id}
							initial={edit}
							exists={data?.servers.some((s) => s.id === edit.id) ?? false}
							hasToken={data?.servers.find((s) => s.id === edit.id)?.hasToken ?? false}
							disabled={pending}
							cancel={() => setEdit(undefined)}
							save={(server, token) =>
								void work(async () => {
									setData(
										await request("capability.saveMcp", {
											server,
											...(token !== undefined ? { token } : {}),
										}),
									);
									setEdit(undefined);
									setMessage("연결 설정을 저장했습니다. 연결 검사로 사용 가능한 도구를 확인하세요.");
								})
							}
						/>
					) : skill ? (
						<>
							<button type="button" className="text-button" onClick={() => setSkill(undefined)}>
								← Skills 목록
							</button>
							<h3>{skill.title}</h3>
							<div className="skill-document">
								<MarkdownMessage content={skill.content} />
							</div>
						</>
					) : tools ? (
						<>
							<button type="button" onClick={() => setTools(undefined)}>
								← MCP 연결
							</button>
							<h3>
								{tools.name} · 도구 {tools.items.length}개
							</h3>
							<p className="muted">
								서버에 연결해 도구 목록을 확인했습니다. 개별 작업 권한은 실행 시 확인됩니다.
							</p>
							{tools.items.map((tool) => (
								<details className="mcp-tool" key={tool.name}>
									<summary>{tool.name}</summary>
									<p>{tool.description}</p>
									<pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
								</details>
							))}
						</>
					) : (
						<>
							<div className="library-toolbar">
								<label className="library-search">
									<Icon name="search" />
									<input
										aria-label="확장 검색"
										placeholder="이름이나 작업으로 검색"
										value={query}
										onChange={(e) => setQuery(e.target.value)}
									/>
								</label>
								<button
									type="button"
									disabled={pending || !api}
									onClick={() =>
										tab === "mcp"
											? setEdit({
													id: `custom-${Date.now()}`,
													name: "",
													transport: "http",
													url: "",
													enabled: true,
												})
											: void work(async () => {
													setData(
														await request("capability.import", {
															kind: tab === "skills" ? "skill" : "plugin",
														}),
													);
													setDirty(true);
												})
									}
								>
									<Icon name="plus" />
									{tab === "mcp" ? "직접 연결" : "폴더에서 가져오기"}
								</button>
							</div>
							{!data && (
								<p className="library-empty">
									{api ? "확장 목록을 불러오는 중…" : "데스크톱 앱에서 확장을 관리할 수 있습니다."}
								</p>
							)}
							{tab === "skills" && (
								<>
									<h3>작업을 위한 기본 Skills</h3>
									<p className="muted">
										문서 도구는 첫 Python 커널 준비 시 설치됩니다. 직접 가져온 Skills는 내용을 확인한 뒤
										켜세요.
									</p>
									<div className="skill-grid">
										{data?.skills
											.filter((s) => match(`${s.name} ${s.description} ${SKILL_TITLES[s.name] ?? ""}`))
											.map((s) => (
												<article className="skill-tile" key={s.id}>
													<div className="tile-heading">
														<span className="capability-glyph">
															<Icon
																name={
																	s.name === "prime-browser"
																		? "browser"
																		: s.name === "prime-coding"
																			? "terminal"
																			: "file"
																}
															/>
														</span>
														<label className="capability-switch">
															<input
																type="checkbox"
																aria-label={`${SKILL_TITLES[s.name] ?? s.name} 활성화`}
																checked={s.enabled}
																disabled={pending || !!s.pluginId}
																onChange={(e) =>
																	void work(async () => {
																		setData(
																			await request("capability.toggle", {
																				kind: "skill",
																				id: s.id,
																				enabled: e.target.checked,
																			}),
																		);
																		setDirty(true);
																	})
																}
															/>
															<span />
														</label>
													</div>
													<h4>{SKILL_TITLES[s.name] ?? s.name}</h4>
													<p>{SKILL_SUMMARIES[s.name] ?? s.description}</p>
													<footer>
														<span>
															{s.source === "builtin" ? "기본 제공" : s.pluginId ? "플러그인" : "가져옴"}
														</span>
														<button
															type="button"
															disabled={pending}
															onClick={() =>
																void work(async () =>
																	setSkill({
																		title: SKILL_TITLES[s.name] ?? s.name,
																		content: await request("capability.readSkill", { id: s.id }),
																	}),
																)
															}
														>
															내용 보기
														</button>
														<button
															type="button"
															disabled={!s.enabled}
															onClick={() => {
																insert(`/skill:${s.name} `);
																close();
															}}
														>
															사용
														</button>
														{s.source === "imported" && !s.pluginId && (
															<button
																type="button"
																disabled={pending}
																onClick={() =>
																	void work(async () => {
																		setData(
																			await request("capability.remove", {
																				kind: "skill",
																				id: s.id,
																			}),
																		);
																		setDirty(true);
																	})
																}
															>
																제거
															</button>
														)}
													</footer>
												</article>
											))}
									</div>
								</>
							)}
							{tab === "mcp" && (
								<>
									<h3>내 연결</h3>
									{!data?.servers.length && (
										<p className="library-empty">아래 서비스에서 연결을 추가하세요.</p>
									)}
									{data?.servers
										.filter((s) => match(s.name))
										.map((s) => (
											<article className="connection-row" key={s.id}>
												<span className="capability-glyph">
													<Icon name="browser" />
												</span>
												<div>
													<strong>{s.name}</strong>
													<p className={s.status === "error" ? "message-error" : "muted"}>
														{statuses[s.status]}
														{s.toolCount !== undefined ? ` · 도구 ${s.toolCount}개` : ""}
														{s.hasOAuth ? " · OAuth 저장됨" : s.hasToken ? " · 토큰 저장됨" : ""}
													</p>
													{s.error && <small>{s.error}</small>}
												</div>
												<div className="connection-actions">
													<button type="button" disabled={pending} onClick={() => setEdit(cleanServer(s))}>
														설정
													</button>
													<button
														type="button"
														disabled={pending || !s.enabled}
														onClick={() =>
															void work(async () => {
																const items = await request("capability.testMcp", { id: s.id });
																setData(await request("capability.list", undefined));
																setTools({ name: s.name, items });
															})
														}
													>
														연결 검사
													</button>
													{s.oauth && (
														<button
															type="button"
															disabled={pending || !!login}
															onClick={() => {
																setLogin(s.id);
																setError("");
																void request("capability.loginMcp", { id: s.id })
																	.then(setData)
																	.catch((e) =>
																		setError(e instanceof Error ? e.message : "로그인 실패"),
																	)
																	.finally(() => setLogin(undefined));
															}}
														>
															OAuth 로그인
														</button>
													)}
													{s.hasOAuth && (
														<button
															type="button"
															disabled={pending}
															onClick={() =>
																void work(async () =>
																	setData(await request("capability.logoutMcp", { id: s.id })),
																)
															}
														>
															로그아웃
														</button>
													)}
													<button
														type="button"
														disabled={pending}
														onClick={() =>
															void work(async () =>
																setData(
																	await request("capability.saveMcp", {
																		server: { ...cleanServer(s), enabled: !s.enabled },
																	}),
																),
															)
														}
													>
														{s.enabled ? "끄기" : "켜기"}
													</button>
													<button
														type="button"
														disabled={pending}
														onClick={() =>
															void work(async () =>
																setData(await request("capability.removeMcp", { id: s.id })),
															)
														}
													>
														제거
													</button>
												</div>
											</article>
										))}
									<h3 className="catalog-heading">서비스 둘러보기</h3>
									<p className="muted">공식 연결 설정을 준비했습니다. 계정·권한 설정은 서비스마다 다릅니다.</p>
									<div className="skill-grid">
										{CONNECTION_TEMPLATES.filter((t) =>
											match(`${t.config.name} ${t.category} ${t.description}`),
										).map((t) => (
											<article className="skill-tile" key={t.config.id}>
												<div className="tile-heading">
													<span className="eyebrow">{t.category}</span>
													<Icon name="browser" />
												</div>
												<h4>{t.config.name}</h4>
												<p>{t.description}</p>
												<small>{t.setup}</small>
												<footer>
													<button
														type="button"
														onClick={() =>
															void work(async () => {
																await request("capability.openDocs", { id: t.config.id });
															})
														}
													>
														공식 안내 ↗
													</button>
													<button
														type="button"
														disabled={pending || data?.servers.some((s) => s.id === t.config.id)}
														onClick={() => setEdit(t.config)}
													>
														{data?.servers.some((s) => s.id === t.config.id) ? "추가됨" : "연결 설정"}
													</button>
												</footer>
											</article>
										))}
									</div>
								</>
							)}
							{tab === "plugins" && (
								<>
									<h3>내 플러그인</h3>
									<p className="muted">
										Prime 패키지의 Skills와 실행 확장을 함께 관리합니다. 가져온 패키지는 꺼진 상태로
										추가됩니다.
									</p>
									<article className="connection-row">
										<span className="capability-glyph">
											<Icon name="plugin" />
										</span>
										<div>
											<strong>Prime Desktop Essentials</strong>
											<p className="muted">15개 기본 Skills · 사용자 질문 · MCP 도구 연결</p>
										</div>
										<span className="builtin-badge">앱 내장</span>
									</article>
									{data?.plugins.map((p) => (
										<article className="connection-row" key={p.id}>
											<span className="capability-glyph">
												<Icon name="plugin" />
											</span>
											<div>
												<strong>{p.name}</strong>
												<button
													type="button"
													disabled={pending}
													onClick={() =>
														void work(async () =>
															setSkill({
																title: p.name,
																content:
																	"```text\n" +
																	(await request("capability.readPlugin", { id: p.id })) +
																	"\n```",
															}),
														)
													}
												>
													패키지 내용 보기
												</button>
												<p className="muted">
													{p.version} · Skills {p.skills} · 실행 확장 {p.extensions}
												</p>
											</div>
											<button
												type="button"
												disabled={pending}
												onClick={() =>
													void work(async () => {
														setData(
															await request("capability.toggle", {
																kind: "plugin",
																id: p.id,
																enabled: !p.enabled,
															}),
														);
														setDirty(true);
													})
												}
											>
												{p.enabled ? "끄기" : "내용을 검토했으며 켜기"}
											</button>
											<button
												type="button"
												disabled={pending}
												onClick={() =>
													void work(async () => {
														setData(await request("capability.remove", { kind: "plugin", id: p.id }));
														setDirty(true);
													})
												}
											>
												제거
											</button>
										</article>
									))}
									<details className="plugin-help">
										<summary>플러그인 폴더 구성</summary>
										<p>
											package.json에 로드할 파일을 명시하세요. 의존성을 포함해 미리 번들된 확장 파일을 사용할
											수 있습니다. 가져오기는 설치 스크립트를 실행하지 않습니다.
										</p>
										<pre>
											{
												'{\n  "name": "my-prime-plugin",\n  "version": "1.0.0",\n  "pi": {\n    "skills": ["skills/my-skill"],\n    "extensions": ["extension.mjs"]\n  }\n}'
											}
										</pre>
									</details>
								</>
							)}
						</>
					)}
				</section>
			</div>
		</dialog>
	);
}
function McpEditor({
	initial,
	exists,
	hasToken,
	disabled,
	cancel,
	save,
}: {
	initial: McpServerConfig;
	exists: boolean;
	hasToken: boolean;
	disabled: boolean;
	cancel(): void;
	save(server: McpServerConfig, token?: string): void;
}) {
	const [name, setName] = useState(initial.name),
		[id, setId] = useState(initial.id),
		[transport, setTransport] = useState(initial.transport);
	const [url, setUrl] = useState(initial.url ?? ""),
		[command, setCommand] = useState(initial.command ?? ""),
		[args, setArgs] = useState(JSON.stringify(initial.args ?? [])),
		[env, setEnv] = useState(JSON.stringify(initial.env ?? {}, null, 2));
	const [tokenEnv, setTokenEnv] = useState(initial.tokenEnv ?? ""),
		[token, setToken] = useState(""),
		[clearToken, setClearToken] = useState(false),
		[oauth, setOauth] = useState(initial.oauth ?? false),
		[clientId, setClientId] = useState(initial.clientId ?? "");
	const [error, setError] = useState("");
	return (
		<form
			className="mcp-editor"
			onSubmit={(e) => {
				e.preventDefault();
				setError("");
				try {
					const server: McpServerConfig = {
						id: id.trim(),
						name: name.trim(),
						transport,
						enabled: initial.enabled,
						...(transport === "http"
							? {
									url: url.trim(),
									...(oauth
										? { oauth: true, ...(clientId.trim() ? { clientId: clientId.trim() } : {}) }
										: tokenEnv.trim()
											? { tokenEnv: tokenEnv.trim() }
											: {}),
								}
							: { command: command.trim(), args: JSON.parse(args), env: JSON.parse(env) }),
					};
					save(server, clearToken || oauth ? "" : token || undefined);
				} catch {
					setError("인자와 환경변수에 올바른 JSON을 입력하세요.");
				}
			}}
		>
			<button type="button" className="text-button" onClick={cancel}>
				← 연결 목록
			</button>
			<h3>{exists ? "연결 설정" : "새 MCP 연결"}</h3>
			<label>
				연결 이름
				<input
					aria-label="연결 이름"
					value={name}
					onChange={(e) => setName(e.target.value)}
					required
					maxLength={120}
				/>
			</label>
			<label>
				연결 ID
				<input aria-label="연결 ID" value={id} disabled={exists} onChange={(e) => setId(e.target.value)} required />
			</label>
			<label>
				연결 방식
				<select
					aria-label="연결 방식"
					value={transport}
					onChange={(e) => setTransport(e.target.value as "http" | "stdio")}
				>
					<option value="http">원격 서버 · HTTP</option>
					<option value="stdio">로컬 서버 · stdio</option>
				</select>
			</label>
			{transport === "http" ? (
				<>
					<label>
						서버 주소
						<input
							aria-label="서버 주소"
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							placeholder="https://example.com/mcp"
							required
						/>
					</label>
					<label className="checkbox-label">
						<input type="checkbox" checked={oauth} onChange={(e) => setOauth(e.target.checked)} />
						OAuth 브라우저 로그인 사용
					</label>
					{oauth ? (
						<>
							<p className="muted">
								저장한 다음 OAuth 로그인을 누르세요. 자동 클라이언트 등록(DCR)을 지원하는 서버에서 사용할 수
								있습니다.
							</p>
							<label>
								OAuth Client ID (사전 등록한 경우)
								<input value={clientId} onChange={(e) => setClientId(e.target.value)} />
							</label>
						</>
					) : (
						<>
							<label>
								액세스 토큰
								<input
									aria-label="액세스 토큰"
									type="password"
									autoComplete="off"
									value={token}
									onChange={(e) => setToken(e.target.value)}
									placeholder={hasToken ? "저장된 토큰 유지 · 변경하려면 입력" : "필요한 경우 입력"}
								/>
							</label>
							{hasToken && (
								<label className="checkbox-label">
									<input
										type="checkbox"
										checked={clearToken}
										onChange={(e) => setClearToken(e.target.checked)}
									/>
									저장된 토큰 지우기
								</label>
							)}
							<label>
								또는 토큰 환경변수 이름
								<input
									value={tokenEnv}
									onChange={(e) => setTokenEnv(e.target.value)}
									placeholder="SERVICE_TOKEN"
								/>
							</label>
							<p className="muted">
								토큰은 운영체제 암호화 저장소로 보호합니다. 환경변수는 앱 실행 환경에서 읽습니다.
							</p>
						</>
					)}
				</>
			) : (
				<>
					<label>
						실행 파일
						<input
							aria-label="실행 파일"
							value={command}
							onChange={(e) => setCommand(e.target.value)}
							placeholder="/absolute/path/to/server"
							required
						/>
					</label>
					<label>
						명령 인자 (JSON 배열)
						<textarea aria-label="명령 인자" value={args} onChange={(e) => setArgs(e.target.value)} rows={3} />
					</label>
					<label>
						환경변수 매핑 (서버 변수: 이 기기의 변수 이름)
						<textarea aria-label="환경변수 매핑" value={env} onChange={(e) => setEnv(e.target.value)} rows={3} />
					</label>
					<p className="muted">
						예: {`{"API_KEY":"MY_SERVICE_KEY"}`}. 비밀값을 직접 넣지 마세요. 연결 검사·사용 시 지정한 프로그램이
						실행됩니다.
					</p>
				</>
			)}
			{error && (
				<p role="alert" className="message-error">
					{error}
				</p>
			)}
			<div className="button-row">
				<button type="submit" className="primary" disabled={disabled}>
					{disabled ? "저장 중…" : "연결 저장"}
				</button>
				<button type="button" disabled={disabled} onClick={cancel}>
					취소
				</button>
			</div>
		</form>
	);
}
