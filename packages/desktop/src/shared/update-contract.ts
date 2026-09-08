export type UpdatePhase = "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "error";
export interface UpdateStatus {
	phase: UpdatePhase;
	currentVersion: string;
	version?: string;
	notes?: string;
	percent?: number;
	checkedAt?: string;
	error?: string;
	setup?: string;
	blockers: string[];
}
export interface UpdateRequests {
	"update.status": { input: undefined; output: UpdateStatus };
	"update.check": { input: undefined; output: UpdateStatus };
	"update.download": { input: undefined; output: UpdateStatus };
	"update.install": { input: undefined; output: UpdateStatus };
}
// This fork's desktop channel is separate from upstream Prime CLI releases.
export const DESKTOP_RELEASE_REPOSITORY = "chaneegyu1892/PrimeAgent_Desktop";
export const DESKTOP_UPDATE_URL = `https://github.com/${DESKTOP_RELEASE_REPOSITORY}/releases/download/desktop-stable/`;
