import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";

// Some Playwright/Electron combinations treat the predicate Promise itself as truthy.
export async function waitForAsync(page, predicate, argument, timeout = 30_000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if ((await page.evaluate(predicate, argument)) === true) return;
		await setTimeout(50);
	}
	assert.fail(`Async app condition did not become true: ${predicate}`);
}
