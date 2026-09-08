export interface RpcImage {
	type: "image";
	data: string;
	mimeType: string;
}
export type RpcCommand =
	| ({ type: "extension_ui_response"; id: string } & (
			| { value: string }
			| { confirmed: boolean }
			| { cancelled: true }
	  ))
	| { type: "prompt" | "steer" | "follow_up"; message: string; images?: RpcImage[] }
	| { type: "abort" | "get_state" | "get_messages" | "new_session" | "get_available_models" }
	| { type: "switch_session"; sessionPath: string }
	| { type: "set_session_name"; name: string }
	| { type: "set_model"; provider: string; modelId: string }
	| { type: "set_thinking_level"; level: string };
export interface LaunchSpec {
	executable: string;
	args: string[];
	env: NodeJS.ProcessEnv;
}
export type TransportEvent =
	| { kind: "event"; value: Record<string, unknown> }
	| { kind: "diagnostic"; message: string }
	| { kind: "closed"; error?: string };
export interface AgentTransport {
	readonly ownership: "owned-child" | "shared-daemon";
	start(cwd: string): Promise<void>;
	request(command: RpcCommand): Promise<unknown>;
	subscribe(listener: (event: TransportEvent) => void): () => void;
	close(): Promise<void>;
}
