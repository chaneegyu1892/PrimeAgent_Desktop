import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
export async function writeNotices() {
	const root = "node_modules";
	const dirs = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
		if (entry.name.startsWith("@"))
			for (const child of await readdir(join(root, entry.name))) dirs.push(join(root, entry.name, child));
		else dirs.push(join(root, entry.name));
	}
	const blocks = [
		"Prime Desktop third-party notices\n\nThe distribution contains bundled portions of dependencies below. This inclusive list also records development tooling; listing does not imply every package executes in the app. Native node-pty and Electron retain their packaged licenses. Original desktop Skills are MIT; adapted OMO Skills and vendored code retain their stated licenses; external provider services and official brand assets retain their own terms.\n",
	];
	for (const dir of dirs.sort()) {
		let pkg;
		try {
			pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
		} catch {
			continue;
		}
		const licenses = (await readdir(dir)).filter((name) => /^(license|licence|notice|copying)(\.|$)/i.test(name));
		blocks.push(
			`\n--- ${pkg.name}@${pkg.version} (${typeof pkg.license === "string" ? pkg.license : "see package license"}) ---\n`,
		);
		for (const name of licenses) {
			try {
				blocks.push(await readFile(join(dir, name), "utf8"));
			} catch {
				/* Some packages use a license directory. */
			}
		}
	}
	for (const file of [
		"vendor/omo/NOTICE.md",
		"vendor/omo/LICENSE.md",
		"vendor/omo/lsp/LICENSE",
		"vendor/omo/lsp/NOTICE",
	])
		blocks.push(await readFile(file, "utf8"));
	await writeFile("dist/THIRD_PARTY_NOTICES.txt", blocks.join("\n"));
}
