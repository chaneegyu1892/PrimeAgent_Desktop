// This dependency-free extension runs in the user's external Prime CLI, not Electron.
// Keep the structural contract limited to the public registerTool / ctx.ui API.
export interface Question {
	kind: "select" | "confirm" | "input" | "editor";
	question: string;
	options?: string[];
	message?: string;
	prefill?: string;
}
export interface QuestionContext {
	hasUI: boolean;
	ui: {
		select(title: string, options: string[], opts?: { signal?: AbortSignal }): Promise<string | undefined>;
		confirm(title: string, message: string, opts?: { signal?: AbortSignal }): Promise<boolean>;
		input(title: string, placeholder?: string, opts?: { signal?: AbortSignal }): Promise<string | undefined>;
		editor(title: string, prefill?: string): Promise<string | undefined>;
	};
}

const result = (details: Record<string, unknown>) => ({
	content: [{ type: "text" as const, text: JSON.stringify(details) }],
	details,
});

export const askUserTool = {
	name: "desktop_ask_user",
	label: "사용자에게 질문",
	description:
		"Ask the user a meaningful question in Prime Desktop and wait for their answer. Supports select (with a free-text alternative), confirm, input, and editor. Use the user's language. Cancellation or a negative confirmation never authorizes an action.",
	promptSnippet: "Ask the user for a choice, clarification, confirmation, or edited text in Desktop.",
	promptGuidelines: [
		"Use desktop_ask_user when a decision or missing information actually requires the user; continue authorized independent work without unnecessary questions.",
		"Wait for the tool result before work that depends on the answer. A cancelled, unavailable, or not-approved result is not permission. Do not repeatedly ask the same declined question.",
	],
	executionMode: "sequential" as const,
	parameters: {
		type: "object",
		properties: {
			kind: { type: "string", enum: ["select", "confirm", "input", "editor"] },
			question: {
				type: "string",
				minLength: 1,
				maxLength: 10000,
				description: "Complete question in the user's language.",
			},
			options: {
				type: "array",
				minItems: 1,
				maxItems: 12,
				items: { type: "string", minLength: 1, maxLength: 1000 },
				description: "Required for select. Free-text entry is added automatically.",
			},
			message: { type: "string", maxLength: 10000, description: "Confirmation context or input hint." },
			prefill: {
				type: "string",
				maxLength: 100000,
				description: "Initial text for editor; not an automatically submitted answer.",
			},
		},
		required: ["kind", "question"],
		additionalProperties: false,
	},
	async execute(
		_id: string,
		params: Question,
		signal: AbortSignal | undefined,
		_update: unknown,
		ctx: QuestionContext,
	) {
		if (!ctx.hasUI)
			return result({
				status: "unavailable",
				message: "Interactive Desktop UI is required. No answer or approval was given.",
			});
		if (signal?.aborted) return result({ status: "cancelled" });
		if (!params.question?.trim()) throw new Error("A complete question is required.");
		const opts = { signal };
		let answer: string | undefined;
		switch (params.kind) {
			case "select": {
				if (
					!params.options?.length ||
					params.options.length > 12 ||
					params.options.some((option) => !option.trim())
				)
					throw new Error("Select requires 1–12 non-empty options.");
				let custom = "직접 입력";
				while (params.options.includes(custom)) custom += "…";
				answer = await ctx.ui.select(params.question, [...params.options, custom], opts);
				if (answer === custom && !signal?.aborted)
					answer = await ctx.ui.input(params.question, "원하는 답변을 입력하세요", opts);
				break;
			}
			case "confirm": {
				const confirmed = await ctx.ui.confirm(params.question, params.message ?? "", opts);
				// The CLI maps both Cancel and No to false; never infer approval from either.
				return signal?.aborted
					? result({ status: "cancelled" })
					: result({ status: confirmed ? "answered" : "not_approved", confirmed });
			}
			case "input":
				answer = await ctx.ui.input(params.question, params.message, opts);
				break;
			case "editor":
				answer = await ctx.ui.editor(params.question, params.prefill);
				break;
			default:
				throw new Error("Unsupported question kind.");
		}
		return signal?.aborted || answer === undefined
			? result({ status: "cancelled" })
			: result({ status: "answered", answer });
	},
};

export default function desktopQuestions(pi: { registerTool(tool: typeof askUserTool): void }) {
	pi.registerTool(askUserTool);
}
