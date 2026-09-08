export function keyed<T>(items: T[], identity: (item: T) => string): { item: T; key: string }[] {
	const occurrences = new Map<string, number>();
	return items.map((item) => {
		const base = identity(item);
		const occurrence = occurrences.get(base) ?? 0;
		occurrences.set(base, occurrence + 1);
		return { item, key: `${base}:${occurrence}` };
	});
}
