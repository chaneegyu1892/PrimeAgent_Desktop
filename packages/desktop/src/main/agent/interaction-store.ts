import { randomUUID } from "node:crypto";
import type { Interaction, InteractionReply } from "../../shared/interactions";
import { validateInteractionReply } from "../../shared/interactions";
import type { RpcCommand } from "./agent-transport";
import type { Redactor } from "./redaction";

type Reply = Extract<RpcCommand, { type: "extension_ui_response" }>;
interface Entry {
	view: Interaction;
	rawId: string;
	options: string[];
	timer?: NodeJS.Timeout;
}
export class InteractionStore {
	private entries: Entry[] = [];
	constructor(
		private send: (reply: Reply) => Promise<unknown>,
		private changed: () => void,
		private redactor: Redactor,
	) {}
	get value(): Interaction[] {
		return this.entries.map((entry) => structuredClone(entry.view));
	}
	get waiting(): boolean {
		return this.entries.some((entry) => entry.view.status === "pending" || entry.view.status === "sending");
	}
	accept(data: Record<string, unknown>): void {
		const rawId = data.id;
		if (typeof rawId !== "string" || !rawId || rawId.length > 512)
			throw new Error("입력 요청 ID가 올바르지 않습니다.");
		if (this.entries.some((entry) => entry.rawId === rawId)) return;
		const method = data.method;
		if (!["select", "confirm", "input", "editor"].includes(String(method))) return;
		const strings = [data.title, data.message, data.prefill, data.placeholder];
		if (strings.some((value) => value !== undefined && (typeof value !== "string" || value.length > 100_000)))
			throw new Error("입력 요청 크기가 너무 큽니다.");
		const options = method === "select" ? data.options : [];
		if (
			!Array.isArray(options) ||
			!options.every((value) => typeof value === "string" && value.length <= 10_000) ||
			(method === "select" && (!options.length || options.length > 200))
		)
			throw new Error("선택지 형식이 올바르지 않습니다.");
		if (this.entries.filter((entry) => entry.view.status === "pending").length >= 16)
			throw new Error("동시에 처리할 입력 요청이 너무 많습니다.");
		const text = (value: unknown) => (typeof value === "string" ? this.redactor.text(value) : "");
		const timeout =
			typeof data.timeout === "number" && Number.isFinite(data.timeout) && data.timeout > 0
				? Math.min(data.timeout, 2_147_483_647)
				: undefined;
		const entry: Entry = {
			rawId,
			options,
			view: {
				id: randomUUID(),
				method: method as Interaction["method"],
				title: text(data.title) || "입력 요청",
				message: text(data.message),
				options: options.map(text),
				prefill: text(data.prefill),
				placeholder: text(data.placeholder),
				status: "pending",
				...(timeout ? { expiresAt: Date.now() + timeout } : {}),
			},
		};
		this.entries.push(entry);
		while (this.entries.length > 50) {
			const index = this.entries.findIndex((item) => !["pending", "sending"].includes(item.view.status));
			if (index < 0) break;
			this.entries.splice(index, 1);
		}
		if (timeout)
			entry.timer = setTimeout(() => {
				void this.expire(entry);
			}, timeout);
		this.changed();
	}
	private async expire(entry: Entry): Promise<void> {
		if (entry.view.status !== "pending") return;
		entry.view.status = "expired";
		this.changed();
		await this.send({ type: "extension_ui_response", id: entry.rawId, cancelled: true }).catch(() => {});
	}
	async respond(input: InteractionReply): Promise<void> {
		validateInteractionReply(input);
		const entry = this.entries.find((entry) => entry.view.id === input.id);
		if (!entry || entry.view.status !== "pending") throw new Error("이미 처리되었거나 종료된 요청입니다.");
		if (entry.view.expiresAt && Date.now() >= entry.view.expiresAt) {
			await this.expire(entry);
			throw new Error("응답 시간이 만료되었습니다.");
		}
		let reply: Reply;
		let answer: string;
		if (input.action === "cancel") {
			reply = { type: "extension_ui_response", id: entry.rawId, cancelled: true };
			answer = "취소";
		} else if (entry.view.method === "select" && input.action === "choose" && input.option < entry.options.length) {
			reply = { type: "extension_ui_response", id: entry.rawId, value: entry.options[input.option] };
			answer = entry.view.options[input.option];
		} else if (entry.view.method === "confirm" && input.action === "confirm") {
			reply = { type: "extension_ui_response", id: entry.rawId, confirmed: input.confirmed };
			answer = input.confirmed ? "승인" : "거절";
		} else if (["input", "editor"].includes(entry.view.method) && input.action === "submit") {
			reply = { type: "extension_ui_response", id: entry.rawId, value: input.text };
			answer = this.redactor.text(input.text).slice(0, 200);
		} else throw new Error("이 요청에 맞는 응답을 선택하세요.");
		entry.view.status = "sending";
		if (entry.timer) clearTimeout(entry.timer);
		this.changed();
		try {
			await this.send(reply);
			if (entry.view.status === "sending") {
				entry.view.status = input.action === "cancel" ? "cancelled" : "answered";
				entry.view.answer = answer;
			}
		} catch (error) {
			entry.view.status = "closed";
			throw error;
		} finally {
			this.changed();
		}
	}
	async close(sendCancellation: boolean, includeSending = true): Promise<void> {
		const pending: Entry[] = [];
		for (const entry of this.entries) {
			if (entry.timer) clearTimeout(entry.timer);
			if (entry.view.status === "pending") pending.push(entry);
			if (entry.view.status === "pending" || (includeSending && entry.view.status === "sending"))
				entry.view.status = "closed";
		}
		this.changed();
		if (sendCancellation)
			await Promise.all(
				pending.map((entry) =>
					this.send({ type: "extension_ui_response", id: entry.rawId, cancelled: true }).catch(() => {}),
				),
			);
	}
	clear(): void {
		void this.close(false);
		this.entries = [];
	}
}
