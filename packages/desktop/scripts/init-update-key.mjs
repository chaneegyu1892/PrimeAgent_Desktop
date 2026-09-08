import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

await mkdir(".release-keys", { recursive: true, mode: 0o700 });
const privatePath = ".release-keys/ed25519-private.pem";
let privateKey;
try {
	privateKey = await readFile(privatePath, "utf8");
} catch (error) {
	if (error.code !== "ENOENT") throw error;
	privateKey = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
	await writeFile(privatePath, privateKey, { mode: 0o600, flag: "wx" });
}
const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" });
const content = `// Public release verification key. The private key must never be committed.\nexport const UPDATE_PUBLIC_KEY = ${JSON.stringify(publicKey)};\n`;
const target = "src/shared/update-public-key.ts";
try {
	const previous = await readFile(target, "utf8");
	if (!previous.includes(JSON.stringify(publicKey)))
		throw new Error("Existing public key differs. Refusing to rotate the release identity.");
} catch (error) {
	if (error.code !== "ENOENT") throw error;
	await writeFile(target, content);
}
console.log(
	"Release signing key ready. Back up .release-keys privately; only the public verification key belongs in git.",
);
