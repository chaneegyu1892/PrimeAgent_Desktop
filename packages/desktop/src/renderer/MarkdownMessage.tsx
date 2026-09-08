import { memo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const plugins = [remarkGfm];
const components: Components = {
	// Links remain selectable text; model output cannot navigate the app or fetch images.
	a: ({ children, href }) => (
		<span className="markdown-reference" title={href}>
			{children}
		</span>
	),
	img: ({ alt }) => <span className="markdown-image-label">{alt || "이미지"}</span>,
	table: ({ children }) => (
		// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll wide tables.
		<section className="markdown-table" aria-label="표" tabIndex={0}>
			<table>{children}</table>
		</section>
	),
};

// Completed replies stay unchanged while the active reply receives new chunks.
export const MarkdownMessage = memo(function MarkdownMessage({ content }: { content: string }) {
	return (
		<div className="message-content markdown-body">
			<Markdown remarkPlugins={plugins} components={components}>
				{content || "…"}
			</Markdown>
		</div>
	);
});
