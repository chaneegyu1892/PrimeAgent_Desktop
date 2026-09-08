import type { DesktopAPI, RequestInput, RequestName, RequestOutput } from "../../shared/desktop-api";
export async function panelRequest<K extends RequestName>(
	api: DesktopAPI | undefined,
	name: K,
	input: RequestInput<K>,
): Promise<RequestOutput<K>> {
	if (!api) throw new Error("Prime Desktop 앱에서 사용할 수 있습니다.");
	const result = await api.request(name, input);
	if (!result.ok) throw new Error(result.error);
	return result.value;
}
export function panelError(error: unknown): string {
	return error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
}
