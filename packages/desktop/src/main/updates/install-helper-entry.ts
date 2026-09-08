import { runInstaller } from "./install-helper";

if (process.argv[2])
	void runInstaller(process.argv[2]).catch(() => {
		process.exitCode = 1;
	});
