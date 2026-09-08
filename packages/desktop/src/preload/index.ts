import type { IpcRendererEvent } from "electron";
import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI, RequestInput, RequestName, RequestOutput } from "../shared/desktop-api";
import type { DesktopSnapshot, Result } from "../shared/dto";
import { REQUEST_CHANNEL, SNAPSHOT_CHANNEL, validateRequest } from "../shared/ipc-contract";

import { PANEL_CHANNEL, type PanelEvent } from "../shared/panel-contract";

const api: DesktopAPI = {
	request: <K extends RequestName>(name: K, input: RequestInput<K>): Promise<Result<RequestOutput<K>>> => {
		validateRequest(name, input);
		return ipcRenderer.invoke(REQUEST_CHANNEL, name, input);
	},
	subscribePanel: (listener) => {
		const handler = (_event: IpcRendererEvent, event: PanelEvent) => listener(event);
		ipcRenderer.on(PANEL_CHANNEL, handler);
		return () => ipcRenderer.removeListener(PANEL_CHANNEL, handler);
	},
	subscribe: (listener) => {
		const handler = (_event: IpcRendererEvent, snapshot: DesktopSnapshot) => listener(snapshot);
		ipcRenderer.on(SNAPSHOT_CHANNEL, handler);
		return () => {
			ipcRenderer.removeListener(SNAPSHOT_CHANNEL, handler);
		};
	},
};
contextBridge.exposeInMainWorld("primeDesktop", api);
