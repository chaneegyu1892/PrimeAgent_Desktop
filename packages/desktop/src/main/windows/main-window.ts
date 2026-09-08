import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserWindow, net, protocol, session } from "electron";

export const APP_URL = "prime-desktop://app/index.html";
export function registerScheme(): void {
	protocol.registerSchemesAsPrivileged([
		{ scheme: "prime-desktop", privileges: { standard: true, secure: true, supportFetchAPI: true } },
	]);
}
export function installProtocol(rendererRoot: string): void {
	protocol.handle("prime-desktop", (request) => {
		const url = new URL(request.url);
		if (url.host !== "app" || request.method !== "GET") return new Response(null, { status: 403 });
		let path: string;
		try {
			path = resolve(rendererRoot, `.${decodeURIComponent(url.pathname)}`);
		} catch {
			return new Response(null, { status: 400 });
		}
		if (!path.startsWith(`${rendererRoot}${sep}`)) return new Response(null, { status: 403 });
		return net.fetch(pathToFileURL(path).href);
	});
	session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
	session.defaultSession.setPermissionCheckHandler(() => false);
}
export function createMainWindow(distRoot: string): BrowserWindow {
	const window = new BrowserWindow({
		width: 1320,
		height: 880,
		minWidth: 920,
		minHeight: 640,
		title: "Prime Desktop",
		backgroundColor: "#0e0e0e",
		show: false,
		webPreferences: {
			preload: join(distRoot, "preload/index.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			webSecurity: true,
			webviewTag: false,
		},
	});
	window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	window.webContents.on("will-navigate", (event) => event.preventDefault());
	window.webContents.on("will-attach-webview", (event) => event.preventDefault());
	window.once("ready-to-show", () => window.show());
	void window.loadURL(APP_URL);
	return window;
}
