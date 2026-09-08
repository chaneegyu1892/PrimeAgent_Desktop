import { spawn } from "node:child_process";
import electron from "electron";

// Load only locally built content even in development; rerun to rebuild changes.
const build = spawn(process.execPath, ["scripts/build.mjs"], { stdio: "inherit" });
const code = await new Promise((resolve) => build.once("exit", resolve));
if (code !== 0) process.exit(code ?? 1);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = spawn(electron, ["."], { stdio: "inherit", env });
app.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => app.kill("SIGINT"));
process.on("SIGTERM", () => app.kill("SIGTERM"));
