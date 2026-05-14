# 나의 서재

**🔗 라이브 사이트: https://yjjeon1988.github.io/library/**

노션 독서 DB → yes24 표지 스크래핑 → 정적 HTML 서재 → GitHub Pages 자동 배포.

## 구조

```
도서/
├── data/books.csv              # 노션 API로 자동 동기화
├── covers/                     # yes24 표지 (신규분만 자동 스크래핑)
├── scripts/
│   ├── sync-from-notion.mjs    # 노션 API → CSV
│   ├── scrape-covers.mjs       # yes24 → 이미지
│   └── build-site.mjs          # CSV + 이미지 → HTML
├── .github/workflows/deploy.yml # 매일 자동 동기화 + 배포
└── dist/                       # 빌드 결과 (gitignore)
```

## 작동 방식 (자동)

1. **매일 09:00 KST** GitHub Actions가 자동 실행
2. 노션 API로 독서리스트 DB 전체 가져와서 `data/books.csv` 갱신
3. 신규 책만 yes24에서 표지 다운로드 (`covers/`)
4. 변경사항 있으면 git에 자동 커밋
5. 정적 사이트 빌드 → GitHub Pages 배포

**사용자가 할 일:** 노션에 책 추가만 하면 끝.

즉시 반영하고 싶으면 [Actions 탭](https://github.com/yjjeon1988/library/actions)에서 "Run workflow" 수동 실행.

## 로컬 개발

```bash
# 노션 → CSV (환경변수 필요)
NOTION_TOKEN=secret_... NOTION_DATABASE_ID=... npm run sync

# 신규 책 표지 스크래핑
npm run scrape

# 사이트 빌드 (→ dist/)
npm run build

# 전체 파이프라인
npm run all
```

## GitHub Secrets

- `NOTION_TOKEN` — 노션 internal integration secret (`ntn_...`)
  - https://www.notion.so/profile/integrations 에서 생성
  - 독서리스트 DB에 명시적 Connection 필요

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
