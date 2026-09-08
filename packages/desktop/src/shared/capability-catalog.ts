import type { McpServerConfig } from "./capability-contract";
export interface ConnectionTemplate {
	config: McpServerConfig;
	category: string;
	description: string;
	setup: string;
	docs: string;
}
const http = (id: string, name: string, url: string, oauth = false): McpServerConfig => ({
	id,
	name,
	url,
	transport: "http",
	enabled: true,
	...(oauth ? { oauth } : {}),
});
export const CONNECTION_TEMPLATES: ConnectionTemplate[] = [
	{
		config: { id: "aside", name: "Aside", transport: "stdio", command: "aside", args: ["mcp"], enabled: true },
		category: "브라우저",
		description: "로그인된 브라우저에서 페이지 탐색, 조작과 화면 확인",
		setup: "Aside 앱과 CLI가 필요합니다. 설치된 CLI는 앱이 자동 탐지합니다.",
		docs: "https://docs.aside.com/help/developers",
	},
	{
		config: http("github", "GitHub", "https://api.githubcopilot.com/mcp/readonly"),
		category: "개발",
		description: "저장소, 코드, 이슈와 PR 탐색",
		setup: "GitHub PAT 입력 또는 토큰 환경변수를 연결하세요. 기본 주소는 읽기 전용입니다.",
		docs: "https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md",
	},
	{
		config: http("context7", "Context7", "https://mcp.context7.com/mcp"),
		category: "개발",
		description: "라이브러리의 최신 공식 문서와 예제",
		setup: "제한된 익명 사용을 지원합니다. 필요하면 API 키를 입력하세요.",
		docs: "https://context7.com/docs/resources/all-clients",
	},
	{
		config: http("notion", "Notion", "https://mcp.notion.com/mcp", true),
		category: "문서·협업",
		description: "워크스페이스 검색과 문서 작업",
		setup: "저장 후 OAuth 로그인으로 워크스페이스를 연결하세요.",
		docs: "https://developers.notion.com/guides/mcp/get-started-with-mcp",
	},
	{
		config: http("linear", "Linear", "https://mcp.linear.app/mcp", true),
		category: "문서·협업",
		description: "이슈, 프로젝트와 팀 작업 관리",
		setup: "OAuth 로그인 또는 OAuth를 끈 뒤 API 키를 사용할 수 있습니다.",
		docs: "https://linear.app/docs/mcp",
	},
	{
		config: http("figma", "Figma", "https://mcp.figma.com/mcp", true),
		category: "디자인",
		description: "디자인 문맥과 에셋을 개발 작업에 연결",
		setup: "OAuth와 파일 접근 권한이 필요합니다. 공급자의 클라이언트 승인 조건이 적용될 수 있습니다.",
		docs: "https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/",
	},
	{
		config: http("supabase", "Supabase", "https://mcp.supabase.com/mcp?read_only=true", true),
		category: "개발",
		description: "데이터베이스 구조, SQL과 로그 조회",
		setup: "개발자 계정으로 연결합니다. URL에 project_ref를 추가하면 프로젝트 범위를 제한할 수 있습니다.",
		docs: "https://supabase.com/docs/guides/ai-tools/mcp",
	},
	{
		config: http("vercel", "Vercel", "https://mcp.vercel.com", true),
		category: "개발",
		description: "프로젝트, 배포와 실행 로그",
		setup: "Vercel OAuth와 프로젝트 권한이 필요합니다.",
		docs: "https://vercel.com/docs/agent-resources/vercel-mcp",
	},
	...[
		["drive", "Google Drive", "drivemcp", "파일 탐색과 자료 연결"],
		["docs", "Google Docs", "docsmcp", "온라인 문서 작업"],
		["sheets", "Google Sheets", "sheetsmcp", "온라인 표와 데이터 작업"],
		["slides", "Google Slides", "slidesmcp", "온라인 발표자료 작업"],
		["gmail", "Gmail", "gmailmcp", "메일 검색과 작성"],
		["calendar", "Google Calendar", "calendarmcp", "일정 확인과 관리"],
	].map(([id, name, host, description]) => ({
		config: http(`google-${id}`, name, `https://${host}.googleapis.com/mcp/v1`),
		category: "Google Workspace",
		description,
		setup: "Cloud 프로젝트·API 활성화와 사전 OAuth 클라이언트 등록이 필요합니다. 발급받은 OAuth 액세스 토큰을 연결하세요. 단순 API 키는 지원하지 않습니다.",
		docs: "https://developers.google.com/workspace/guides/configure-mcp-servers",
	})),
];
export const SKILL_TITLES: Record<string, string> = {
	"prime-desktop-workflow": "작업 계획과 협업",
	"prime-coding": "코딩과 구현",
	"prime-debugging": "문제 진단",
	"prime-review": "코드·보안 검토",
	"prime-browser": "Aside 브라우저",
	"prime-research": "조사와 근거 정리",
	"prime-documents": "문서 작성",
	"prime-spreadsheets": "스프레드시트",
	"prime-presentations": "프레젠테이션",
	"prime-pdf": "PDF 읽기·제작",
	"prime-data": "데이터 분석",
	"prime-design": "제품 UI·UX",
	"prime-integrations": "MCP·업무 도구",
	"prime-communication": "기획·업무 커뮤니케이션",
	"prime-artifacts": "문서·데이터 실행 도구",
};

export const SKILL_SUMMARIES: Record<string, string> = {
	"prime-desktop-workflow": "계획 수립부터 사용자 선택, 진행 상황과 최종 검증까지 함께 관리합니다.",
	"prime-coding": "기존 프로젝트 구조를 파악하고 기능 구현, 리팩터링과 API 연결을 수행합니다.",
	"prime-debugging": "오류를 재현하고 원인을 추적해 수정한 뒤 같은 문제가 해결됐는지 검증합니다.",
	"prime-review": "코드 변경의 정확성, 회귀 위험, 데이터 손실과 보안 경계를 검토합니다.",
	"prime-browser": "Aside에서 페이지를 읽고 조작하며 실제 화면과 사용자 흐름을 확인합니다.",
	"prime-research": "최신 정보와 공식 자료를 조사하고 근거가 명확한 비교·보고서를 작성합니다.",
	"prime-documents": "보고서, 제안서와 편지를 편집 가능한 Word 문서로 작성합니다.",
	"prime-spreadsheets": "Excel 표, 수식, 서식과 차트를 만들고 데이터·계산 결과를 점검합니다.",
	"prime-presentations": "발표의 흐름을 구성하고 일관된 디자인의 PowerPoint 자료를 만듭니다.",
	"prime-pdf": "PDF의 내용을 읽고 추출·병합하거나 새 문서를 제작합니다.",
	"prime-data": "데이터를 정리하고 지표를 계산해 재현 가능한 분석과 차트를 만듭니다.",
	"prime-design": "브랜드에 맞는 UI, 반응형 화면과 접근성·사용자 경험을 개선합니다.",
	"prime-integrations": "연결된 서비스의 도구를 탐색하고 필요한 문서·개발·협업 작업에 사용합니다.",
	"prime-communication": "기획안, 회의록, 이메일과 의사결정 자료를 목적에 맞게 작성합니다.",
	"prime-artifacts": "Word·Excel·PowerPoint·PDF·이미지·데이터를 다루는 Python 라이브러리와 파일 검증 도구입니다.",
};
