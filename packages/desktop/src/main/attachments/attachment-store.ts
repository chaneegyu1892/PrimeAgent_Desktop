import { randomUUID } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { Attachment } from "../../shared/dto";
import type { RpcImage } from "../agent/agent-transport";

const IMAGE_LIMIT = 8 * 1024 * 1024;
const TOTAL_LIMIT = 20 * 1024 * 1024;
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
function imageMime(bytes: Buffer): string | undefined {
	if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
	if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
	if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) return "image/gif";
	if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp";
	return undefined;
}
// Only native-picker selections receive a capability token; renderer-supplied paths are never read.
export class AttachmentStore {
	private files = new Map<string, { info: Attachment; path: string }>();
	get count(): number {
		return this.files.size;
	}
	async select(paths: string[]): Promise<Attachment[]> {
		if (paths.length > 10 || this.files.size + paths.length > 100)
			throw new Error("한 번에 최대 10개를 첨부하세요. 불필요한 첨부파일을 제거하세요.");
		const selected = await Promise.all(
			paths.map(async (path) => {
				const canonical = await realpath(path);
				const details = await stat(canonical);
				if (!details.isFile()) throw new Error("일반 파일만 첨부할 수 있습니다.");
				const kind = imageExtensions.has(extname(canonical).toLowerCase()) ? "image" : "file";
				if (kind === "image" && details.size > IMAGE_LIMIT)
					throw new Error("이미지는 파일당 8MB까지 첨부할 수 있습니다.");
				return {
					path: canonical,
					info: { id: randomUUID(), name: basename(canonical), size: details.size, kind } as Attachment,
				};
			}),
		);
		for (const file of selected) this.files.set(file.info.id, file);
		return selected.map((file) => file.info);
	}
	remove(id: string): void {
		this.files.delete(id);
	}
	async prepare(message: string, ids: string[] = []): Promise<{ message: string; images?: RpcImage[] }> {
		const images: RpcImage[] = [];
		const references: string[] = [];
		let total = 0;
		for (const id of ids) {
			const file = this.files.get(id);
			if (!file) throw new Error("첨부파일을 다시 선택하세요.");
			if (file.info.kind === "file") {
				if (!(await stat(file.path)).isFile()) throw new Error("첨부파일을 찾을 수 없습니다.");
				references.push(JSON.stringify(file.path));
				continue;
			}
			const handle = await open(file.path, "r");
			try {
				const details = await handle.stat();
				if (!details.isFile() || details.size > IMAGE_LIMIT)
					throw new Error("이미지는 파일당 8MB까지 첨부할 수 있습니다.");
				const bytes = Buffer.alloc(details.size + 1);
				let length = 0;
				while (length < bytes.length) {
					const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
					if (!bytesRead) break;
					length += bytesRead;
				}
				if (length !== details.size) throw new Error("첨부 중 이미지가 변경되었습니다. 다시 선택하세요.");
				total += length;
				if (total > TOTAL_LIMIT) throw new Error("이미지 첨부는 한 메시지에 총 20MB까지 가능합니다.");
				const data = bytes.subarray(0, length);
				const mimeType = imageMime(data);
				if (!mimeType) throw new Error("PNG, JPEG, WEBP, GIF 형식의 이미지를 선택하세요.");
				images.push({ type: "image", data: data.toString("base64"), mimeType });
			} finally {
				await handle.close();
			}
		}
		const parts = [
			message.trim() || (images.length ? "첨부한 이미지를 확인해 주세요." : "첨부한 파일을 확인해 주세요."),
		];
		if (references.length)
			parts.push(`첨부한 로컬 파일 경로 (필요한 파일을 읽어 참고하세요):\n${references.join("\n")}`);
		return { message: parts.join("\n\n"), ...(images.length ? { images } : {}) };
	}
}
