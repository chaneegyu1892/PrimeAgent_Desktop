import { chmod, cp, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { build as buildRenderer } from "vite";
import { buildBrandIcons } from "./build-icons.mjs";
import { writeNotices } from "./third-party-notices.mjs";

await buildBrandIcons();
await chmod(`node_modules/node-pty/prebuilds/${process.platform}-${process.arch}/spawn-helper`, 0o755);
await mkdir("dist/brand", { recursive: true });
await cp("assets/prime-desktop-1024.png", "dist/brand/app-icon.png");

await cp("builtin", "dist/builtin", { recursive: true });
await Promise.all([
	...["desktop-tasks", "desktop-code", "desktop-ast", "desktop-lsp", "desktop-memory"].map((name) =>
		build({
			entryPoints: [`src/extension/${name}.ts`],
			external: ["@ast-grep/napi"],
			outfile: `dist/extensions/${name}.mjs`,
			platform: "node",
			target: "node22",
			format: "esm",
			bundle: true,
		}),
	),
	build({
		entryPoints: ["src/main/updates/install-helper-entry.ts"],
		outfile: "dist/updates/install-helper.cjs",
		platform: "node",
		target: "node22",
		format: "cjs",
		bundle: true,
	}),
	build({
		entryPoints: ["src/extension/desktop-mcp.ts"],
		outfile: "dist/extensions/desktop-mcp.mjs",
		platform: "node",
		target: "node22",
		format: "esm",
		bundle: true,
	}),
	build({
		entryPoints: ["src/extension/desktop-ask-user.ts"],
		outfile: "dist/extensions/desktop-ask-user.mjs",
		platform: "node",
		target: "node22",
		format: "esm",
		bundle: true,
	}),
	build({
		entryPoints: ["src/main/index.ts"],
		outfile: "dist/main/index.cjs",
		platform: "node",
		target: "node22",
		format: "cjs",
		bundle: true,
		external: ["electron", "node-pty"],
	}),
	build({
		entryPoints: ["src/preload/index.ts"],
		outfile: "dist/preload/index.cjs",
		platform: "node",
		target: "node22",
		format: "cjs",
		bundle: true,
		external: ["electron", "node-pty"],
	}),
	buildRenderer(),
]);

await writeNotices();
