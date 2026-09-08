import { execFile } from "node:child_process";
import { lstat, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

export interface InstallPlan {
	pid: number;
	target: string;
	staged: string;
	backup: string;
	receipt: string;
	version: string;
}
/** Rename on one volume; keep the original bundle available for rollback. */
export async function replaceApplication(plan: InstallPlan, open: (path: string) => Promise<unknown>): Promise<void> {
	const parent = dirname(plan.target);
	if (
		dirname(dirname(plan.staged)) !== parent ||
		dirname(plan.backup) !== parent ||
		!plan.target.endsWith(".app") ||
		!plan.backup.endsWith(".app") ||
		!(await lstat(plan.target)).isDirectory() ||
		!(await lstat(plan.staged)).isDirectory()
	)
		throw new Error("Invalid install paths");
	// Refuse to overwrite a previous backup even if a stale plan is replayed.
	try {
		await lstat(plan.backup);
		throw new Error("Backup already exists");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	await rename(plan.target, plan.backup);
	try {
		await rename(plan.staged, plan.target);
		await open(plan.target);
	} catch (error) {
		try {
			await rename(plan.target, plan.staged);
		} catch (moveError) {
			if ((moveError as NodeJS.ErrnoException).code !== "ENOENT") throw moveError;
		}
		await rename(plan.backup, plan.target);
		await open(plan.target).catch(() => {});
		throw error;
	}
}
export async function runInstaller(planPath: string): Promise<void> {
	const root = dirname(resolve(planPath));
	const plan = JSON.parse(await readFile(planPath, "utf8")) as InstallPlan;
	if (!Number.isSafeInteger(plan.pid) || plan.pid <= 1 || dirname(plan.staged) !== root)
		throw new Error("Invalid install plan");
	await writeFile(join(root, "ready"), "ready", { mode: 0o600, flag: "wx" });
	const deadline = Date.now() + 300_000;
	while (true) {
		try {
			process.kill(plan.pid, 0);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ESRCH") break;
			throw error;
		}
		if (Date.now() > deadline) throw new Error("App did not exit; no update applied");
		await delay(250);
	}
	// No approval marker means normal quit, cancelled staging, or failed preparation: do nothing.
	if ((await readFile(join(root, "approved"), "utf8").catch(() => "")) !== "install") return;
	const open = (path: string) =>
		promisify(execFile)("/usr/bin/open", ["-n", path], {
			env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, NODE_OPTIONS: undefined },
		});
	try {
		await replaceApplication(plan, open);
		await writeFile(plan.receipt, JSON.stringify({ version: plan.version, success: true, backup: plan.backup }), {
			mode: 0o600,
		});
	} catch {
		await writeFile(plan.receipt, JSON.stringify({ version: plan.version, success: false, backup: plan.backup }), {
			mode: 0o600,
		});
	}
}
