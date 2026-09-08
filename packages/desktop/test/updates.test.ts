import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateService } from "../src/main/updates/update-service";
import { validateRequest } from "../src/shared/ipc-contract";

afterEach(() => vi.useRealTimers());
function fixture(setup?: string) {
	const blockers: string[] = [];
	const driver = {
		check: vi.fn(async () => ({ version: "0.11.0", notes: "New version" })),
		download: vi.fn(async (progress: (percent: number) => void) => {
			progress(50);
		}),
		stage: vi.fn(async () => {}),
		quitAndInstall: vi.fn(),
	};
	const cleanup = vi.fn(async () => {});
	const service = new UpdateService(driver, "0.10.0", cleanup, () => blockers, setup);
	return { service, driver, cleanup, blockers };
}
describe("user-controlled app updates", () => {
	it("checks on schedule without downloading or installing, and stops its timers", async () => {
		vi.useFakeTimers();
		const f = fixture();
		f.service.start();
		f.service.start();
		await vi.advanceTimersByTimeAsync(15_000);
		expect(f.driver.check).toHaveBeenCalledOnce();
		expect(f.service.status().phase).toBe("available");
		await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
		expect(f.driver.download).not.toHaveBeenCalled();
		expect(f.driver.stage).not.toHaveBeenCalled();
		expect(f.driver.quitAndInstall).not.toHaveBeenCalled();
		f.service.stop();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("does not stage or install a downloaded update on stop/normal quit", async () => {
		const f = fixture();
		await f.service.check();
		await f.service.download();
		expect(f.service.status()).toMatchObject({ phase: "ready", percent: 100 });
		f.service.stop();
		expect(f.driver.stage).not.toHaveBeenCalled();
		expect(f.cleanup).not.toHaveBeenCalled();
		expect(f.driver.quitAndInstall).not.toHaveBeenCalled();
	});
	it("allows downloading while busy but rechecks blockers at installation", async () => {
		const f = fixture();
		await f.service.check();
		f.blockers.push("메인 작업", "사이드 채팅", "터미널");
		await f.service.download();
		await expect(f.service.install()).rejects.toThrow("메인 작업");
		f.blockers.length = 0;
		await expect(f.service.install(["미전송 첨부파일"])).rejects.toThrow("미전송");
		expect(f.driver.stage).not.toHaveBeenCalled();
		await f.service.install();
		expect(f.driver.stage).toHaveBeenCalledOnce();
		expect(f.cleanup.mock.invocationCallOrder[0]).toBeGreaterThan(f.driver.stage.mock.invocationCallOrder[0]);
		expect(f.driver.quitAndInstall.mock.invocationCallOrder[0]).toBeGreaterThan(
			f.cleanup.mock.invocationCallOrder[0],
		);
	});
	it("claims installation synchronously and prevents duplicate clicks while staging", async () => {
		const f = fixture();
		let release!: () => void;
		f.driver.stage.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		await f.service.check();
		await f.service.download();
		const installing = f.service.install();
		expect(f.service.installing).toBe(true);
		await expect(f.service.install()).rejects.toThrow();
		expect(f.cleanup).not.toHaveBeenCalled();
		release();
		await installing;
		expect(f.driver.quitAndInstall).toHaveBeenCalledOnce();
	});
	it("recovers from network/download/signature failure without shutting down agents", async () => {
		const f = fixture();
		f.driver.check.mockRejectedValueOnce(new Error("network secret"));
		expect((await f.service.check()).phase).toBe("error");
		expect(JSON.stringify(f.service.status())).not.toContain("secret");
		await f.service.check();
		f.driver.download.mockRejectedValueOnce(new Error("checksum"));
		expect((await f.service.download()).phase).toBe("available");
		await f.service.download();
		f.driver.stage.mockRejectedValueOnce(new Error("signature"));
		expect((await f.service.install()).phase).toBe("ready");
		expect(f.service.installing).toBe(false);
		expect(f.cleanup).not.toHaveBeenCalled();
		expect(f.driver.quitAndInstall).not.toHaveBeenCalled();
		await f.service.install();
		expect(f.driver.quitAndInstall).toHaveBeenCalledOnce();
	});
	it("keeps new work blocked if cleanup fails after native staging", async () => {
		const f = fixture();
		await f.service.check();
		await f.service.download();
		f.cleanup.mockRejectedValueOnce(new Error("disk"));
		await f.service.install();
		expect(f.service.installing).toBe(true);
		expect(f.service.status().error).toContain("직접 종료");
		expect(f.driver.quitAndInstall).not.toHaveBeenCalled();
	});
	it("detects releases but blocks installation in an unsigned development app", async () => {
		const f = fixture("서명된 앱 필요");
		await f.service.check();
		expect(f.service.status().version).toBe("0.11.0");
		await expect(f.service.download()).rejects.toThrow("서명된");
		expect(f.driver.download).not.toHaveBeenCalled();
	});
	it("accepts only fixed update operations without URLs or arbitrary arguments", () => {
		for (const name of ["update.status", "update.check", "update.download", "update.install"]) {
			expect(() => validateRequest(name, undefined)).not.toThrow();
			expect(() => validateRequest(name, { url: "https://evil.example" })).toThrow();
		}
		expect(() => validateRequest("update.setFeedURL", undefined)).toThrow();
	});
});
