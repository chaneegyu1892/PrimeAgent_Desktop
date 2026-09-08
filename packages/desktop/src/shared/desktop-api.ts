import type { CapabilityRequests } from "./capability-contract";
import type { Attachment, DesktopSnapshot, ModelInfo, PromptPayload, Result, SavedSession } from "./dto";
import type { HarnessRequests } from "./harness-contract";
import type { InteractionReply } from "./interactions";
import type { PanelEvent, PanelRequests } from "./panel-contract";
import type { UpdateRequests } from "./update-contract";

export interface DesktopRequests extends PanelRequests, CapabilityRequests, UpdateRequests, HarnessRequests {
	"app.snapshot": { input: undefined; output: DesktopSnapshot };
	"app.copyText": { input: { text: string }; output: undefined };
	"project.selectDirectory": { input: undefined; output: DesktopSnapshot };
	"project.openRecent": { input: { path: string }; output: DesktopSnapshot };
	"project.removeRecent": { input: { path: string }; output: DesktopSnapshot };
	"settings.selectCli": { input: undefined; output: DesktopSnapshot };
	"settings.detectCli": { input: undefined; output: DesktopSnapshot };
	"agent.respond": { input: InteractionReply; output: undefined };
	"agent.reconnect": { input: undefined; output: DesktopSnapshot };
	"agent.connect": { input: undefined; output: DesktopSnapshot };
	"agent.disconnect": { input: undefined; output: DesktopSnapshot };
	"agent.prompt": { input: PromptPayload; output: undefined };
	"agent.steer": { input: PromptPayload; output: undefined };
	"agent.followUp": { input: PromptPayload; output: undefined };
	"attachment.select": { input: undefined; output: Attachment[] };
	"attachment.remove": { input: { id: string }; output: undefined };
	"agent.abort": { input: undefined; output: undefined };
	"agent.refresh": { input: undefined; output: DesktopSnapshot };
	"agent.copyDiagnostics": { input: undefined; output: undefined };
	"session.new": { input: undefined; output: DesktopSnapshot };
	"session.newGeneral": { input: undefined; output: DesktopSnapshot };
	"session.list": { input: undefined; output: SavedSession[] };
	"session.open": { input: { path: string; projectPath: string }; output: DesktopSnapshot };
	"session.create": { input: { path: string }; output: DesktopSnapshot };
	"session.resume": { input: undefined; output: DesktopSnapshot };
	"session.setName": { input: { name: string }; output: DesktopSnapshot };
	"model.list": { input: undefined; output: ModelInfo[] };
	"model.select": { input: { provider: string; modelId: string }; output: DesktopSnapshot };
	"model.setThinkingLevel": { input: { level: string }; output: DesktopSnapshot };
}
export type RequestName = keyof DesktopRequests;
export type RequestInput<K extends RequestName> = DesktopRequests[K]["input"];
export type RequestOutput<K extends RequestName> = DesktopRequests[K]["output"];
export interface DesktopAPI {
	request<K extends RequestName>(name: K, input: RequestInput<K>): Promise<Result<RequestOutput<K>>>;
	subscribePanel(listener: (event: PanelEvent) => void): () => void;
	subscribe(listener: (snapshot: DesktopSnapshot) => void): () => void;
}
declare global {
	interface Window {
		primeDesktop?: DesktopAPI;
	}
}
