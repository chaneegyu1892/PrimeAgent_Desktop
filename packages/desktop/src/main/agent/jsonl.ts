import { StringDecoder } from "node:string_decoder";

// LF-only framing: Unicode separators inside JSON strings are not delimiters.
export class JsonlDecoder {
	private decoder = new StringDecoder("utf8");
	private parts: string[] = [];
	private length = 0;
	constructor(
		private onRecord: (value: unknown) => void,
		private maxLength = 16 * 1024 * 1024,
	) {}
	push(chunk: Buffer): void {
		this.consume(this.decoder.write(chunk));
	}
	end(): void {
		this.consume(this.decoder.end());
		if (this.length !== 0) throw new Error("RPC 응답이 줄 끝 전에 종료되었습니다.");
	}
	private consume(text: string): void {
		let start = 0;
		while (start < text.length) {
			const end = text.indexOf("\n", start);
			const part = text.slice(start, end === -1 ? undefined : end);
			this.length += part.length;
			if (this.length > this.maxLength) throw new Error("RPC 응답이 허용 크기를 초과했습니다.");
			this.parts.push(part);
			if (end === -1) return;
			const line = this.parts.join("").replace(/\r$/, "");
			this.parts = [];
			this.length = 0;
			if (line.trim()) {
				let value: unknown;
				try {
					value = JSON.parse(line);
				} catch {
					throw new Error("Prime Agent가 올바르지 않은 JSONL 응답을 보냈습니다.");
				}
				this.onRecord(value);
			}
			start = end + 1;
		}
	}
}
