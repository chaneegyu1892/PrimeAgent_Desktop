# 검증 결과

## 후속 업데이트: 무료 앱 업데이트 0.10.1

2026-09-08: Apple Developer 구독 없이 동작하는 배포 키 서명 기반 업데이트를 구현했습니다.

- **18개 파일 116개 테스트**, Biome·TypeScript, 빌드·패키징 통과.
- 서명된 메타데이터와 SHA-512 검증, 다른 키·변조·잘못된 URL·다운그레이드·압축 경로 거절, 실패한 다운로드 정리 검사.
- 메인 프로세스에서 실행 작업·대기 요청 재검사, 설치 중 새 프롬프트·패널 요청 차단, 중복 설치 거절 검사.
- 격리된 실제 `.app`에서 **0.10.0 → 0.10.1 파일 교체·재시작**, 이전 버전 백업, 대화·텍스트 초안 복원을 확인.
- 다운로드 뒤 일반 종료 시 0.10.0이 그대로 유지됨을 확인. 실행 중 설치 버튼 비활성화와 작업 종료 후 설치 허용 확인.
- 파일 교체/실행 오류 시 이전 앱 복원은 임시 디렉터리의 실제 파일을 이용한 테스트로 확인.
- 최종 0.10.1 패키지에서 기존 전체 네이티브 대화·확장·MCP·터미널·첨부·질문 흐름 통과, renderer/console 오류 없음.
- 사용자 앱은 종료하지 않았으며 실제 모델 호출·개인 인증 사용 없음. 업데이트 교체 테스트의 네트워크 응답은 로컬의 실제 서명된 배포 파일로 대체.

[실제 업데이트 보고서](../.smoke/update-Xx6JTZ/report.json), [설치 화면](../.smoke/update-Xx6JTZ/update-ready.png), [작업 보호](../.smoke/update-Xx6JTZ/update-work-protected.png), [복원된 대화](../.smoke/update-Xx6JTZ/update-restored.png), [최종 전체 앱 검증](../.smoke/run-EOXqx1/report.json).

무료 서명은 Apple 공증을 의미하지 않습니다. 첫 설치의 macOS 확인, 쓰기 가능한 앱 폴더, 배포 키의 비공개 백업이 필요합니다. [업데이트 배포·복구 안내](updates.md).

배포 확인: 사용자 포크의 `codex/prime-desktop-mvp`에 데스크톱 소스를 푸시했고, [0.10.1 앱](https://github.com/chaneegyu1892/PrimeAgent_Desktop/releases/tag/desktop-v0.10.1)과 [업데이트 채널](https://github.com/chaneegyu1892/PrimeAgent_Desktop/releases/tag/desktop-stable)을 공개했습니다. 업로드된 ZIP의 GitHub SHA-256이 로컬 검증 파일과 일치합니다. 최종 앱의 실제 `update.check`가 공개 GitHub 채널을 읽고 서명을 검증하여 0.10.1을 최신 버전으로 판정했습니다. [실제 공개 채널 확인](../.smoke/live-update-cea2MI/report.json). CLI 원본 저장소와 main 브랜치는 수정하지 않았습니다.

## 후속 업데이트: 확장 라이브러리와 에이전트 도구

2026-09-08 [구현 계획](capability-plan.md), [공식 자료 조사](capability-research.md)에 따라 확장 기능을 추가했습니다.

- **15개 파일 100개 테스트**: 기존 대화/질문/패널 84개와 확장 16개. Biome·TypeScript 검사, 빌드·arm64 패키징 통과.
- 최종 앱에서 기본 Skills 15개 목록·검색·내용 읽기·활성화 변경·대화 보존 적용, MCP stdio 설정 저장·실제 도구 목록 검사, 로컬 Prime 패키지 가져오기·활성화 확인.
- MCP 서버의 대량 시작 로그를 핸드셰이크 전에 비워 교착을 방지하는 회귀 검사. 기존 RPC timeout 테스트는 병렬 프로세스 시작을 기다릴 여유를 두되 응답 자동 재전송 거절을 계속 검사.
- SDK의 실제 stdio/Streamable HTTP 서버와 도구 호출, 리소스/프롬프트 조회, Bearer 인증, 비밀 없는 상태 응답, 명시적 오류·잘못된 도구 이름·연결 해제 검사.
- 로컬 브리지는 인증 없는 요청과 브라우저 Origin을 거절. 실제 도구 호출과 삭제 후 비활성 상태 검사.
- OAuth provider의 PKCE·토큰 저장/폐기, 로그인 버튼을 거치지 않은 자동 브라우저 열기 거절, 로그아웃 뒤 늦은 토큰 저장 거절 검사. **외부 서비스 계정의 실제 OAuth 로그인은 미검증**.
- 앱 밖의 설치된 **Prime CLI 0.9.3 실제 로더**에서 Skills 15개, Python Skill `prime_artifacts`, 확장 도구 `desktop_ask_user`/`desktop_mcp` 등록·스키마 검사. ASAR 밖 경로를 외부 Node가 읽는지 확인.
- 실제 설치된 **Aside MCP**에 연결하여 `repl`, `memory_search`, `exec` 도구 발견. 목록만 조회했으며 브라우저 작업 위임이나 유료 모델 호출은 하지 않음.
- 격리 Python 환경에서 고정 문서 도구 설치 후 DOCX/XLSX/PPTX/PDF/CSV/PNG 6종 생성·재읽기. 한글 문서 텍스트, 슬라이드 수, PDF 페이지, 표 행 수 검증. **구조 검사이며 office 렌더링·수식 재계산·OCR 검증은 아님**.
- MCP 이미지 응답이 문자열로만 사라지지 않고 모델용 이미지 블록으로 전달되는지 검사.
- YAML parser의 중첩 입력 보안 수정 버전 2.8.3과 공식 MCP SDK 1.30.0을 고정. 의존성 audit 0건. 타사 고지는 `dist/THIRD_PARTY_NOTICES.txt`에 포함.

[최종 패키징 보고서](../.smoke/run-Z6hcsc/report.json), [Skills 화면](../.smoke/run-Z6hcsc/capability-skills.png), [MCP 카탈로그](../.smoke/run-Z6hcsc/capability-mcp-catalog.png), [실제 MCP 도구 목록](../.smoke/run-Z6hcsc/capability-mcp-tools.png), [플러그인 화면](../.smoke/run-Z6hcsc/capability-plugins.png), [외부 CLI 로더](../.smoke/capability-runtime-report.json), [실제 Aside 발견](../.smoke/aside-mcp-report.json), [문서 도구 검사](../.smoke/artifact-check/report.json).

개발 앱과 최종 패키지의 기존 전체 시나리오 모두 통과, renderer/console 오류 없음. 패키징 중 발견한 확장/Skills ASAR 제외 경로를 수정해 외부 CLI 로딩을 재검증했습니다. 사용자 앱을 강제 종료하거나 개인 인증을 이동하지 않았습니다.

범위: 계정 없이 사용할 기본 Skills/도구와 관리 UI를 구현했으며, 14개 외부 서비스 항목은 **연결 템플릿**입니다. 모든 공급자의 로그인·권한·요금제, 최신 MCP 규격 전체, 모든 Codex 앱 기능 동등성이나 모든 작업의 전문 품질을 보장하지 않습니다. 모델 응답 품질과 선택한 서비스의 실제 작업은 해당 모델/계정에서 별도 확인해야 합니다. 기본 Python 의존성은 첫 커널 준비에 다운로드될 수 있습니다.


## 후속 업데이트: 프로젝트 없이 바로 시작하는 앱

2026-09-08 [사용성 계획](usability-plan.md)에 따라 자동 준비·일반 대화·기록 복원을 구현했습니다.

- **10개 파일 84개 테스트**, Biome·TypeScript 검사, 빌드·arm64 패키징 통과
- 최종 `.app`에서 폴더 선택 없이 자동 준비 → 일반 대화 전송 → 새 일반 대화 → 검색으로 이전 대화 복귀 확인
- ⌘N 새 대화, ⌘K 검색, 사용자 지정 패널 단축키와 충돌 거절 검증
- 일반 대화와 프로젝트 대화의 초안 분리, 마지막 세션 ID·메시지·텍스트 초안의 재실행 복원 확인
- 시작 중 전송은 준비 뒤 한 번만 전달; 중복 요청 거절 및 중단 시 대기 전송·시작 질문 취소 검증
- 시작 중 임시 세션을 거쳐 복원되어도 초안이 최종 대화로 이동하는지 Renderer 검사
- 저장된 폴더 삭제 시 일반 대화로 복구하고 안내 표시; 확장이 복원을 거절하면 다른 세션으로 전송하지 않는 회귀 검사
- 기존 질문 카드·사이드 채팅·첨부·프로젝트 세션·실제 PTY·Aside fixture·좁은 창 검사 통과
- Prime 공식 로고·중앙 입력 동선·시작 화면 스크롤을 실제 Electron 캡처로 검수; renderer/console error 없음

[최종 패키징 보고서](../.smoke/run-JqGc6L/report.json),
[시작 화면](../.smoke/run-JqGc6L/branded-start.png),
[일반 대화](../.smoke/run-JqGc6L/general-conversation.png),
[재실행 후 복원](../.smoke/run-JqGc6L/restored-conversation.png).

검증은 격리된 오프라인 CLI를 사용했으며 유료 모델 호출은 하지 않았습니다.
일반 대화의 cwd는 앱 전용 폴더입니다. 실행 중 본 대화 전환은 중단 후 가능하며,
첨부 선택과 미응답 질문은 앱 재시작 후 재사용하지 않습니다. 텍스트 초안만 최근 20개를 로컬 보관합니다.
코덱스의 background/subagent 관리 등 전체 기능 동등성을 의미하지 않습니다.
736KB renderer 번들 경고, jsdom의 xterm canvas 안내, 새 `.icon` 포맷 생략 경고는 남아 있으나,
기존 ICNS 앱 아이콘과 최종 네이티브 터미널·화면 동작 검사는 통과했습니다.

기존 앱을 강제로 종료하지 않았습니다. 이전 버전의 미전송 초안을 보관한 뒤 완전히 종료하고 새 앱을 실행하세요.

## 후속 업데이트: 대화·작업 개입

2026-09-08 [계획](interaction-plan.md)에 따라 질문 요청부터 답변·실행 계속·중단·복원까지 연결했습니다.

- 전체 10개 파일 **79개 테스트**, Biome·TypeScript 검사, 빌드·arm64 패키징 통과
- 최종 패키징 앱에서 선택·확인(승인/거절)·입력·편집, 요청 취소·만료·동시 요청 중단 확인
- 응답이 원래 RPC 요청 ID와 값으로 전달되는지 기록으로 확인; 잘못된 형식·중복·늦은 응답 거절
- 시작/세션 전환 자체가 질문을 기다리는 경우에도 응답 가능; 사용자 대기 동안 RPC 타임아웃 정지 검증
- 실행 중 기본 전송의 자동 추가 지시, 후속 작업, 중단 후 재전송, 기존 초안 보존 확인
- 숨겨진 사이드 채팅의 질문 알림·응답과 본 대화 세션/메시지 분리 확인
- CLI 비정상 종료에서 미응답 요청 폐기, 명시적 재연결 후 기존 세션 ID와 대화 복원 확인
- Desktop 내장 `desktop_ask_user`의 등록·직접 입력·취소/거절·중단 중 늦은 답변 처리를 단위 검사
- 설치된 **Prime CLI 0.9.3의 실제 확장 로더**로 최종 앱의 ASAR 밖 질문 도구를 읽고 등록 확인
  (실제 TypeBox 스키마 검사 및 명시적 답변까지 기다리는 실행 확인)
- 외부 Node fixture도 각 앱 CLI 시작에서 기본 질문 도구 파일의 전달·읽기 가능 여부를 검사
- 이전 패널·터미널·첨부·프로젝트 세션·입력 단축키 검사 모두 통과; renderer/console error 없음
- 선택 카드와 숨겨진 사이드 채팅 UI를 실제 Electron 캡처로 검수

[최종 패키징 앱 보고서](../.smoke/run-3OkyP8/report.json),
[질문 카드](../.smoke/run-3OkyP8/interaction-select.png),
[완료 상태](../.smoke/run-3OkyP8/interaction-completed.png),
[사이드 채팅 질문](../.smoke/run-3OkyP8/side-interaction.png),
[설치된 CLI 확장 로더 검사](../.smoke/question-runtime-report.json).

유료 모델 호출은 하지 않았습니다. 실제 모델이 언제 질문 도구를 선택하는지까지 검증한 것은 아닙니다.
현재 CLI의 confirm 취소/거절 반환값은 모두 false이며 도구는 이를 not_approved로 전달합니다.
이 구현은 질문한 작업의 응답 흐름이며 모든 도구 실행에 승인을 강제하는 권한 시스템은 아닙니다.
질문 이력·미전송 초안은 메모리 상태이고 재시작 후 자동 복원하지 않습니다.
Vite의 731KB 로컬 renderer chunk 경고와 jsdom의 xterm canvas 미구현 안내는 남아 있으며,
실제 패키징 앱의 터미널 렌더링은 정상입니다.

실행 중인 기존 앱은 자동 종료하지 않았습니다. 미전송 초안을 보관한 후 완전히 종료·재실행하면 적용됩니다.

## 후속 업데이트: 우측 작업 패널

2026-09-08 첨부 레퍼런스의 다섯 도구를 가진 작업 패널을 추가했습니다.
접기·펼치기, 확대·복원, 오른쪽/아래 배치, 사용자 지정 단축키를 지원합니다.

- 전체 8개 파일 **62개 테스트**, Biome·TypeScript, 빌드·arm64 패키징 통과
- 최종 `.app`에서 검토·파일·터미널·브라우저·사이드 채팅 전환과 980px 레이아웃 확인
- 실제 node-pty zsh 명령 실행, 프로젝트 cwd, 접은 뒤 같은 터미널 유지, 종료·재시작 확인
- xterm의 동적 스타일이 적용되는지 글꼴 검사 및 화면 검수; renderer 오류·console error 없음
- Git 스테이징/작업 디렉터리/새 파일/이름 변경, 하위 프로젝트 경로, 파일 미리보기 제한과 외부 symlink 차단 검증
- 별도 모의 CLI로 사이드 채팅 전송·중단·새 대화 검증; 본 대화 세션 ID와 메시지 불변 확인
- 단축키 중복 거절·사용자 설정·한글 조합 보호와 본 대화 초안 유지 확인
- Aside 탭 목록·읽기·URL 열기의 앱 연결은 격리된 CLI fixture로 검증
- 실행 중인 실제 Aside는 별도로 CLI를 통해 열린 Prime Intellect 공식 페이지 읽기에 성공
  (반환 형식 string, 12,963자). 실제 브라우저 새 탭 열기는 수행하지 않았음
- 모델 검증은 오프라인 CLI만 사용했으며 유료 모델 호출 없음

[패키징 앱 보고서](../.smoke/run-p1Wml6/report.json),
[작업 패널](../.smoke/run-p1Wml6/workspace-panel.png),
[검토](../.smoke/run-p1Wml6/review-panel.png),
[아래쪽 터미널](../.smoke/run-p1Wml6/terminal-panel.png),
[사이드 채팅](../.smoke/run-p1Wml6/side-chat-panel.png).

Aside 연결은 외부 창의 CLI 연동이며 내장 웹뷰·에이전트 MCP 자동 등록은 포함하지 않습니다.
Preload 공개 API는 `request`, `subscribe`, `subscribePanel`입니다. Inline style은
xterm의 글자 배치·색상에 허용하며, inline script·원격 연결·프레임은 계속 차단합니다.
node-pty 네이티브 런타임은 패키지에 포함되며 실행 도우미의 권한과 ASAR unpack 동작을
실제 패키징 앱의 터미널 실행으로 확인했습니다. Vite는 723KB renderer chunk 경고를
표시하지만 빌드는 성공했으며, 로컬 번들만 사용합니다.

기존 앱을 완전히 종료하고 다시 열면 적용됩니다. 미전송 초안은 먼저 보관하세요.

## 후속 업데이트: 프로젝트별 세션과 첨부파일

2026-09-08 사이드바를 **프로젝트 / 최근**으로 나누고, 폴더별 세션 펼치기·접기,
새 세션 생성, 저장된 세션 클릭으로 프로젝트 이동·연결·대화 복원을 추가했습니다.
입력창에는 파일 첨부·개별 제거를 추가했습니다. 이미지는 기존 RPC 이미지 필드로,
문서는 로컬 파일 경로로 전달합니다. 작성 중인 입력과 첨부는 세션별로 유지합니다.

- 전체 7개 파일 **55개 테스트**, 린트·TypeScript, 빌드·패키징 통과
- 최종 패키징 앱에서 두 프로젝트의 세션 목록·최근 목록·대화 복원 확인
- 프로젝트 간 이동 시 입력·첨부 분리와 원래 세션으로 복귀 시 초안 복원 확인
- 첫 연결 전에 작성한 입력의 유지, 기존 Enter·Shift+Enter·자동 높이 검사 통과
- 파일 선택·제거·첨부만 있는 전송 확인; 이미지 원본 바이트와 문서 경로가 모의 CLI에 도착한 것을 세션 파일로 검증
- 실패한 첨부 전송의 보존, 잘못된 토큰·이미지·크기 제한은 단위/통합 테스트로 확인
- 앱 재실행 후 저장된 세션 목록 및 가져온 세션 경로 유지 확인
- 이미지·문서의 실제 모델 해석은 검증하지 않았으며 유료 모델 호출 없음

[최종 검증 보고서](../.smoke/run-Eeq6zF/report.json),
[프로젝트별 세션과 첨부 화면](../.smoke/run-Eeq6zF/sidebar-and-attachments.png).

기존 앱을 종료하고 다시 열면 적용됩니다. 아직 전송하지 않은 초안은 앱 종료 시
저장되지 않으므로 필요한 내용은 전송하거나 별도로 보관한 후 다시 시작하세요.

## 후속 업데이트: Prime Intellect 공식 브랜딩

2026-09-08 공식 웹사이트의 SVG 로고·워드마크를 앱에 포함하고, 원본 심볼 경로로
1024px 아이콘과 macOS ICNS를 생성했습니다. 사이드바·시작 화면·답변 아바타·설정에
공식 자산을 적용하고, 웹사이트의 어두운 배경과 얇은 구분선·은은한 녹색을 반영했습니다.
출처와 생성 과정은 [브랜드 자산 기록](brand-assets.md)에 있습니다.

- 전체 6개 파일 **47개 테스트**, 린트·TypeScript, 빌드·패키징 통과
- 패키징 앱에서 로고의 오프라인 로딩과 다크 테마 확인
- 앱의 Info.plist가 지정한 ICNS와 생성한 아이콘의 바이트 일치 확인
- 실제 Electron에서 Enter 전송·Shift+Enter 줄바꿈·자동 높이와 기존 대화 흐름 확인
- Aside 및 패키징 앱 스크린샷으로 로고·대화 가독성 확인
- 검증은 격리된 가짜 CLI를 사용했으며 실제 모델 호출 없음

[검증 보고서](../.smoke/run-xi3cHS/report.json),
[시작 화면](../.smoke/run-xi3cHS/branded-start.png),
[대화 화면](../.smoke/run-xi3cHS/packaged-conversation.png).

실행 중인 앱을 완전히 종료하고 다시 열면 새 디자인과 Dock 아이콘이 적용됩니다.

## 후속 업데이트: 입력창과 대화 중심 UI

2026-09-08 Enter 전송, Shift+Enter 줄바꿈, 한글 IME 보호, 변경 가능한 전송 단축키와
자동 높이 입력창을 추가했습니다. 입력창은 1줄부터 8줄까지 내용에 맞춰 늘어나고,
초과 시 내부 스크롤을 사용하며 전송 후 높이가 복귀합니다. 프로젝트 목록과 실행
내역은 접을 수 있고, 사용자 메시지와 답변을 구분하는 대화 중심 화면으로 변경했습니다.

- 전체 6개 파일 **47개 테스트**, 린트·TypeScript, 빌드·패키징 통과
- Enter·Shift+Enter의 실제 Electron 키 입력, 줄 단위 성장·상한·축소 확인
- IME 조합 상태·keyCode 229·반복 키·전송 불가 상태는 Renderer 테스트로 확인
- 전송 단축키 저장·앱 재시작 복원, 패널 전환 시 입력 보존 확인
- 980px 창에서 가로 넘침 없음, 긴 입력의 높이와 전송 버튼 표시 확인
- Aside에서 빈 화면과 패널 접기·펼치기 확인; 대화 검증은 가짜 CLI 사용

[최종 앱 보고서](../.smoke/run-e9MQcU/report.json),
[대화 화면](../.smoke/run-e9MQcU/packaged-conversation.png),
[좁은 창의 긴 입력](../.smoke/run-e9MQcU/compact-composer.png).

기존 앱은 완전히 종료한 뒤 다시 열면 변경 사항이 적용됩니다.

## 후속 업데이트: 답변 서식 표시

2026-09-08 답변에 Markdown 제목·목록·표·인용문·코드 블록 표시를 추가했습니다.
미완성 코드 블록의 스트리밍 갱신, 완료 후 다음 전송 활성화, 원문 HTML·외부 링크·
이미지의 비실행 처리를 추가 검증했습니다. 전체 6개 파일 **42개 테스트**, 린트·타입
검사, 빌드, 패키징 및 패키징 앱 smoke가 통과했습니다.

- [업데이트 smoke 보고서](../.smoke/run-k3R5nV/report.json)
- [서식 적용 화면 — 가짜 CLI](../.smoke/run-k3R5nV/packaged-conversation.png)

기본 실제 모델 응답은 초기 검증 이후 사용자가 앱에서 정상 수신했다고 확인했습니다.
이번 업데이트의 자동 검증은 계속 가짜 CLI만 사용했습니다. 실행 중인 기존 앱에는
다시 시작한 후 새 서식이 적용됩니다.

## 초기 MVP 검증 기록

검증일: 2026-09-08. 기능 구현과 오프라인 검증을 완료했으며, 실제 인증·모델·도구를
사용하는 최종 사용자 확인은 남아 있습니다. 실제 API 키나 유료 모델 호출은 사용하지
않았습니다.

## 대상과 변경 범위

- upstream: `PrimeIntellect-ai/prime-agent` 0.9.3,
  `9c8230df67b378aaedc032f90e1ae8ba687cfe4a`
- 로컬 브랜치: `codex/prime-desktop-mvp`; 커밋·푸시 없음
- 새 구현: `packages/desktop`의 Main, Preload, Renderer, IPC, 외부 CLI transport,
  설정·프로젝트 저장, 빌드·패키징 스크립트, 테스트와 문서
- 기존 `packages/ai`, `packages/agent`, `packages/coding-agent`, `packages/tui` 및
  루트 package.json/package-lock.json 변경 없음
- 환경: macOS Apple Silicon, Node 24.19.0, npm 11.17.0, Electron 44.1.0

## 수행 결과

| 검사 | 결과 | 확인 범위 |
| --- | --- | --- |
| `npm run check` | 통과 | Biome 오류·경고 없음, TypeScript 검사 |
| `npm test` | 6개 파일, 39개 테스트 통과 | 아래 단위·통합 테스트 |
| `npm run build` | 통과 | Main/Preload 및 Vite Renderer 번들 |
| `npm run package` | 통과 | 로컬 arm64 `.app`, 약 286 MB |
| 개발 Electron smoke | 통과 | 가짜 CLI와 격리된 앱 데이터 |
| `npm run test:smoke -- --packaged` | 통과 | 최종 패키징 앱으로 전체 오프라인 흐름 |
| 일반 앱 실행 | 통과 | `open`으로 실행, 정상 화면과 CLI 자동 탐색 |
| macOS 폴더 선택창 | 열기·취소 확인 | 실제 OS dialog 표시; 폴더 선택 결과는 자동 smoke에서 대체 |
| Aside 화면 확인 | 완료 | 기본 레이아웃·빈 화면; 브라우저에서는 native API 비활성화 |

테스트는 UTF-8 청크 경계와 Unicode 구분자를 포함한 LF JSONL framing, 잘못된 RPC
응답, 준비 상태, 요청 거부·시간 초과·프로세스 비정상 종료, stderr 청크 사이의 비밀
마스킹, 최근 프로젝트 저장·손상 파일 보존, CLI와 외부 Node 탐색을 검증합니다.

AgentManager 테스트는 스트리밍 갱신, steer/follow-up/abort, 중단된 도구 상태,
메시지 접수 후 화면 갱신 오류, transport 생성 중 앱 종료를 다룹니다. Renderer와 IPC
테스트는 안전한 텍스트 표시, 실패한 입력 유지, 구독 해제, 호출자·명령·인자 검증 및
세션 파일 cwd 검증을 포함합니다.

## 패키징 앱 smoke 증거

- [실행 보고서](../.smoke/run-mxocto/report.json)
- [가짜 CLI 대화 화면](../.smoke/run-mxocto/packaged-conversation.png)

위 파일들은 이 로컬 작업 환경에서 생성된 결과이며 `.smoke`는 Git 추적에서
제외됩니다. 다른 환경에서는 smoke 명령으로 다시 생성합니다.

최종 앱에서 프로젝트 선택 결과 처리, RPC 준비 상태, 한국어·이모지 스트리밍,
추가 지시, 후속 작업, 중단, 모델 정보 비밀 필드 제거, thinking 변경, 새 세션,
세션 열기, 잘못된 IPC 거부, 소유한 child의 EOF 종료, 재시작 후 최근 프로젝트
복원을 확인했습니다. 파일 선택 dialog의 반환값은 자동화에서 대체했습니다.

실제 BrowserWindow에서 `sandbox: true`, `contextIsolation: true`,
`nodeIntegration: false`를 확인했습니다. Renderer의 `require`, `process`,
원시 `ipcRenderer`는 모두 `undefined`이며 preload는 `request`와 `subscribe`만
노출합니다. 화면 URL은 `prime-desktop://app/index.html`입니다.

Smoke는 격리한 HOME과 앱 설정, 가짜 CLI를 사용하며 실제 Prime 인증 파일과 모델
제공자에 연결하지 않습니다. 이후 일반 사용자 환경으로 앱을 열어 초기 화면과
네이티브 폴더 선택창의 열기·취소까지 확인했습니다. 실제 CLI 연결은 실행하지
않았습니다.

## 산출물과 남은 사용자 확인

앱 위치:

```text
/Users/jinkyu/PrimeAgent_App/packages/desktop/out/Prime Desktop-darwin-arm64/Prime Desktop.app
```

Apple 배포 인증서 서명·공증은 없습니다. 실행 바이너리에는 ad-hoc 서명이 있으며,
배포용 TeamIdentifier는 설정되어 있지 않습니다.

앱에서 **폴더 열기 → 연결 → 메시지 전송**으로 실제 모델 응답을 확인해야 합니다.
먼저 읽기 전용 요청으로 프로젝트 구조 설명을 요청하고, 이후 별도 테스트 폴더에서
파일 수정·도구 실행·중단을 확인하세요. 로그인 오류가 나면 기존 `prime-agent`의
`/login`을 사용합니다. 실제 모델 요청에는 제공자 사용량이 발생할 수 있습니다.

다음 작업은 실제 CLI 대화 확인, 저장된 세션 목록·재연결, background/subagent
표시 순서입니다. 앱 종료 후 일반 RPC 작업 유지와 대화 자동 복원은 현재 지원하지
않습니다. 상세 실행 방법과 제한은 [README](../README.md)에 있습니다.
