import { verify } from "node:crypto";
import { DESKTOP_RELEASE_REPOSITORY } from "../../shared/update-contract";
import { UPDATE_PUBLIC_KEY } from "../../shared/update-public-key";

export interface DesktopRelease {
	version: string;
	url: string;
	sha512: string;
	size: number;
	notes: string;
	platform: "darwin";
	arch: "arm64";
}
export function versionParts(version: string): number[] {
	if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error("Stable version required");
	const parts = version.split(".").map(Number);
	if (parts.some((part) => !Number.isSafeInteger(part))) throw new Error("Invalid version");
	return parts;
}
export function isNewer(candidate: string, current: string): boolean {
	const a = versionParts(candidate),
		b = versionParts(current);
	for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
	return false;
}
export function verifyRelease(text: string, publicKey = UPDATE_PUBLIC_KEY): DesktopRelease {
	if (text.length > 200_000) throw new Error("Manifest too large");
	const envelope = JSON.parse(text) as { payload?: unknown; signature?: unknown };
	if (typeof envelope.payload !== "string" || typeof envelope.signature !== "string")
		throw new Error("Unsigned release");
	const bytes = Buffer.from(envelope.payload, "base64");
	const signature = Buffer.from(envelope.signature, "base64");
	if (signature.length !== 64 || !verify(null, bytes, publicKey, signature))
		throw new Error("Invalid release signature");
	const data = JSON.parse(bytes.toString("utf8")) as DesktopRelease;
	versionParts(data.version);
	if (
		data.platform !== "darwin" ||
		data.arch !== "arm64" ||
		data.url !==
			`https://github.com/${DESKTOP_RELEASE_REPOSITORY}/releases/download/desktop-v${data.version}/Prime-Desktop-${data.version}-arm64.zip` ||
		!Number.isSafeInteger(data.size) ||
		data.size <= 0 ||
		data.size > 1024 * 1024 * 1024 ||
		typeof data.sha512 !== "string" ||
		!/^[a-f0-9]{128}$/.test(data.sha512) ||
		typeof data.notes !== "string" ||
		data.notes.length > 12_000
	)
		throw new Error("Invalid desktop release");
	return data;
}
