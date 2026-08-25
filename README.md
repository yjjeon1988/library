# 나의 서재

**🔗 라이브 사이트: https://yjjeon1988.github.io/library/**

[![Build and Deploy Bookshelf](https://github.com/yjjeon1988/library/actions/workflows/deploy.yml/badge.svg)](https://github.com/yjjeon1988/library/actions/workflows/deploy.yml)

노션 독서 DB → yes24 표지 스크래핑 → 정적 HTML 서재 → GitHub Pages 자동 배포.

## 구조

```
도서/
├── data/
│   ├── books.csv               # 노션 API로 자동 동기화
│   ├── aladin.json             # 알라딘 평점·소개 (자동 수집, 증분)
│   ├── toc.json                # yes24 목차 (자동 스크래핑, 증분)
│   └── insights.json           # 책별 AI 핵심 인사이트 (자동 생성, 증분)
├── covers/                     # yes24 표지 (신규분만 자동 스크래핑)
├── scripts/
│   ├── sync-from-notion.mjs    # 노션 API → CSV
│   ├── scrape-covers.mjs       # yes24 → 이미지
│   ├── enrich-aladin.mjs       # 알라딘 API → 평점·소개
│   ├── scrape-toc.mjs          # yes24 → 목차
│   ├── generate-insights.mjs   # Gemini API → 핵심 인사이트
│   └── build-site.mjs          # CSV + 이미지 + 평점 + 목차 + 인사이트 → HTML
├── .github/workflows/deploy.yml # 매일 자동 동기화 + 배포
└── dist/                       # 빌드 결과 (gitignore)
```

## 작동 방식 (자동)

1. **매일 09:00 KST** GitHub Actions가 자동 실행
2. 노션 API로 독서리스트 DB 전체 가져와서 `data/books.csv` 갱신
3. 신규 책만 yes24에서 표지 다운로드 (`covers/`)
4. 신규 책만 알라딘 평점·소개, yes24 목차, AI 핵심 인사이트 자동 수집·생성
5. 변경사항 있으면 git에 자동 커밋
6. 정적 사이트 빌드 → GitHub Pages 배포

**사용자가 할 일:** 노션에 책 추가만 하면 끝.

즉시 반영하고 싶으면 **[여기서 수동 실행](https://github.com/yjjeon1988/library/actions/workflows/deploy.yml)** → 우측 "Run workflow" 버튼 클릭.
(로그인 상태여야 버튼이 보인다. GitHub 정책상 클릭 한 번으로 바로 실행되는 링크는 만들 수 없다 — 최소 이 버튼 클릭은 필요하다.)

## 평점 & 핵심 인사이트

책 표지를 **클릭**하면 상세 모달이 열린다 — 알라딘 평점 ⭐, 한 줄 요약, 핵심 인사이트, 목차, yes24·알라딘 링크.

- **평점(⭐)** — 알라딘 OpenAPI로 자동 수집. 제목 앞 별점 + 모달에 표시. `enrich-aladin.mjs`가 신규 책만 증분 수집해 `data/aladin.json`에 캐시.
- **목차** — yes24 상품 페이지에서 스크래핑. `scrape-toc.mjs`가 신규 책만 증분 수집해 `data/toc.json`에 캐시. 모달에서 부/장은 굵게, 세부 항목은 들여쓰기로 표시. 목차가 없는 책(소설·에세이 등)은 알라딘 책 소개로 폴백.
- **핵심 인사이트** — 알라딘 소개글을 근거로 [Google Gemini API](https://aistudio.google.com/apikey)(무료 티어, 기본 `gemini-2.5-flash-lite`)가 자동 생성해 `data/insights.json`에 저장. `generate-insights.mjs`가 신규 책만 증분 생성. 인사이트가 있는 책은 표지 우상단에 초록 점(●) 표시.
  - 알라딘 소개글이 없는 책(검색 실패 등)은 건너뛰고, 다음 날 알라딘 정보가 채워지면 자동으로 다시 시도된다.
  - 급하게 특정 책 인사이트를 손보고 싶으면 `data/insights.json`을 직접 수정해도 된다 (다음 실행 때 이미 값이 있으면 덮어쓰지 않음).
  - (참고: 처음엔 GitHub Models 무료 추론 API를 썼으나, 2026-07-30 GitHub Models 완전 종료로 Gemini API로 교체함.)

### API 키

- `enrich-aladin.mjs`는 환경변수 `ALADIN_TTB_KEY`를 읽는다.
  - GitHub Actions에서 평점을 자동 갱신하려면 저장소 Secret에 `ALADIN_TTB_KEY` 추가. (없으면 수집 단계는 조용히 건너뜀)
  - 키 발급: https://www.aladin.co.kr/ttb/wblog_manage.aspx
- `generate-insights.mjs`는 환경변수 `GEMINI_API_KEY`를 읽는다.
  - GitHub Actions에서 인사이트를 자동 생성하려면 저장소 Secret에 `GEMINI_API_KEY` 추가. (없으면 생성 단계는 조용히 건너뜀)
  - 키 발급: https://aistudio.google.com/apikey (무료, 신용카드 등록 불필요)
  - 무료 등급은 분당·일별 요청 수 제한이 있다. 스크립트는 요청 사이 `GEMINI_SLEEP_MS`(기본 4500ms)만큼 대기해 제한을 피한다.
  - 모델은 기본 `gemini-2.5-flash-lite`. 환경변수 `GEMINI_MODEL`로 override 가능.

## 로컬 개발

```bash
# 노션 → CSV (환경변수 필요)
NOTION_TOKEN=secret_... NOTION_DATABASE_ID=... npm run sync

# 신규 책 표지 스크래핑
npm run scrape

# 알라딘 평점·소개 수집 (환경변수 필요, 증분)
ALADIN_TTB_KEY=ttb... npm run enrich
ALADIN_TTB_KEY=ttb... npm run enrich -- --force   # 전체 재수집

# yes24 목차 스크래핑 (증분)
npm run toc
npm run toc -- --force                            # 전체 재수집

# AI 핵심 인사이트 생성 (환경변수 필요, 증분)
GEMINI_API_KEY=... npm run insights

# 사이트 빌드 (→ dist/)
npm run build

# 전체 파이프라인 (sync → scrape → enrich → toc → insights → build)
npm run all
```

## GitHub Secrets

- `NOTION_TOKEN` — 노션 internal integration secret (`ntn_...`)
  - https://www.notion.so/profile/integrations 에서 생성
  - 독서리스트 DB에 명시적 Connection 필요
- `ALADIN_TTB_KEY` — 알라딘 평점·소개 자동 수집용 (없으면 조용히 건너뜀)
- `GEMINI_API_KEY` — AI 핵심 인사이트 자동 생성용 (없으면 조용히 건너뜀)

## License

`Code: MIT` · `Content: CC BY-NC-SA 4.0`

© 2026 yj.jeon (Youngjae Jeon).

이 저장소는 **이중 라이선스(dual license)** 로 배포됩니다.

| 대상 | 라이선스 | 핵심 조건 |
| --- | --- | --- |
| **코드** (`scripts/`, `.github/`, 빌드 설정 등) | MIT License | 사본·수정본에 저작권 표기 + MIT 라이선스 본문 포함 |
| **콘텐츠** (README 등 본인이 작성한 글) | CC BY-NC-SA 4.0 | ① 출처 표기 (BY) · ② 비상업적 사용에 한정 (NC) · ③ 수정본은 같은 라이선스로 공유 (SA) |

### 라이선스 적용 제외

다음은 본인 저작물이 아니므로 위 라이선스가 적용되지 않습니다. 각 권리자에게 문의하세요.

- `covers/` — yes24에서 가져온 출판사/저작권자의 도서 표지 이미지
- `data/books.csv` 의 서지정보 — 각 출판사·저자의 권리

### 콘텐츠 사용 시 지켜야 할 세 가지

1. **출처(BY)** — "© yj.jeon, https://github.com/yjjeon1988/library" 표기
2. **비상업(NC)** — 상업적 이용 금지. 상업적 활용은 사전 협의 필요
3. **동일 조건(SA)** — 콘텐츠를 수정·각색한 결과물도 같은 CC BY-NC-SA 4.0 으로 공유

### 링크

- 코드 라이선스: [LICENSE-MIT](LICENSE-MIT)
- 콘텐츠 라이선스: [LICENSE-CC-BY-NC-SA-4.0](LICENSE-CC-BY-NC-SA-4.0) · [Creative Commons BY-NC-SA 4.0 International](https://creativecommons.org/licenses/by-nc-sa/4.0/)
- 상업적 사용 협의: yj.jeon@iotrust.kr

> CC 라이선스는 글·이미지·디자인 같은 창작물용입니다. 소프트웨어 코드는 MIT로 보호되며, CC BY-NC-SA 4.0은 그 외 콘텐츠에만 적용됩니다 — [Creative Commons 공식 권장 사항](https://creativecommons.org/faq/#can-i-apply-a-creative-commons-license-to-software).
