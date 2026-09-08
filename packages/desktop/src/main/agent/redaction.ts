export class Redactor {
	private secrets: string[];
	constructor(env: NodeJS.ProcessEnv = process.env) {
		this.secrets = Object.entries(env)
			.filter(
				([key, value]) =>
					/key|token|secret|password|authorization|credential/i.test(key) && value && value.length >= 6,
			)
			.map(([, value]) => value as string)
			.sort((a, b) => b.length - a.length);
	}
	text(value: string): string {
		let result = value;
		for (const secret of this.secrets) result = result.split(secret).join("[REDACTED]");
		return result
			.replace(/\b(?:sk|sk-ant|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}/g, "[REDACTED]")
			.replace(/(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]")
			.replace(
				/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi,
				"$1[REDACTED]",
			)
			.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]");
	}
	error(error: unknown): string {
		return this.text(error instanceof Error ? error.message : "알 수 없는 오류입니다.");
	}
}
