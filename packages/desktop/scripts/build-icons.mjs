import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

export async function buildBrandIcons() {
	const source = await readFile("src/renderer/assets/brand/primeintellect-logo.svg", "utf8");
	const paths = source.match(/<path\b[^>]*\/>/g);
	assert.equal(paths?.length, 16, "The official logo changed; review the symbol paths before rebuilding.");
	// The last two paths are the symbol in the official header logo. Preserve their geometry.
	const symbolPaths = paths.slice(-2).join("\n");
	const symbolSource = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="40" viewBox="0 0 240 40">${symbolPaths}</svg>`;
	const bounds = new Resvg(symbolSource).innerBBox();
	assert.ok(bounds);
	const viewBox = `${bounds.x - 1} ${bounds.y - 1} ${bounds.width + 2} ${bounds.height + 2}`;
	const symbol = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${symbolPaths}</svg>`;
	await writeFile("src/renderer/assets/brand/primeintellect-symbol.svg", symbol);
	const appIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect x="32" y="32" width="960" height="960" rx="214" fill="#0e0e0e"/><svg x="192" y="256" width="640" height="512" viewBox="${viewBox}">${symbolPaths}</svg></svg>`;
	await mkdir("assets", { recursive: true });
	await writeFile("assets/prime-desktop.svg", appIcon);
	await writeFile("assets/prime-desktop-1024.png", new Resvg(appIcon).render().asPng());
	await mkdir(".smoke/prime-desktop.iconset", { recursive: true });
	for (const size of [16, 32, 128, 256, 512]) {
		for (const scale of [1, 2]) {
			const png = new Resvg(appIcon, { fitTo: { mode: "width", value: size * scale } }).render().asPng();
			await writeFile(`.smoke/prime-desktop.iconset/icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`, png);
		}
	}
	execFileSync("/usr/bin/iconutil", ["-c", "icns", ".smoke/prime-desktop.iconset", "-o", "assets/prime-desktop.icns"]);
}
