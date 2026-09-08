# Prime Desktop capability catalog 조사

확인일: **2026-09-08 KST**. 공식 문서·저장소·라이선스를 직접 확인했고, Aside 백그라운드 에이전트로 Aside/Google Workspace/문서 도구를 병행 조사했다. 아래 주소·명령은 **공식 문서에 존재함을 검증**한 값이다. Prime에서 설치·인증·도구 실행을 검증한 결과는 아니다. 코드·설정·설치 변경 없이 이 문서만 작성했다.

## 카탈로그 경계와 상태

- **Skill**: `SKILL.md`와 선택적 scripts/references/assets를 묶은 실행 지침. `name`, `description`이 필수이고 `compatibility`, `license` 등은 별도 메타데이터다. 형식의 이식성이 모든 에이전트·도구·운영체제에서의 실행을 보장하지 않는다. [Agent Skills 규격][skills-spec]
- **MCP**: 도구·리소스 등을 노출하는 실행 인터페이스. Skill을 추가해도 서버, 계정, 권한이 자동으로 생기지 않는다. HTTP 인증과 stdio 환경 자격증명을 구분한다. [전송 규격][mcp-transport], [인증 규격][mcp-auth]
- **Toolkit**: 파일 처리 라이브러리. MCP 서버나 완성된 Skill이 아니며 Prime 실행 어댑터·의존성이 있어야 사용 가능하다. 아래 문서/표/슬라이드 항목은 자체 지침을 작성할 후보다.

권장 상태 모델은 `template`(설정 예제만 있음), `configured`(로컬 설정 저장), `connected`(해당 프로토콜로 접속·인증하고 도구 목록 확인), `usable`(필요한 도구·권한·런타임으로 대표 작업 성공)이다. 인증 만료/권한 부족/실행 파일 없음은 별도 사유로 표시한다. Skill/Toolkit은 `connected`를 강제하지 않고 로더·의존성·대표 작업으로 `usable`을 판단한다. **문서 검증 상태와 로컬 실행 상태를 분리**한다.

## 규격·발견 기반

| ID | 용도 / 정확한 주소 | 인증·배포 판단 |
| --- | --- | --- |
| `agent-skills` | 형식 참고: `https://agentskills.io/specification` | 설치할 서버가 아님. 규격 저장소는 코드 Apache-2.0, 문서 CC-BY-4.0이며 개별 Skill 라이선스는 별도. [공식 저장소][skills-repo] |
| `mcp-registry` | 발견용 REST: `GET https://registry.modelcontextprotocol.io/v0.1/servers` | 공개 목록 조회와 게시자 인증은 별개. 실행용 MCP URL이 아님. 서버 패키지·원격 주소의 메타데이터만 제공. Preview이며 네임스페이스 검증이 코드 안전성·실행 호환성 보증은 아님. [API][registry-api], [범위][registry-about] |

Registry는 downstream aggregator를 통한 이용을 권장한다. Prime은 검토한 목록을 유지하고 갱신 시 공식 메타데이터와 교차 확인하는 구성이 적합하다. Registry의 라이선스는 Apache-2.0 전환 중이며 일부 MIT 기여분이 남아 있다. 등록된 서버의 라이선스까지 승계되는 것은 아니다. [Registry 설명][registry-about], [LICENSE][registry-license]

**런타임 검토 사항:** 조사 시점 `/specification/latest`는 **2026-07-28**로 연결됐다. 이 규격은 요청마다 버전/기능 메타데이터를 전달하며, **2025-11-25 이하의 `initialize` 세션 방식과 다르다**. `server/discover`, 구·신 규격 감지와 상호 운용은 현재 공식 호환성 문서를 기준으로 별도 판단한다. 여기서는 Prime의 지원 버전이나 각 서버의 실제 버전을 확인하지 않았다. 단일 핸드셰이크 구현만으로 “모든 MCP 지원”을 표시하지 않는다. [최신 규격][mcp-latest], [버전·호환성][mcp-versioning]

## 연결 후보 매트릭스

아래 ID는 제안 데이터이며 모두 초기 `template`, `enabled: false`다. 원격 서비스는 **연결 설정만 제공**하는 정책을 권장한다. 공개 로컬 서버의 OSS 라이선스는 호스티드 서비스 사용 조건과 별개다.

| ID / 분류 | 종류·실용 기능 | 정확한 URL 또는 stdio 명령 | 인증·사용 전제 | 라이선스 / 번들 정책·근거 |
| --- | --- | --- | --- | --- |
| `aside` / 브라우저·QA | MCP stdio; 브라우저 작업 위임, 페이지·스크린샷 검사 | `aside mcp` → command `aside`, args `["mcp"]`; 설정 화면이 알려주는 실제 CLI 경로 우선 | Aside 앱/CLI 및 대상 사이트 세션. 공식 문서는 CLI 계정 선택·내장 모델 로그인 요건을 설명하지만 MCP 전용 토큰/유료 요건은 명시하지 않음 | 사용자 설치본 연결. 독점 이용약관상 소프트웨어 재배포·재라이선스 제한; 바이너리 번들 제외. [개발자 문서][aside-docs], [약관 §3][aside-terms] |
| `github` / 코드·협업 | MCP HTTP; 저장소·이슈·PR·Actions | `https://api.githubcopilot.com/mcp/`; 읽기 전용 `https://api.githubcopilot.com/mcp/readonly` | PAT를 `Authorization: Bearer <PAT>`로 전달 가능. OAuth는 **호스트 자체 GitHub App/OAuth App 구성 필요**. 조직 정책·저장소 권한 적용 | 원격 설정 우선. 공개 로컬 서버 MIT; 번들 시 고지 보존. [공식 README][github-docs], [원격 설정][github-remote], [LICENSE][github-license] |
| `context7` / 개발 문서 | MCP HTTP 또는 stdio; 라이브러리 문서 검색 | `https://mcp.context7.com/mcp`; OAuth는 `https://mcp.context7.com/mcp/oauth`; stdio `npx -y @upstash/context7-mcp --api-key <API_KEY>` | 기본 HTTP는 제한된 익명 사용, API 키는 `Authorization: Bearer <API_KEY>`; OAuth는 원격 전용 | 공개 코드 MIT, 서비스 제한은 별도. 원격 우선, 로컬 실행은 Node/npx 필요. [연결·인증][context7-docs], [LICENSE][context7-license] |
| `notion` / 지식·문서 | MCP HTTP; 워크스페이스 검색·문서 작업 | `https://mcp.notion.com/mcp` | 대화형 OAuth 필수. DCR·PKCE 지원; 일반 Notion integration token을 이 경로의 대체 인증으로 가정하지 않음 | 호스티드 설정만. 기존 `notion-mcp-server`는 적극 유지보수 종료로 기본 후보에서 제외. [연결][notion-docs], [클라이언트 구현][notion-client] |
| `linear` / 이슈·프로젝트 | MCP HTTP; 이슈·프로젝트 관리 | `https://mcp.linear.app/mcp`; 읽기 전용 `https://mcp.linear.app/mcp/readonly` | OAuth 2.1/DCR 또는 `Authorization: Bearer <API_KEY_OR_OAUTH_TOKEN>`. 워크스페이스별 인증 문맥 분리 | 호스티드 설정만; 서버 재배포 허가는 확인하지 않음. 신규 설정에 deprecated `/sse` 사용하지 않음. [공식 문서][linear-docs] |
| `figma` / 디자인 | MCP HTTP; 디자인 문맥·에셋·코드 연결 | 원격 `https://mcp.figma.com/mcp`; 데스크톱 대안 `http://127.0.0.1:3845/mcp` | 원격 OAuth, 파일 권한·좌석/플랜 제한. 공식 문서상 **Figma MCP Catalog에 등록된 클라이언트만 연결**; Prime 등록 여부 미확인. 데스크톱은 앱에서 서버 활성화 필요 | `providerGate: client-approval`로 표시하고 즉시 사용 가능 약속 금지. 데스크톱 경로를 승인 우회 수단으로 취급하지 않음. 서버/앱 번들 제외. [원격][figma-docs], [접근 조건][figma-access], [로컬][figma-local] |
| `supabase` / 데이터·백엔드 | MCP HTTP; 스키마·SQL·로그·개발 도구 | 기본 `https://mcp.supabase.com/mcp`; 제안 템플릿 `https://mcp.supabase.com/mcp?project_ref=<PROJECT_REF>&read_only=true` | OAuth/DCR; PAT Bearer 수동 인증도 지원. `PROJECT_REF` 입력 필요. 프로젝트 제한 시 account 도구 비활성 | 공개 서버 Apache-2.0; 원격 설정 우선. 개발자용 권한으로 동작하므로 일반 고객용 DB 커넥터와 구분. [설정·제약][supabase-docs], [LICENSE][supabase-license] |
| `vercel` / 배포·운영 | MCP HTTP; 프로젝트·배포·로그 | `https://mcp.vercel.com` — `/mcp`를 덧붙이지 않음 | OAuth, Vercel 계정 접근권한. 공식 지원 클라이언트 목록과 별개로 Prime 호환성 검증 필요 | 호스티드 설정만; 서버 재배포 라이선스 미확인. [공식 연결 문서][vercel-docs] |
| `playwright-mcp` / 브라우저·QA | MCP stdio; 반복 UI 검사·스크린샷·로그 | `npx -y @playwright/mcp@latest` | Node.js 18+ 및 브라우저 런타임. MCP 서비스 API 키는 불필요하나 사이트 로그인 별도. 테스트별 프로필 격리 가능 | Apache-2.0. 공급자 예제의 `@latest`는 조사용 표기이며 제품 배포에는 검증 버전 고정 필요. [공식 README][playwright-docs], [LICENSE][playwright-license] |

브라우저 선택은 이 프로젝트의 Aside 우선 규칙을 유지한다. Playwright는 명시적으로 선택할 별도 QA 실행 수단이다. 원본 Anthropic `webapp-testing` 예제의 서버 자동 시작·Chromium 실행 지침을 그대로 적용하면 프로젝트의 명령/브라우저 규칙과 충돌할 수 있다.

## Google Workspace: 공식 원격 MCP와 CLI 분리

Google의 현재 개발자 가이드는 아래 **제품별 HTTP MCP 주소**를 명시한다. `google-workspace`는 그룹으로 두고 제품별 ID·도구·인증 상태를 관리한다. 한 제품 연결로 전체 제품 연결을 표시하지 않는다. [공식 설정 문서][google-mcp]

| ID / 분류 | URL | 우선순위 제안 |
| --- | --- | --- |
| `google-drive` / 파일·지식 | `https://drivemcp.googleapis.com/mcp/v1` | 핵심 |
| `google-docs` / 문서 | `https://docsmcp.googleapis.com/mcp/v1` | 핵심 |
| `google-sheets` / 표·분석 | `https://sheetsmcp.googleapis.com/mcp/v1` | 핵심 |
| `google-slides` / 발표자료 | `https://slidesmcp.googleapis.com/mcp/v1` | 핵심 |
| `google-gmail` / 메일 | `https://gmailmcp.googleapis.com/mcp/v1` | 선택 |
| `google-calendar` / 일정 | `https://calendarmcp.googleapis.com/mcp/v1` | 선택 |
| `google-chat` / 협업 | `https://chatmcp.googleapis.com/mcp/v1` | 선택 |
| `google-people` / 연락처 | `https://people.googleapis.com/mcp/v1` | 선택 |

공통 전제는 Cloud 프로젝트, 해당 Workspace API와 MCP 서비스 활성화, OAuth 동의 화면, 등록된 OAuth client ID/secret 및 적절한 callback이다. Google 원격 MCP는 **DCR와 Client ID Metadata Documents를 지원하지 않으므로** DCR만 구현한 연결 화면으로는 부족하다. Workspace 사용자 데이터 접근에 단순 API 키만 입력하도록 안내하지 않는다. 호스티드 설정만 제공하며 문서의 CC-BY-4.0/코드 예제 Apache-2.0를 서버 자체의 재배포 라이선스로 해석하지 않는다. [Workspace 설정][google-mcp], [Google 인증·제약][google-auth]

| ID | 종류·정확한 호출 예 | 인증·라이선스·상태 |
| --- | --- | --- |
| `google-workspace-cli` | **CLI/Skill 후보**, MCP 서버 아님. 패키지 `@googleworkspace/cli`, 실행 파일 `gws`; `gws drive files list --params '{"pageSize":5}'` | `gws auth login` 또는 `GOOGLE_WORKSPACE_CLI_TOKEN`/`GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE`. `gws auth setup`은 프로젝트/API 설정을 변경하는 별도 준비 단계. Apache-2.0지만 README가 **Google 공식 지원 제품 아님**을 명시. 현재 README에서 MCP 서버 실행 명령은 확인되지 않아 `gws mcp`를 등록하지 않음. [README][gws-docs], [LICENSE][gws-license] |

## 선별 Skill·파일 Toolkit 후보

표의 라이브러리에는 MCP URL/stdio 서버 명령이 없다. Skill 원본은 링크로 검토하고, 런타임/파일 권한/결과 검증을 갖춘 뒤 사용 가능으로 전환한다. 로컬 파일 처리에는 서비스 인증이 없지만 파일 접근 권한과 실제 Python/Node 실행 환경은 필요하다.

| ID / 분류 | 후보·정확한 원본 | 인증·런타임 / 범위 | 라이선스·배포 제안 |
| --- | --- | --- | --- |
| `frontend-design` / 디자인·개발 | Anthropic [frontend-design/SKILL.md][frontend-skill] | Skill 로더와 파일 편집 도구. 별도 서비스 인증 없음 | Apache-2.0 [개별 LICENSE][frontend-license]; 검토 후 선택적 import, 현재 `template` |
| `browser-qa` / 브라우저·QA | Anthropic [webapp-testing/SKILL.md][qa-skill] | 원본은 Python Playwright와 scripts 의존. Prime/Aside용 지침 적응 필요 | Apache-2.0 [개별 LICENSE][qa-license]; 변경 고지·라이선스 보존 후 적응 가능, 현재 `template` |
| `document-docx` / 문서 | [python-docx][docx-docs], Python 패키지 `python-docx` | DOCX 생성·편집. Word 앱 원격 조작/렌더링 엔진은 아님 | MIT [LICENSE][docx-license]; 자체 Skill + 검증된 runtime adapter 후보 |
| `spreadsheet-xlsx` / 표·분석 | [openpyxl][xlsx-docs], Python 패키지 `openpyxl` | XLSX 읽기·쓰기·수식 기록. **수식 계산은 하지 않음**; 계산 검증 별도. [수식 문서][xlsx-formula] | 공식 문서 MIT/Expat. 소스 호스트 LICENSE 원문은 봇 차단으로 미확인; 배포할 아카이브 고지 확인 필요 |
| `presentation-pptx` / 발표자료 | [PptxGenJS][pptx-docs], npm 패키지 `pptxgenjs` | Node/JS로 PPTX 생성. 기존 PPTX 임의 편집·화면 렌더링 보장 항목으로 표시하지 않음 | MIT [LICENSE][pptx-license]; 자체 Skill + 생성/시각 검증 절차 후보 |
| `pdf-tools` / PDF | [pypdf][pdf-docs], Python 패키지 `pypdf` | PDF 추출·분할·병합·변환 작업. OCR/페이지 시각 렌더러는 별도 | BSD-3-Clause [LICENSE][pdf-license]; 자체 Skill + 검증된 runtime adapter 후보 |

**번들 제외:** Anthropic `docx`, `xlsx`, `pptx`, `pdf` Skill은 README상 source-available이며 공개 OSS 예제와 구분된다. 각 LICENSE는 서비스 외 보관·복제·파생·제3자 배포를 제한한다. 이 Skill의 prompts/scripts/assets를 Prime에 복사하지 않는다. 하위 MIT 라이브러리의 허가는 상위 Skill의 허가가 아니다. [README][anthropic-readme], [DOCX 라이선스][anthropic-docx-license], [XLSX 라이선스][anthropic-xlsx-license], [PPTX 라이선스][anthropic-pptx-license], [PDF 라이선스][anthropic-pdf-license]

## 구현에 전달할 데이터 규칙

위 표의 ID/분류/종류/대상/인증/라이선스/근거 링크를 curated entries로 사용한다. 다음은 **제안 스키마**이며 현재 코드의 타입을 확인하거나 수정한 것이 아니다.

```json
{
  "id": "aside",
  "kind": "mcp",
  "category": "browser-qa",
  "transport": "stdio",
  "command": "aside",
  "args": ["mcp"],
  "auth": "app-session; mcp-specific-requirements-unconfirmed",
  "bundlePolicy": "external-install-only",
  "sourceUrls": ["https://docs.aside.com/help/developers", "https://aside.com/policy/terms"],
  "docsVerifiedAt": "2026-09-08",
  "runtimeVerifiedAt": null,
  "status": "template",
  "enabled": false
}
```

- HTTP 항목은 `url`, stdio 항목은 `command`/`args`를 사용한다. Toolkit/Skill/Registry를 stdio 서버로 위장하지 않는다. 비밀값은 catalog에 저장하지 않고 별도 credential 참조로 연결한다.
- GitHub는 PAT 경로를 우선 제시하고 OAuth 앱 등록 여부를 별도 관리한다. Notion/Linear/Supabase의 DCR, Google의 사전 OAuth 등록, Figma의 공급자 승인 조건을 같은 “로그인” 상태로 뭉개지 않는다.
- 수동 입력 `<PROJECT_REF>`, `<API_KEY>`가 남으면 구성 완료가 아니다. MCP 성공 판정에는 프로토콜 호환성·인증·도구 목록·허용 범위의 대표 조회 결과를 기록한다. Skill/Toolkit에는 파일 산출물 검증을 기록한다.
- 추천 우선 노출은 Aside, GitHub, Context7, Notion, Linear, Supabase, Vercel, Google Drive/Docs/Sheets/Slides. Figma는 승인 조건 표시, Playwright·Workspace 나머지 제품·gws·파일 Toolkit은 선택 확장으로 둔다. 이는 제품 제안이며 설치/연결 상태가 아니다.
- OSS 번들은 버전/커밋·직접 및 전이 의존성 라이선스·고지를 고정해 검토한다. npm 설치 시 저장소의 **7일 최소 릴리스 경과 규칙**을 유지한다. `npx ...@latest` 공식 예제가 자동 설치 허가나 검증된 고정 버전을 뜻하지 않는다.

현재 미검증: 모든 항목의 Prime 실행 호환성·연결 상태, Aside MCP 전용 인증/플랜·공식 원격 URL, Figma의 Prime 클라이언트 승인, Toolkit 렌더링/수식 계산 보완 런타임. 따라서 “모든 범용 Skill 기본 제공” 대신 **선별된 연결 템플릿과 검증된 실행 능력**을 각각 표시한다.

[skills-spec]: https://agentskills.io/specification
[skills-repo]: https://github.com/agentskills/agentskills
[mcp-latest]: https://modelcontextprotocol.io/specification/latest
[mcp-versioning]: https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning
[mcp-transport]: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports
[mcp-auth]: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
[registry-api]: https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/official-registry-api.md
[registry-about]: https://modelcontextprotocol.io/registry/about
[registry-license]: https://raw.githubusercontent.com/modelcontextprotocol/registry/main/LICENSE
[aside-docs]: https://docs.aside.com/help/developers
[aside-terms]: https://aside.com/policy/terms
[github-docs]: https://github.com/github/github-mcp-server
[github-remote]: https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md
[github-license]: https://github.com/github/github-mcp-server/blob/main/LICENSE
[context7-docs]: https://context7.com/docs/resources/all-clients
[context7-license]: https://raw.githubusercontent.com/upstash/context7/master/LICENSE
[notion-docs]: https://developers.notion.com/guides/mcp/get-started-with-mcp
[notion-client]: https://developers.notion.com/guides/mcp/build-mcp-client
[linear-docs]: https://linear.app/docs/mcp
[figma-docs]: https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/
[figma-access]: https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/
[figma-local]: https://developers.figma.com/docs/figma-mcp-server/local-server-installation/
[supabase-docs]: https://supabase.com/docs/guides/ai-tools/mcp
[supabase-license]: https://raw.githubusercontent.com/supabase/mcp/main/LICENSE
[vercel-docs]: https://vercel.com/docs/agent-resources/vercel-mcp
[playwright-docs]: https://github.com/microsoft/playwright-mcp
[playwright-license]: https://raw.githubusercontent.com/microsoft/playwright-mcp/main/LICENSE
[google-mcp]: https://developers.google.com/workspace/guides/configure-mcp-servers
[google-auth]: https://docs.cloud.google.com/mcp/authenticate-mcp
[gws-docs]: https://github.com/googleworkspace/cli
[gws-license]: https://raw.githubusercontent.com/googleworkspace/cli/main/LICENSE
[frontend-skill]: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md
[frontend-license]: https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/LICENSE.txt
[qa-skill]: https://github.com/anthropics/skills/blob/main/skills/webapp-testing/SKILL.md
[qa-license]: https://raw.githubusercontent.com/anthropics/skills/main/skills/webapp-testing/LICENSE.txt
[docx-docs]: https://python-docx.readthedocs.io/en/latest/
[docx-license]: https://raw.githubusercontent.com/python-openxml/python-docx/master/LICENSE
[xlsx-docs]: https://openpyxl.readthedocs.io/en/stable/
[xlsx-formula]: https://openpyxl.readthedocs.io/en/stable/simple_formulae.html
[pptx-docs]: https://gitbrent.github.io/PptxGenJS/
[pptx-license]: https://raw.githubusercontent.com/gitbrent/PptxGenJS/master/LICENSE
[pdf-docs]: https://pypdf.readthedocs.io/en/stable/
[pdf-license]: https://raw.githubusercontent.com/py-pdf/pypdf/main/LICENSE
[anthropic-readme]: https://github.com/anthropics/skills
[anthropic-docx-license]: https://raw.githubusercontent.com/anthropics/skills/main/skills/docx/LICENSE.txt
[anthropic-xlsx-license]: https://raw.githubusercontent.com/anthropics/skills/main/skills/xlsx/LICENSE.txt
[anthropic-pptx-license]: https://raw.githubusercontent.com/anthropics/skills/main/skills/pptx/LICENSE.txt
[anthropic-pdf-license]: https://raw.githubusercontent.com/anthropics/skills/main/skills/pdf/LICENSE.txt
