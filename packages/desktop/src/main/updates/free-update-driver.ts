import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream, writeFileSync } from "node:fs";
import {
	access,
	lstat,
	mkdir,
	mkdtemp,
	open,
	readdir,
	readFile,
	readlink,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { app } from "electron";
import { DESKTOP_UPDATE_URL } from "../../shared/update-contract";
import { UPDATE_PUBLIC_KEY } from "../../shared/update-public-key";
import type { InstallPlan } from "./install-helper";
import { type DesktopRelease, isNewer, verifyRelease } from "./release-manifest";
import type { UpdateDriver, UpdateRelease } from "./update-service";

const run = promisify(execFile);
async function boundedBytes(
	response: Response,
	max: number,
	consume: (chunk: Uint8Array, total: number) => Promise<void>,
) {
	if (!response.ok || !response.body) throw new Error("Update server unavailable");
	const reader = response.body.getReader();
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.length;
			if (total > max) throw new Error("Update size exceeded");
			await consume(value, total);
		}
	} finally {
		await reader.cancel().catch(() => {});
	}
	return total;
}
export function validateArchiveListing(listing: string): void {
	const paths = listing.replace(/\n$/, "").split("\n");
	if (
		paths.length > 50_000 ||
		!paths.length ||
		paths.some(
			(path) =>
				!path.startsWith("Prime Desktop.app/") ||
				path.includes("\\") ||
				/[\x00-\x1f]/.test(path) ||
				path.split("/").includes(".."),
		)
	)
		throw new Error("Invalid app archive paths");
}
async function checkTree(root: string, path = root): Promise<void> {
	for (const entry of await readdir(path, { withFileTypes: true })) {
		const child = join(path, entry.name);
		if (entry.isSymbolicLink()) {
			const target = await readlink(child);
			const within = relative(root, await realpath(resolve(path, target)));
			if (isAbsolute(target) || within === ".." || within.startsWith("../") || isAbsolute(within))
				throw new Error("Archive symlink escapes app");
		} else if (entry.isDirectory()) await checkTree(root, child);
		else if (!entry.isFile()) throw new Error("Unsupported app archive entry");
	}
}
export class FreeUpdateDriver implements UpdateDriver {
	private release?: DesktopRelease;
	private archive?: string;
	private stagedRoot?: string;
	private cache = join(app.getPath("userData"), "updates");
	constructor(private publicKey = UPDATE_PUBLIC_KEY) {}
	async check(): Promise<UpdateRelease | null> {
		if (!app.isPackaged) throw new Error("Packaged app required");
		const chunks: Buffer[] = [];
		await boundedBytes(
			await fetch(`${DESKTOP_UPDATE_URL}desktop-update.json`, {
				signal: AbortSignal.timeout(20_000),
				cache: "no-store",
			}),
			200_000,
			async (chunk) => {
				chunks.push(Buffer.from(chunk));
			},
		);
		const release = verifyRelease(Buffer.concat(chunks).toString("utf8"), this.publicKey);
		this.release = isNewer(release.version, app.getVersion()) ? release : undefined;
		return this.release ? { version: release.version, notes: release.notes } : null;
	}
	async download(progress: (percent: number) => void): Promise<void> {
		const release = this.release;
		if (!release) throw new Error("No verified release");
		await mkdir(this.cache, { recursive: true, mode: 0o700 });
		const temporary = join(this.cache, `${randomUUID()}.part`);
		const handle = await open(temporary, "wx", 0o600);
		try {
			const hash = createHash("sha512");
			const size = await boundedBytes(
				await fetch(release.url, { signal: AbortSignal.timeout(10 * 60_000) }),
				release.size,
				async (chunk, total) => {
					hash.update(chunk);
					await handle.writeFile(chunk);
					progress((total / release.size) * 100);
				},
			);
			if (size !== release.size || hash.digest("hex") !== release.sha512)
				throw new Error("Update checksum mismatch");
			await handle.sync();
			await handle.close();
			this.archive = join(this.cache, `Prime-Desktop-${release.version}.zip`);
			await rename(temporary, this.archive);
		} catch (error) {
			await handle.close().catch(() => {});
			await rm(temporary, { force: true });
			throw error;
		}
	}
	async stage(): Promise<void> {
		if (!this.release || !this.archive) throw new Error("Download first");
		const hash = createHash("sha512");
		for await (const chunk of createReadStream(this.archive)) hash.update(chunk);
		if (hash.digest("hex") !== this.release.sha512) throw new Error("Downloaded archive changed");
		const target = await realpath(dirname(dirname(dirname(app.getPath("exe")))));
		if (!target.endsWith(".app") || !(await lstat(target)).isDirectory()) throw new Error("Run the installed app");
		await access(dirname(target), constants.W_OK);
		const root = await mkdtemp(join(dirname(target), ".prime-update-"));
		try {
			// The archive was authenticated before extraction. Never strip quarantine or disable Gatekeeper.
			const list = await run("/usr/bin/unzip", ["-Z", "-1", this.archive], { maxBuffer: 16 * 1024 * 1024 });
			validateArchiveListing(list.stdout);
			await run("/usr/bin/ditto", ["-x", "-k", this.archive, root], { timeout: 120_000 });
			const staged = join(root, "Prime Desktop.app");
			await checkTree(staged);
			for (const [key, expected] of [
				["CFBundleIdentifier", "local.prime.desktop"],
				["CFBundleShortVersionString", this.release.version],
			]) {
				const result = await run("/usr/libexec/PlistBuddy", [
					"-c",
					`Print :${key}`,
					join(staged, "Contents/Info.plist"),
				]);
				if (result.stdout.trim() !== expected) throw new Error("Wrong application bundle");
			}
			await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", staged], { timeout: 30_000 });
			const plan: InstallPlan = {
				pid: process.pid,
				target,
				staged,
				backup: join(dirname(target), `.Prime-Desktop-previous-${randomUUID()}.app`),
				receipt: join(this.cache, "install-result.json"),
				version: this.release.version,
			};
			const planPath = join(root, "plan.json");
			await writeFile(planPath, JSON.stringify(plan), { mode: 0o600 });
			const helperPath = resolve(__dirname, "../updates/install-helper.cjs").replace(
				"app.asar/",
				"app.asar.unpacked/",
			);
			const child = spawn(process.execPath, [helperPath, planPath], {
				detached: true,
				stdio: "ignore",
				cwd: root,
				env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
			});
			let spawnError: Error | undefined;
			child.on("error", (error) => {
				spawnError = error;
			});
			child.unref();
			try {
				const deadline = Date.now() + 10_000;
				while ((await readFile(join(root, "ready"), "utf8").catch(() => "")) !== "ready") {
					if (spawnError || child.exitCode !== null || Date.now() > deadline)
						throw spawnError ?? new Error("Installer did not start");
					await delay(100);
				}
			} catch (error) {
				child.kill();
				throw error;
			}
			this.stagedRoot = root;
		} catch (error) {
			await rm(root, { recursive: true, force: true });
			throw error;
		}
	}
	quitAndInstall(): void {
		if (!this.stagedRoot) throw new Error("Installer not ready");
		writeFileSync(join(this.stagedRoot, "approved"), "install", { mode: 0o600, flag: "wx" });
		app.quit();
	}
}
