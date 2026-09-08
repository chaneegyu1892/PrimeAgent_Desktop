import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parseDocument } from "yaml";
import {
	type CapabilitySnapshot,
	type McpServerConfig,
	type PluginEntry,
	type SkillEntry,
	validateMcpConfig,
} from "../../shared/capability-contract";
import type { OAuthSaved } from "./mcp-oauth";

interface LocalSkill extends SkillEntry {
	path: string;
}
interface LocalPlugin extends PluginEntry {
	path: string;
	skillPaths: string[];
	extensionPaths: string[];
}
interface Config {
	disabled: string[];
	skills: LocalSkill[];
	plugins: LocalPlugin[];
	servers: McpServerConfig[];
	secrets: Record<string, string>;
	oauth?: Record<string, string>;
}
export interface SecretCodec {
	encrypt(text: string): string;
	decrypt(text: string): string;
}
const empty = (): Config => ({ disabled: [], skills: [], plugins: [], servers: [], secrets: {} });
const metadata = (text: string, fallback: string) => {
	const header = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!header) throw new Error("SKILL.md에 name과 description을 포함한 frontmatter가 필요합니다.");
	const document = parseDocument(header[1]);
	if (document.errors.length) throw new Error("SKILL.md YAML 형식을 확인하세요.");
	const fields = document.toJS({ maxAliasCount: 20 }) as Record<string, unknown>;
	const name = typeof fields?.name === "string" ? fields.name : fallback;
	const description = typeof fields?.description === "string" ? fields.description.trim() : undefined;
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64 || !description || description.length > 1024)
		throw new Error("Skill 이름 또는 설명을 확인하세요.");
	return { name, description };
};
async function skillText(path: string) {
	const file = join(path, "SKILL.md");
	if ((await lstat(file)).size > 100_000) throw new Error("SKILL.md는 100 KB 이하여야 합니다.");
	return readFile(file, "utf8");
}
async function checkedTree(root: string): Promise<void> {
	let bytes = 0,
		files = 0;
	const walk = async (path: string): Promise<void> => {
		for (const file of await readdir(path, { withFileTypes: true })) {
			if ([".git", "node_modules", ".venv", "__pycache__"].includes(file.name))
				throw new Error("배포 폴더만 선택하세요. .git, node_modules, 가상환경은 포함할 수 없습니다.");
			const child = join(path, file.name),
				stat = await lstat(child);
			if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
				throw new Error("심볼릭 링크와 특수 파일은 가져올 수 없습니다.");
			bytes += stat.size;
			files++;
			if (files > 1000 || bytes > 20 * 1024 * 1024)
				throw new Error("확장은 최대 1,000개 파일, 20 MB까지 가져올 수 있습니다.");
			if (stat.isDirectory()) await walk(child);
		}
	};
	await walk(root);
}
export class CapabilityStore {
	private config = empty();
	private builtins: LocalSkill[] = [];
	private revision = 0;
	skillRevision = 0;
	private tail = Promise.resolve();
	private failed = false;
	constructor(
		readonly root: string,
		private builtinRoot: string,
		private codec: SecretCodec,
	) {}
	async load() {
		for (const entry of await readdir(this.builtinRoot, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const path = join(this.builtinRoot, entry.name);
			this.builtins.push({
				id: entry.name,
				...metadata(await skillText(path), entry.name),
				path,
				source: "builtin",
				enabled: true,
			});
		}
		try {
			const raw: unknown = JSON.parse(await readFile(join(this.root, "capabilities.json"), "utf8"));
			if (!raw || typeof raw !== "object") throw new Error("invalid config");
			const config = raw as Config;
			if (
				!Array.isArray(config.disabled) ||
				!Array.isArray(config.skills) ||
				!Array.isArray(config.plugins) ||
				!Array.isArray(config.servers) ||
				!config.secrets ||
				config.servers.length > 50
			)
				throw new Error("invalid config");
			config.servers.forEach(validateMcpConfig);
			for (const item of [...config.skills, ...config.plugins]) {
				if (!item.id || !item.path || !this.inside(item.path) || typeof item.enabled !== "boolean")
					throw new Error("invalid imported path");
			}
			this.config = config;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				this.failed = true;
				throw new Error("확장 설정을 읽지 못했습니다. 기존 파일을 보존했습니다.");
			}
		}
		const installed = join(this.root, "installed");
		const retained = new Set(
			[...this.config.skills, ...this.config.plugins].map((item) => relative(installed, item.path).split("/")[0]),
		);
		for (const entry of await readdir(installed).catch(() => [] as string[])) {
			if (/^local-[a-f0-9-]+$/.test(entry) && !retained.has(entry))
				await rm(join(installed, entry), { recursive: true, force: true });
		}
	}
	private inside(path: string) {
		const rel = relative(join(this.root, "installed"), resolve(path));
		return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
	}
	get servers() {
		return structuredClone(this.config.servers);
	}
	oauth(id: string): OAuthSaved | undefined {
		const value = this.config.oauth?.[id];
		return value ? (JSON.parse(this.codec.decrypt(value)) as OAuthSaved) : undefined;
	}
	async saveOAuth(id: string, data: OAuthSaved | undefined) {
		await this.change((c) => {
			c.oauth ??= {};
			if (data) c.oauth[id] = this.codec.encrypt(JSON.stringify(data));
			else delete c.oauth[id];
		});
	}
	token(id: string) {
		const value = this.config.secrets[id];
		return value ? this.codec.decrypt(value) : undefined;
	}
	private change(work: (config: Config) => Promise<void> | void): Promise<void> {
		const next = this.tail.then(async () => {
			if (this.failed) throw new Error("확장 설정을 복구한 뒤 앱을 다시 실행하세요.");
			const copy = structuredClone(this.config);
			await work(copy);
			await mkdir(this.root, { recursive: true });
			await writeFile(join(this.root, "capabilities.json.tmp"), JSON.stringify(copy, null, 2), { mode: 0o600 });
			await rename(join(this.root, "capabilities.json.tmp"), join(this.root, "capabilities.json"));
			this.config = copy;
			this.revision++;
		});
		this.tail = next.catch(() => {});
		return next;
	}
	private skills(): LocalSkill[] {
		return [...this.builtins, ...this.config.skills].map((skill) => ({
			...skill,
			enabled:
				!this.config.disabled.includes(skill.id) &&
				(!skill.pluginId || this.config.plugins.some((p) => p.id === skill.pluginId && p.enabled)),
		}));
	}
	snapshot(): CapabilitySnapshot {
		return {
			revision: this.revision,
			skills: this.skills().map(({ path: _path, ...skill }) => skill),
			plugins: this.config.plugins.map(
				({ path: _path, skillPaths: _skills, extensionPaths: _extensions, ...plugin }) => plugin,
			),
			servers: this.config.servers.map((server) => ({
				...server,
				hasToken: !!this.config.secrets[server.id],
				hasOAuth: !!this.config.oauth?.[server.id],
				status: server.enabled ? "configured" : "disabled",
			})),
		};
	}
	async launchArgs(): Promise<string[]> {
		if (this.failed) return [];
		const args: string[] = [];
		for (const skill of this.skills().filter((s) => s.enabled)) {
			await skillText(skill.path);
			args.push("--skill", skill.path);
		}
		for (const plugin of this.config.plugins.filter((p) => p.enabled))
			for (const path of plugin.extensionPaths) {
				const resolved = await realpath(path);
				if (!this.inside(resolved)) throw new Error("확장 실행 경로를 확인하세요.");
				args.push("--extension", resolved);
			}
		return args;
	}
	async readSkill(id: string) {
		const skill = this.skills().find((s) => s.id === id);
		if (!skill) throw new Error("Skill을 찾지 못했습니다.");
		return skillText(skill.path);
	}
	async readPlugin(id: string) {
		const plugin = this.config.plugins.find((p) => p.id === id);
		if (!plugin) throw new Error("플러그인을 찾지 못했습니다.");
		const sections = [await readFile(join(plugin.path, "package.json"), "utf8")];
		for (const path of plugin.extensionPaths) {
			const file = await realpath(path);
			if (!this.inside(file) || (await lstat(file)).size > 100000)
				throw new Error("확장 파일이 너무 큽니다. 원본 파일을 확인하세요.");
			sections.push(`\n\n--- ${relative(plugin.path, file)} ---\n${await readFile(file, "utf8")}`);
		}
		for (const path of plugin.skillPaths)
			sections.push(`\n\n--- ${relative(plugin.path, path)}/SKILL.md ---\n${await skillText(path)}`);
		return sections.join("\n").slice(0, 500000);
	}
	async toggle(kind: "skill" | "plugin", id: string, enabled: boolean) {
		this.skillRevision++;
		await this.change((c) => {
			if (kind === "skill") {
				if (!this.skills().some((s) => s.id === id)) throw new Error("Skill을 찾지 못했습니다.");
				c.disabled = enabled ? c.disabled.filter((key) => key !== id) : [...new Set([...c.disabled, id])];
			} else {
				const plugin = c.plugins.find((p) => p.id === id);
				if (!plugin) throw new Error("플러그인을 찾지 못했습니다.");
				plugin.enabled = enabled;
			}
		});
	}
	async saveMcp(server: McpServerConfig, token?: string) {
		validateMcpConfig(server);
		await this.change((c) => {
			const old = c.servers.find((s) => s.id === server.id);
			if (!old && c.servers.length >= 50) throw new Error("최대 50개 MCP 연결을 저장할 수 있습니다.");
			// Endpoint changes never forward a credential belonging to the previous endpoint.
			if (old && (old.url !== server.url || old.transport !== server.transport)) {
				delete c.secrets[server.id];
				if (c.oauth) delete c.oauth[server.id];
			}
			if (token !== undefined) {
				if (token) c.secrets[server.id] = this.codec.encrypt(token);
				else delete c.secrets[server.id];
			}
			c.servers = [...c.servers.filter((s) => s.id !== server.id), server];
		});
	}
	async removeMcp(id: string) {
		await this.change((c) => {
			c.servers = c.servers.filter((s) => s.id !== id);
			delete c.secrets[id];
			if (c.oauth) delete c.oauth[id];
		});
	}
	async importFolder(kind: "skill" | "plugin", selected: string) {
		this.skillRevision++;
		const source = await realpath(selected);
		await checkedTree(source);
		const id = `local-${randomUUID()}`,
			target = join(this.root, "installed", id);
		await mkdir(join(this.root, "installed"), { recursive: true });
		await cp(source, target, { recursive: true, errorOnExist: true, force: false });
		try {
			await checkedTree(target);
			if (kind === "skill") {
				const meta = metadata(await skillText(target), id);
				await this.change((c) => {
					if (this.skills().some((s) => s.name === meta.name))
						throw new Error("같은 이름의 Skill이 이미 있습니다.");
					c.skills.push({ id, ...meta, path: target, source: "imported", enabled: false });
					c.disabled.push(id);
				});
			} else {
				const manifest = JSON.parse(await readFile(join(target, "package.json"), "utf8")) as {
					name?: string;
					version?: string;
					pi?: { skills?: string[]; extensions?: string[] };
				};
				if (!manifest.name || typeof manifest.name !== "string" || manifest.name.length > 120 || !manifest.pi)
					throw new Error("pi.skills 또는 pi.extensions를 명시한 Prime 패키지가 필요합니다.");
				const paths = async (values: string[] | undefined, type: "skill" | "extension") => {
					if (values === undefined) return [];
					if (!Array.isArray(values) || values.length > 50) throw new Error("잘못된 패키지 경로 목록입니다.");
					return Promise.all(
						values.map(async (path) => {
							if (typeof path !== "string" || isAbsolute(path) || /[*?\0]/.test(path))
								throw new Error("패키지에는 명시적 상대 경로를 사용하세요.");
							const value = await realpath(resolve(target, path));
							if (!value.startsWith(`${target}/`)) throw new Error("패키지 바깥 경로는 허용되지 않습니다.");
							if (type === "skill") await skillText(value);
							else if (!(await lstat(value)).isFile() || !/\.(m?js|ts)$/.test(value))
								throw new Error("확장 파일을 확인하세요.");
							return value;
						}),
					);
				};
				const skillPaths = await paths(manifest.pi.skills, "skill"),
					extensionPaths = await paths(manifest.pi.extensions, "extension");
				if (!skillPaths.length && !extensionPaths.length) throw new Error("로드할 Skills 또는 확장이 없습니다.");
				const entries = await Promise.all(
					skillPaths.map(async (path, index) => ({
						id: `${id}-${index}`,
						...metadata(await skillText(path), id),
						path,
						pluginId: id,
						source: "imported" as const,
						enabled: true,
					})),
				);
				await this.change((c) => {
					const names = new Set(this.skills().map((s) => s.name));
					for (const skill of entries) {
						if (names.has(skill.name)) throw new Error("중복된 Skill 이름입니다.");
						names.add(skill.name);
					}
					c.skills.push(...entries);
					c.plugins.push({
						id,
						name: manifest.name!,
						version: typeof manifest.version === "string" ? manifest.version.slice(0, 100) : "local",
						path: target,
						skillPaths,
						extensionPaths,
						skills: entries.length,
						extensions: extensionPaths.length,
						enabled: false,
					});
				});
			}
		} catch (error) {
			await rm(target, { recursive: true, force: true });
			throw error;
		}
	}
	async remove(kind: "skill" | "plugin", id: string) {
		this.skillRevision++;
		const item =
			kind === "skill"
				? this.config.skills.find((s) => s.id === id && !s.pluginId)
				: this.config.plugins.find((p) => p.id === id);
		if (!item || !this.inside(item.path))
			throw new Error("기본 Skill과 플러그인 내부 Skill은 개별 제거할 수 없습니다.");
		await this.change((c) => {
			c.skills = c.skills.filter((s) => s.id !== id && s.pluginId !== id);
			c.plugins = c.plugins.filter((p) => p.id !== id);
			c.disabled = c.disabled.filter((key) => key !== id && !key.startsWith(`${id}-`));
		});
		// Keep copied payload until process exit: an active agent may still be reading it.
	}
}
