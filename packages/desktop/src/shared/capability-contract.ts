export interface McpServerConfig {
	id: string;
	name: string;
	transport: "http" | "stdio";
	url?: string;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	tokenEnv?: string;
	oauth?: boolean;
	clientId?: string;
	enabled: boolean;
}
export interface SkillEntry {
	id: string;
	name: string;
	description: string;
	enabled: boolean;
	source: "builtin" | "imported";
	pluginId?: string;
}
export interface PluginEntry {
	id: string;
	name: string;
	version: string;
	enabled: boolean;
	skills: number;
	extensions: number;
}
export interface McpServerView extends McpServerConfig {
	hasToken: boolean;
	hasOAuth: boolean;
	status: "configured" | "connected" | "error" | "disabled";
	toolCount?: number;
	error?: string;
}
export interface CapabilitySnapshot {
	reloadRequired?: boolean;
	skills: SkillEntry[];
	plugins: PluginEntry[];
	servers: McpServerView[];
	revision: number;
}
export interface McpToolView {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}
export interface CapabilityRequests {
	"capability.openDocs": { input: { id: string }; output: undefined };
	"capability.list": { input: undefined; output: CapabilitySnapshot };
	"capability.toggle": {
		input: { kind: "skill" | "plugin"; id: string; enabled: boolean };
		output: CapabilitySnapshot;
	};
	"capability.import": { input: { kind: "skill" | "plugin" }; output: CapabilitySnapshot };
	"capability.remove": { input: { kind: "skill" | "plugin"; id: string }; output: CapabilitySnapshot };
	"capability.readPlugin": { input: { id: string }; output: string };
	"capability.readSkill": { input: { id: string }; output: string };
	"capability.saveMcp": { input: { server: McpServerConfig; token?: string }; output: CapabilitySnapshot };
	"capability.removeMcp": { input: { id: string }; output: CapabilitySnapshot };
	"capability.loginMcp": { input: { id: string }; output: CapabilitySnapshot };
	"capability.logoutMcp": { input: { id: string }; output: CapabilitySnapshot };
	"capability.testMcp": { input: { id: string }; output: McpToolView[] };
}
export type CapabilityRequestName = keyof CapabilityRequests;
function obj(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("확장 설정 형식이 올바르지 않습니다.");
	return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
	if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("지원하지 않는 확장 설정입니다.");
}
export function validId(value: unknown): asserts value is string {
	if (
		typeof value !== "string" ||
		!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(value) ||
		["__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty"].includes(value)
	)
		throw new Error("확장 ID가 올바르지 않습니다.");
}
function string(value: unknown, max = 4096): asserts value is string {
	if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0"))
		throw new Error("확장 설정 값을 확인하세요.");
}
export function validateMcpConfig(value: unknown): asserts value is McpServerConfig {
	const s = obj(value);
	keys(s, ["id", "name", "transport", "url", "command", "args", "env", "tokenEnv", "enabled", "oauth", "clientId"]);
	if (s.oauth !== undefined && typeof s.oauth !== "boolean") throw new Error("OAuth 설정을 확인하세요.");
	if (s.clientId !== undefined) string(s.clientId, 512);
	if (s.oauth && (s.transport !== "http" || s.tokenEnv))
		throw new Error("OAuth는 HTTP 연결에서 사용합니다. 토큰 환경변수를 함께 지정할 수 없습니다.");
	validId(s.id);
	string(s.name, 120);
	if (typeof s.enabled !== "boolean") throw new Error("활성화 설정을 확인하세요.");
	if (s.transport === "http") {
		string(s.url);
		const url = new URL(s.url);
		if (
			(url.protocol !== "https:" &&
				!(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) ||
			url.username ||
			url.password ||
			url.hash
		)
			throw new Error("HTTPS 주소 또는 로컬 HTTP 주소를 입력하세요. 인증은 토큰 필드를 사용하세요.");
		if (s.command !== undefined || s.args !== undefined || s.env !== undefined)
			throw new Error("HTTP 연결에 실행 명령을 지정할 수 없습니다.");
	} else if (s.transport === "stdio") {
		string(s.command);
		if (
			!Array.isArray(s.args) ||
			s.args.length > 64 ||
			s.args.some((arg) => typeof arg !== "string" || arg.length > 4096 || arg.includes("\0"))
		)
			throw new Error("명령 인자는 문자열 배열이어야 합니다.");
		if (s.url !== undefined || s.tokenEnv !== undefined) throw new Error("stdio는 환경변수 매핑을 사용하세요.");
		if (s.env !== undefined) {
			const env = obj(s.env);
			if (
				Object.keys(env).length > 32 ||
				Object.entries(env).some(
					([key, val]) =>
						!/^[A-Z_][A-Z0-9_]*$/.test(key) || typeof val !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(val),
				)
			)
				throw new Error("환경변수는 이름 대 이름으로 매핑하세요.");
		}
	} else throw new Error("HTTP 또는 stdio 연결을 선택하세요.");
	if (s.tokenEnv !== undefined && (typeof s.tokenEnv !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(s.tokenEnv)))
		throw new Error("토큰 환경변수 이름을 확인하세요.");
}
export function validateCapabilityRequest(name: string, input: unknown): asserts name is CapabilityRequestName {
	if (name === "capability.list") {
		if (input !== undefined) throw new Error("인자가 필요하지 않습니다.");
		return;
	}
	const v = obj(input);
	switch (name) {
		case "capability.toggle":
			keys(v, ["kind", "id", "enabled"]);
			validId(v.id);
			if (typeof v.enabled !== "boolean") throw new Error("활성화 값을 확인하세요.");
			if (v.kind !== "skill" && v.kind !== "plugin") throw new Error("확장 종류를 확인하세요.");
			return;
		case "capability.import":
		case "capability.remove":
			keys(v, name === "capability.import" ? ["kind"] : ["kind", "id"]);
			if (name === "capability.remove") validId(v.id);
			if (v.kind !== "skill" && v.kind !== "plugin") throw new Error("확장 종류를 확인하세요.");
			return;
		case "capability.readPlugin":
		case "capability.readSkill":
		case "capability.removeMcp":
		case "capability.loginMcp":
		case "capability.logoutMcp":
		case "capability.testMcp":
		case "capability.openDocs":
			keys(v, ["id"]);
			validId(v.id);
			return;
		case "capability.saveMcp":
			keys(v, ["server", "token"]);
			validateMcpConfig(v.server);
			if (
				v.token !== undefined &&
				(typeof v.token !== "string" || v.token.length > 16384 || /[\r\n\0]/.test(v.token))
			)
				throw new Error("토큰 형식이 올바르지 않습니다.");
			if (obj(v.server).transport === "stdio" && v.token) throw new Error("stdio는 환경변수 매핑을 사용하세요.");
			return;
		default:
			throw new Error("허용되지 않은 확장 요청입니다.");
	}
}
