import { resolve } from "node:path";
import { defineConfig } from "vite";
export default defineConfig({
	root: resolve("src/renderer"),
	base: "./",
	build: { outDir: resolve("dist/renderer"), emptyOutDir: true },
});
