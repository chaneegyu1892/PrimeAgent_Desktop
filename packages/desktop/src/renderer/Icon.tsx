const paths = {
	plugin: "M4 4h6V2h4v2h6v6h2v4h-2v6h-6v2h-4v-2H4v-6H2v-4h2z",
	search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14M15 15l6 6",
	copy: "M8 8h13v13H8zM16 8V3H3v13h5",
	panelRight: "M4 4h16v16H4zM15 4v16",
	bottom: "M4 4h16v16H4zM4 15h16",
	expand: "M14 4h6v6M20 4l-7 7M4 14v6h6M4 20l7-7",
	terminal: "M3 4h18v16H3zM7 8l3 4-3 4M13 16h4",
	review: "M7 3h10v3h3v15H4V6h3zM9 12h6M9 16h6M7 3v4h10V3",
	browser: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3c5 5 5 13 0 18M12 3c-5 5-5 13 0 18",

	chevron: "M9 5l7 7-7 7",
	chat: "M4 4h16v12H9l-5 4z",
	refresh: "M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1",
	file: "M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6",
	image: "M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5M15 7h.01",
	attach: "M8 13l6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9",

	panel: "M4 4h16v16H4zM9 4v16",
	folder: "M3 7V5h6l2 2h10v13H3z",
	plus: "M12 5v14M5 12h14",
	arrow: "M12 19V5M6 11l6-6 6 6",
	stop: "M7 7h10v10H7z",
	activity: "M4 6h16M4 12h10M4 18h16",
	settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
	close: "M6 6l12 12M18 6L6 18",
} as const;
export function Icon({ name }: { name: keyof typeof paths }) {
	return (
		<svg
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.6"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d={paths[name]} />
		</svg>
	);
}
