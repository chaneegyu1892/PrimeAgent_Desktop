import type { UpdateStatus } from "../../shared/update-contract";

export interface UpdateRelease {
	version: string;
	notes: string;
}
export interface UpdateDriver {
	check(): Promise<UpdateRelease | null>;
	download(progress: (percent: number) => void): Promise<void>;
	stage(): Promise<void>;
	quitAndInstall(): void;
}
/** Detection never downloads; download never stages a native update or installs on quit. */
export class UpdateService {
	private state: UpdateStatus;
	private checkTimer?: NodeJS.Timeout;
	private startTimer?: NodeJS.Timeout;
	private operation?: Promise<UpdateStatus>;
	private stopped = false;
	constructor(
		private driver: UpdateDriver,
		version: string,
		private beforeInstall: () => Promise<void>,
		private blockers: () => string[],
		setup?: string,
		private log: (error: unknown) => void = () => {},
	) {
		this.state = { phase: "idle", currentVersion: version, blockers: [], setup };
	}
	get installing(): boolean {
		return this.state.phase === "installing";
	}
	status(extra: string[] = []): UpdateStatus {
		return { ...this.state, blockers: [...this.blockers(), ...extra] };
	}
	start(): void {
		if (this.startTimer || this.checkTimer || this.stopped) return;
		this.startTimer = setTimeout(() => {
			void this.check();
		}, 15_000);
		this.checkTimer = setInterval(
			() => {
				void this.check();
			},
			6 * 60 * 60 * 1000,
		);
		this.startTimer.unref();
		this.checkTimer.unref();
	}
	stop(): void {
		this.stopped = true;
		clearTimeout(this.startTimer);
		clearInterval(this.checkTimer);
	}
	check(): Promise<UpdateStatus> {
		if (this.operation) return this.operation;
		if (this.stopped || ["available", "ready", "installing"].includes(this.state.phase))
			return Promise.resolve(this.status());
		this.state = { ...this.state, phase: "checking", error: undefined };
		this.operation = this.driver
			.check()
			.then((release) => {
				this.state = {
					...this.state,
					phase: release ? "available" : "idle",
					version: release?.version,
					notes: release?.notes,
					checkedAt: new Date().toISOString(),
				};
			})
			.catch((error) => {
				this.log(error);
				this.state = {
					...this.state,
					phase: "error",
					error: "업데이트를 확인하지 못했습니다. 네트워크와 데스크톱 릴리스를 확인하고 다시 시도하세요.",
				};
			})
			.then(() => this.status())
			.finally(() => {
				this.operation = undefined;
			});
		return this.operation;
	}
	download(): Promise<UpdateStatus> {
		if (this.operation) return this.operation;
		if (this.state.setup) return Promise.reject(new Error(this.state.setup));
		if (this.stopped || this.state.phase !== "available")
			return Promise.reject(new Error("다운로드할 새 버전을 먼저 확인하세요."));
		this.state = { ...this.state, phase: "downloading", percent: 0, error: undefined };
		this.operation = this.driver
			.download((percent) => {
				if (Number.isFinite(percent)) this.state.percent = Math.max(0, Math.min(100, percent));
			})
			.then(() => {
				this.state = { ...this.state, phase: "ready", percent: 100 };
			})
			.catch((error) => {
				this.log(error);
				this.state = {
					...this.state,
					phase: "available",
					percent: undefined,
					error: "다운로드 또는 무결성 검증에 실패했습니다. 다시 다운로드하세요.",
				};
			})
			.then(() => this.status())
			.finally(() => {
				this.operation = undefined;
			});
		return this.operation;
	}
	async install(extra: string[] = []): Promise<UpdateStatus> {
		if (this.stopped || this.state.phase !== "ready" || this.operation)
			throw new Error("설치할 업데이트가 아직 준비되지 않았습니다.");
		const status = this.status(extra);
		if (status.setup || status.blockers.length) throw new Error(status.setup || status.blockers.join("\n"));
		// Claim the install before yielding; IPC rejects all new work while this latch is set.
		this.state = { ...this.state, phase: "installing", error: undefined };
		try {
			await this.driver.stage();
		} catch (error) {
			this.log(error);
			this.state = {
				...this.state,
				phase: "ready",
				error: "업데이트를 준비하지 못했습니다. 쓰기 가능한 폴더에 앱을 설치했는지 확인하고 다시 시도하세요. 파일 또는 서명 검증 실패 시에도 설치하지 않습니다.",
			};
			return this.status();
		}
		try {
			await this.beforeInstall();
			this.driver.quitAndInstall();
		} catch (error) {
			this.log(error);
			// Installer preparation succeeded: keep work locked if owned processes may already be stopping.
			this.state.error = "업데이트 종료 준비에 실패했습니다. 앱을 직접 종료한 뒤 다시 열어주세요.";
		}
		return this.status();
	}
}
