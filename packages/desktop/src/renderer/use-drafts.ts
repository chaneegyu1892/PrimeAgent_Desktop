import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Attachment, DesktopSnapshot } from "../shared/dto";

type Draft = { text: string; attachments: Attachment[] };
type Drafts = Record<string, Draft>;
const storageKey = "prime-desktop:conversation-drafts";
const keyFor = (snapshot: DesktopSnapshot) =>
	JSON.stringify([snapshot.project?.path ?? "", snapshot.initializing ? "" : (snapshot.state?.sessionId ?? "")]);
export function readDrafts(): Drafts {
	try {
		const entries = Object.entries(JSON.parse(localStorage.getItem(storageKey) ?? "{}"));
		return Object.fromEntries(
			entries
				.slice(-20)
				.filter(
					(entry): entry is [string, string] =>
						entry[0].length < 5000 && typeof entry[1] === "string" && entry[1].length <= 100000,
				)
				.map(([key, text]) => [key, { text, attachments: [] }]),
		);
	} catch {
		return {};
	}
}
export function useDrafts(snapshot: DesktopSnapshot) {
	const [drafts, setDrafts] = useState<Drafts>(readDrafts);
	const scope = keyFor(snapshot);
	const previous = useRef(snapshot);
	const aliases = useRef(new Map<string, string>());
	const resolveScope = (key: string): string => {
		const seen = new Set<string>();
		while (aliases.current.has(key) && !seen.has(key)) {
			seen.add(key);
			key = aliases.current.get(key)!;
		}
		return key;
	};
	useLayoutEffect(() => {
		const old = previous.current;
		previous.current = snapshot;
		const source = keyFor(old);
		if (
			source === scope ||
			(old.state && !old.initializing) ||
			(!snapshot.state && old.project) ||
			(old.project && old.project.path !== snapshot.project?.path)
		)
			return;
		aliases.current.set(source, scope);
		setDrafts((current) => {
			const draft = current[source];
			if (!draft) return current;
			const target = current[scope];
			const next = {
				...current,
				[scope]: {
					text: [target?.text, draft.text].filter(Boolean).join("\n\n"),
					attachments: [...(target?.attachments ?? []), ...draft.attachments],
				},
			};
			delete next[source];
			return next;
		});
	}, [snapshot, scope]);
	useEffect(() => {
		try {
			localStorage.setItem(
				storageKey,
				JSON.stringify(
					Object.fromEntries(
						Object.entries(drafts)
							.filter(([, draft]) => draft.text)
							.slice(-20)
							.map(([key, draft]) => [key, draft.text.slice(0, 100000)]),
					),
				),
			);
		} catch {
			/* In-memory drafts remain available if storage is full. */
		}
	}, [drafts]);
	const setText = useCallback(
		(value: string | ((text: string) => string)) =>
			setDrafts((current) => {
				const draft = current[scope] ?? { text: "", attachments: [] };
				const next = { ...current };
				delete next[scope];
				return { ...next, [scope]: { ...draft, text: typeof value === "function" ? value(draft.text) : value } };
			}),
		[scope],
	);
	const setAttachments = useCallback(
		(update: (current: Attachment[]) => Attachment[]) =>
			setDrafts((current) => ({
				...current,
				[scope]: { text: current[scope]?.text ?? "", attachments: update(current[scope]?.attachments ?? []) },
			})),
		[scope],
	);
	const complete = (submitted: string, ids: string[]) => {
		const key = resolveScope(scope);
		setDrafts((current) => {
			const draft = current[key];
			if (!draft) return current;
			return {
				...current,
				[key]: {
					text: draft.text === submitted ? "" : draft.text,
					attachments: draft.attachments.filter((file) => !ids.includes(file.id)),
				},
			};
		});
	};
	return {
		text: drafts[scope]?.text ?? "",
		attachments: drafts[scope]?.attachments ?? [],
		setText,
		setAttachments,
		complete,
	};
}
