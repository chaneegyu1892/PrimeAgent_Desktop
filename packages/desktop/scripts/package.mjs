import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { packager } from "@electron/packager";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const release = process.env.PRIME_DESKTOP_RELEASE === "1";
const identity = process.env.PRIME_DESKTOP_SIGN_IDENTITY;
const keychainProfile = process.env.PRIME_DESKTOP_NOTARY_PROFILE;
if (release && (!identity?.startsWith("Developer ID Application:") || !keychainProfile))
	throw new Error(
		"Release packaging requires PRIME_DESKTOP_SIGN_IDENTITY and PRIME_DESKTOP_NOTARY_PROFILE. No unsigned release is produced.",
	);
await readFile("dist/main/index.cjs");
const stage = resolve(".package-stage");
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp("dist", `${stage}/dist`, { recursive: true });
await mkdir(`${stage}/node_modules/node-pty`, { recursive: true });
for (const file of ["lib", "package.json", "LICENSE"])
	await cp(`node_modules/node-pty/${file}`, `${stage}/node_modules/node-pty/${file}`, { recursive: true });
await cp("node_modules/node-pty/prebuilds/darwin-arm64", `${stage}/node_modules/node-pty/prebuilds/darwin-arm64`, {
	recursive: true,
});
await chmod(`${stage}/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper`, 0o755);
for (const name of ["typescript-language-server", "typescript-lsp-runtime"]) {
	await cp(`node_modules/${name}`, `${stage}/node_modules/${name}`, { recursive: true });
}
for (const name of ["napi", "napi-darwin-arm64"]) {
	await cp(`node_modules/@ast-grep/${name}`, `${stage}/node_modules/@ast-grep/${name}`, { recursive: true });
}
await writeFile(
	`${stage}/package.json`,
	JSON.stringify({
		name: "prime-desktop",
		productName: "Prime Desktop",
		version: pkg.version,
		main: pkg.main,
		description: pkg.description,
		author: pkg.author,
		license: pkg.license,
	}),
);
const outputs = await packager({
	dir: stage,
	out: process.env.PRIME_DESKTOP_PACKAGE_OUT || "out",
	name: "Prime Desktop",
	executableName: "Prime Desktop",
	appBundleId: "local.prime.desktop",
	icon: resolve("assets/prime-desktop.icns"),
	platform: "darwin",
	arch: "arm64",
	electronVersion: pkg.devDependencies.electron,
	overwrite: true,
	asar: {
		unpackDir:
			"{node_modules/node-pty,node_modules/@ast-grep,node_modules/typescript-language-server,node_modules/typescript-lsp-runtime,dist/extensions,dist/builtin,dist/updates}",
	},
	prune: false,
	...(release
		? {
				osxSign: { identity, optionsForFile: () => ({ hardenedRuntime: true }) },
				osxNotarize: { keychainProfile },
			}
		: {}),
});
await rm(stage, { recursive: true, force: true });
console.log(outputs.join("\n"));
