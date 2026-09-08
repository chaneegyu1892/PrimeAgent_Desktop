import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ root: "" }));
vi.mock("electron", () => ({
	app: { isPackaged: true, getVersion: () => "0.10.0", getPath: () => fixture.root, quit: vi.fn() },
}));

import { FreeUpdateDriver, validateArchiveListing } from "../src/main/updates/free-update-driver";
import { type InstallPlan, replaceApplication } from "../src/main/updates/install-helper";
import { isNewer, verifyRelease } from "../src/main/updates/release-manifest";
import { DESKTOP_RELEASE_REPOSITORY } from "../src/shared/update-contract";

const dirs: string[] = [];
afterEach(async () => {
	vi.unstubAllGlobals();
	await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function directory() {
	const root = await mkdtemp(join(tmpdir(), "prime-update-test-"));
	dirs.push(root);
	return root;
}
function signed(bytes: Buffer, patch: Record<string, unknown> = {}) {
	const key = generateKeyPairSync("ed25519");
	const data = {
		version: "0.11.0",
		platform: "darwin",
		arch: "arm64",
		notes: "new",
		size: bytes.length,
		sha512: createHash("sha512").update(bytes).digest("hex"),
		url: `https://github.com/${DESKTOP_RELEASE_REPOSITORY}/releases/download/desktop-v0.11.0/Prime-Desktop-0.11.0-arm64.zip`,
		...patch,
	};
	const payload = Buffer.from(JSON.stringify(data));
	return {
		publicKey: key.publicKey.export({ type: "spki", format: "pem" }).toString(),
		envelope: JSON.stringify({
			payload: payload.toString("base64"),
			signature: sign(null, payload, key.privateKey).toString("base64"),
		}),
	};
}
describe("free authenticated updates", () => {
	it("verifies Ed25519 and rejects tampering, wrong keys, wrong app URLs, and downgrade", () => {
		const good = signed(Buffer.from("zip"));
		expect(verifyRelease(good.envelope, good.publicKey).version).toBe("0.11.0");
		const changed = JSON.parse(good.envelope);
		changed.payload = Buffer.from("altered").toString("base64");
		expect(() => verifyRelease(JSON.stringify(changed), good.publicKey)).toThrow("signature");
		expect(() => verifyRelease(good.envelope, signed(Buffer.from("other")).publicKey)).toThrow("signature");
		for (const patch of [
			{ url: "https://evil.example/app.zip" },
			{ version: "0.11.0-beta.1" },
			{ size: -1 },
			{ arch: "x64" },
			{ sha512: "bad" },
		]) {
			const invalid = signed(Buffer.from("zip"), patch);
			expect(() => verifyRelease(invalid.envelope, invalid.publicKey)).toThrow();
		}
		expect(isNewer("0.11.0", "0.10.0")).toBe(true);
		expect(isNewer("0.9.9", "0.10.0")).toBe(false);
		expect(isNewer("0.10.0", "0.10.0")).toBe(false);
	});
	it("checks only metadata, streams and verifies the explicitly requested ZIP, and rejects cache tampering", async () => {
		fixture.root = await directory();
		const bytes = Buffer.from("offline ZIP fixture bytes");
		const release = signed(bytes);
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(new Response(release.envelope))
			.mockResolvedValueOnce(new Response(bytes));
		vi.stubGlobal("fetch", fetcher);
		const driver = new FreeUpdateDriver(release.publicKey);
		expect(await driver.check()).toMatchObject({ version: "0.11.0" });
		expect(fetcher).toHaveBeenCalledOnce();
		const progress = vi.fn();
		await driver.download(progress);
		expect(await readFile(join(fixture.root, "updates/Prime-Desktop-0.11.0.zip"))).toEqual(bytes);
		expect(progress).toHaveBeenLastCalledWith(100);
		await writeFile(join(fixture.root, "updates/Prime-Desktop-0.11.0.zip"), "tampered");
		await expect(driver.stage()).rejects.toThrow("changed");
	});
	it("removes failed partial downloads and never accepts size or checksum mismatch", async () => {
		for (const bytes of [Buffer.from("bad"), Buffer.from("longer than promised")]) {
			fixture.root = await directory();
			const release = signed(Buffer.from("zip"));
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValueOnce(new Response(release.envelope)).mockResolvedValueOnce(new Response(bytes)),
			);
			const driver = new FreeUpdateDriver(release.publicKey);
			await driver.check();
			await expect(driver.download(() => {})).rejects.toThrow();
			expect(await readdir(join(fixture.root, "updates"))).toEqual([]);
		}
	});
	it("rejects traversal and unrelated archive entries", () => {
		expect(() => validateArchiveListing("Prime Desktop.app/Contents/Info.plist\n")).not.toThrow();
		for (const path of [
			"../outside",
			"/absolute",
			"Prime Desktop.app/../../outside",
			"Other.app/file",
			"Prime Desktop.app/back\\slash",
			"Prime Desktop.app/control\r",
		])
			expect(() => validateArchiveListing(path)).toThrow();
	});
});
async function installFixture(): Promise<InstallPlan> {
	const root = await directory();
	const target = join(root, "Prime Desktop.app"),
		staged = join(root, ".stage/Prime Desktop.app"),
		backup = join(root, "previous.app");
	await mkdir(target);
	await mkdir(staged, { recursive: true });
	await writeFile(join(target, "version"), "old");
	await writeFile(join(staged, "version"), "new");
	return { pid: process.pid, target, staged, backup, receipt: join(root, "receipt.json"), version: "0.11.0" };
}
describe("app replacement transaction", () => {
	it("atomically replaces the bundle and preserves the previous version", async () => {
		const plan = await installFixture(),
			open = vi.fn(async () => {});
		await replaceApplication(plan, open);
		expect(await readFile(join(plan.target, "version"), "utf8")).toBe("new");
		expect(await readFile(join(plan.backup, "version"), "utf8")).toBe("old");
		expect(open).toHaveBeenCalledWith(plan.target);
	});
	it("restores the old bundle if launch fails and refuses replay over its backup", async () => {
		const plan = await installFixture();
		await expect(
			replaceApplication(
				plan,
				vi.fn().mockRejectedValueOnce(new Error("launch failed")).mockResolvedValue(undefined),
			),
		).rejects.toThrow("launch failed");
		expect(await readFile(join(plan.target, "version"), "utf8")).toBe("old");
		await mkdir(plan.backup);
		await expect(replaceApplication(plan, async () => {})).rejects.toThrow("Backup already exists");
		expect(await readFile(join(plan.target, "version"), "utf8")).toBe("old");
	});
});
