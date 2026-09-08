# Prime Intellect 브랜드 적용

확인일: 2026-09-08. 사용자의 요청에 따라 [공식 사이트](https://www.primeintellect.ai/)의
원본 로고와 디자인 방향을 개인용 Prime Desktop에 적용했습니다.

## 원본과 사용 위치

| 자산 | 공식 출처 | 사용 |
| --- | --- | --- |
| 헤더 SVG | [primeintellect-logo.svg](https://www.primeintellect.ai/icons/primeintellect-logo.svg) | 사이드바 전체 로고 |
| 워드마크 SVG | [primeintellect-text-logo.svg](https://www.primeintellect.ai/icons/primeintellect-text-logo.svg) | 설정 화면 |
| 800×800 PNG | [logo-icon.png](https://www.primeintellect.ai/icons/logo-icon.png) | 공식 원본 참고용 보존 |
| 분리한 심볼 SVG | 헤더 SVG의 마지막 두 path | 빈 화면·답변 마크·favicon·앱 아이콘 |

원본은 `src/renderer/assets/brand`에 그대로 보관합니다. 심볼은 원본 path의 좌표와
흰색을 변경하지 않고 viewBox만 맞췄습니다. 원본 SVG는 외부 자산으로 formatter에서
제외하며, 화면의 img에서 대체 텍스트를 제공합니다. 로고는 Prime Intellect의 자산이며
이 프로젝트 코드의 MIT 라이선스로 재라이선스하지 않습니다.

SHA-256:

```text
primeintellect-logo.svg
108fb8057cf432b47c07329812c980d928b5d9b400fea3cfe9df9c37e85b7e24
primeintellect-wordmark.svg
805c488f758dfed7fe663860720f8ed1c7bdb4ffbcdbd8237e2dd7ff6adb107e
primeintellect-mark-official.png
3d7b0ddac38e785bace1523d2be274591b47dad82a0a5f3572230a40ff3e9328
```

## macOS 아이콘

`scripts/build-icons.mjs`는 원본 심볼을 어두운 macOS 아이콘 배경에 배치하고,
벡터에서 직접 각 해상도를 렌더링합니다. 작은 PNG를 확대하거나 로고를 다시 그리지
않습니다. 배경과 여백은 Desktop용이며 심볼 자체의 모양은 공식 원본입니다.

- `assets/prime-desktop.svg`: Desktop 아이콘 배치 원본
- `assets/prime-desktop-1024.png`: 1024px 렌더
- `assets/prime-desktop.icns`: 16px부터 Retina 1024px까지 포함
- `dist/brand/app-icon.png`: 실행 중 Dock에 사용하는 로컬 이미지

`npm run build`가 아이콘을 생성합니다. macOS의 `/usr/bin/iconutil`을 사용하며,
샌드박스에서 변환이 제한되면 일반 macOS 터미널에서 빌드해야 합니다. Packager의
새 `.icon` 형식 미발견 경고는 선택적 Icon Composer 형식에 관한 것으로, 이 앱은
`.icns`를 사용합니다. Smoke는 번들의 CFBundleIconFile과 ICNS 파일 내용까지 검사합니다.

## 디자인 방향

공식 사이트의 `#0e0e0e`·`#111111` 배경, 흰색 로고, 얇은 반투명 경계선과 기술적인
모노스페이스 라벨을 참고했습니다. 숲과 빛의 분위기는 빈 화면의 은은한 색조로만
반영하고, 긴 대화는 균일한 배경에 표시합니다. 본문에는 시스템 sans, 보조 라벨에는
시스템 monospace를 사용합니다. 사이트의 trial 웹폰트 파일은 번들에 포함하지 않습니다.

화면·로고·아이콘은 모두 로컬 번들이며, 실행 중 공식 사이트에 자산을 요청하지 않습니다.
