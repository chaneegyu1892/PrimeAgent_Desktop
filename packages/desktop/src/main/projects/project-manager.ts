import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import type { Project } from "../../shared/dto";
import type { SettingsStore } from "../settings/settings-store";

export class ProjectManager {
	constructor(private store: SettingsStore) {}
	async open(path: string, recentOnly = false): Promise<Project> {
		if (recentOnly && !this.store.value.recent.some((project) => project.path === path))
			throw new Error("최근 프로젝트 목록에 없는 경로입니다.");
		if (!isAbsolute(path) || path.includes("\0")) throw new Error("프로젝트 경로가 올바르지 않습니다.");
		let canonical: string;
		try {
			canonical = await realpath(path);
			if (!(await stat(canonical)).isDirectory()) throw new Error("Not a directory");
		} catch {
			throw new Error("폴더를 찾을 수 없거나 접근할 수 없습니다. 폴더를 다시 선택하세요.");
		}
		const project = { path: canonical, name: basename(canonical) || canonical, lastOpened: new Date().toISOString() };
		await this.store.update((settings) => ({
			...settings,
			recent: [project, ...settings.recent.filter((p) => p.path !== canonical)].slice(0, 20),
		}));
		return project;
	}
	async remove(path: string): Promise<void> {
		await this.store.update((settings) => ({
			...settings,
			recent: settings.recent.filter((project) => project.path !== path),
		}));
	}
}
