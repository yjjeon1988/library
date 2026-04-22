# 나의 서재

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

즉시 반영하고 싶으면 [Actions 탭](https://github.com/yjjeon88/library/actions)에서 "Run workflow" 수동 실행.

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
