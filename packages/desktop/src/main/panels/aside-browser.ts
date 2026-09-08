import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { record } from "../../shared/ipc-contract";
import type { BrowserTab } from "../../shared/panel-contract";
import { resolveCli } from "../agent/cli-discovery";

const exec = promisify(execFile);
export function browserUrl(input: string): string {
	const url = new URL(input);
	if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
		throw new Error("HTTP 또는 HTTPS 주소를 입력하세요.");
	return url.href;
}
export class AsideBrowser {
	private tabs: BrowserTab[] = [];
	private tail: Promise<unknown> = Promise.resolve();
	private async run(code: string): Promise<string> {
		let path: string | undefined;
		for (const candidate of [
			join(homedir(), ".local/bin/aside"),
			"/opt/homebrew/bin/aside",
			"/usr/local/bin/aside",
		]) {
			if (
				await access(candidate).then(
					() => true,
					() => false,
				)
			) {
				path = candidate;
				break;
			}
		}
		if (!path) throw new Error("Aside CLI를 찾지 못했습니다. Aside 앱에서 CLI를 설치해 주세요.");
		const launch = await resolveCli(path);
		const work = this.tail
			.catch(() => {})
			.then(async () => {
				const result = await exec(launch.executable, [...launch.args, "repl", "--host", "local", code], {
					env: launch.env,
					encoding: "utf8",
					timeout: 30_000,
					maxBuffer: 2 * 1024 * 1024,
				});
				const output = result.stdout.split("\n").find((line) => line.startsWith("PRIME_PANEL_JSON:"));
				if (!output) throw new Error("Aside 응답을 확인하지 못했습니다. Aside 앱의 로그인 상태를 확인하세요.");
				return output.slice("PRIME_PANEL_JSON:".length);
			});
		this.tail = work;
		return work;
	}
	async list(): Promise<BrowserTab[]> {
		const data: unknown = JSON.parse(
			await this.run(
				'console.log("PRIME_PANEL_JSON:" + JSON.stringify((await listBrowserTabs()).map(t => ({id:t.targetId,title:t.title,url:t.url,active:t.active}))))',
			),
		);
		if (!Array.isArray(data)) throw new Error("Aside 탭 목록 형식이 올바르지 않습니다.");
		this.tabs = data.flatMap((value) => {
			const tab = record(value);
			return typeof tab.id === "string" && typeof tab.url === "string" && typeof tab.title === "string"
				? [{ id: tab.id, url: tab.url, title: tab.title, active: tab.active === true }]
				: [];
		});
		return this.tabs;
	}
	async open(input: string): Promise<void> {
		const url = browserUrl(input);
		await this.run(`await openTab(${JSON.stringify(url)}); console.log('PRIME_PANEL_JSON:null')`);
	}
	async read(id: string): Promise<string> {
		if (!this.tabs.some((tab) => tab.id === id)) throw new Error("탭 목록을 새로고침하고 다시 선택하세요.");
		const content: unknown = JSON.parse(
			await this.run(
				`console.log('PRIME_PANEL_JSON:' + JSON.stringify((await snapshot(await attachBrowserTab(${JSON.stringify(id)}))).tree))`,
			),
		);
		if (typeof content !== "string") throw new Error("Aside 페이지 내용을 읽지 못했습니다.");
		return content;
	}
}
