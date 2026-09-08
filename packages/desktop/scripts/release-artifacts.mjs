import { execFile } from "node:child_process";
import { createHash, createPublicKey, sign } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const { version } = JSON.parse(await readFile("package.json", "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Stable desktop releases require a stable semantic version.");
const application = resolve("out/Prime Desktop-darwin-arm64/Prime Desktop.app");
const privateKey = await readFile(".release-keys/ed25519-private.pem", "utf8");
const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" });
if (!(await readFile("src/shared/update-public-key.ts", "utf8")).includes(JSON.stringify(publicKey)))
	throw new Error("Release key differs from pinned public key");
if (process.env.PRIME_DESKTOP_RELEASE !== "1")
	await run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", application], { timeout: 120_000 });
await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", application]);
const plistVersion = await run("/usr/libexec/PlistBuddy", [
	"-c",
	"Print :CFBundleShortVersionString",
	`${application}/Contents/Info.plist`,
]);
if (plistVersion.stdout.trim() !== version) throw new Error("Rebuild the application after changing its version.");
const root = resolve(`.release/${version}`);
await mkdir(root, { recursive: true });
const name = `Prime-Desktop-${version}-arm64.zip`;
await run("/usr/bin/ditto", ["-c", "-k", "--norsrc", "--noextattr", "--keepParent", application, `${root}/${name}`]);
const hash = createHash("sha512");
for await (const chunk of createReadStream(`${root}/${name}`)) hash.update(chunk);
const sha512 = hash.digest("hex");
const size = (await stat(`${root}/${name}`)).size;
const url = `https://github.com/chaneegyu1892/PrimeAgent_Desktop/releases/download/desktop-v${version}/${name}`;
const notes = await readFile(process.env.PRIME_DESKTOP_RELEASE_NOTES || "docs/release-notes.md", "utf8");
if (notes.length > 12_000) throw new Error("Release notes too long");
const payload = Buffer.from(JSON.stringify({ version, url, sha512, size, notes, platform: "darwin", arch: "arm64" }));
await writeFile(
	`${root}/desktop-update.json`,
	JSON.stringify(
		{ payload: payload.toString("base64"), signature: sign(null, payload, privateKey).toString("base64") },
		null,
		2,
	),
);
await writeFile(`${root}/release-notes.md`, notes);
console.log(`Verified signed release artifacts: ${root}`);
