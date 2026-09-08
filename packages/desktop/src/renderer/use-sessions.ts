import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopAPI } from "../shared/desktop-api";
import type { DesktopSnapshot, SavedSession } from "../shared/dto";

export function useSessions(api: DesktopAPI | undefined, snapshot: DesktopSnapshot) {
	const [sessions, setSessions] = useState<SavedSession[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [refreshIndex, setRefreshIndex] = useState(0);
	const refresh = useCallback(() => setRefreshIndex((value) => value + 1), []);
	const projects = snapshot.recent.map((project) => project.path).join("\n");
	const sessionId = snapshot.state?.sessionId;
	const sessionName = snapshot.state?.sessionName;
	const streaming = snapshot.state?.isStreaming;
	const messageCount = snapshot.messages.length;
	const listKey = JSON.stringify([projects, sessionId, sessionName, streaming, messageCount, refreshIndex]);
	const latestKey = useRef(listKey);
	latestKey.current = listKey;
	useEffect(() => {
		if (!api) return;
		let active = true;
		const timer = setTimeout(() => {
			setLoading(true);
			void api
				.request("session.list", undefined)
				.then((result) => {
					if (!active || latestKey.current !== listKey) return;
					if (result.ok) {
						setSessions(result.value);
						setError(null);
					} else setError(result.error);
				})
				.catch(() => {
					if (active) setError("세션 목록을 불러오지 못했습니다. 새로고침해 주세요.");
				})
				.finally(() => {
					if (active) setLoading(false);
				});
		}, 250);
		return () => {
			active = false;
			clearTimeout(timer);
		};
	}, [api, listKey]);
	useEffect(() => {
		window.addEventListener("focus", refresh);
		return () => window.removeEventListener("focus", refresh);
	}, [refresh]);
	return { sessions, loading, error, refresh };
}
