// 국립중앙도서관 서지정보유통지원시스템(seoji) Open API로 책소개를 수집해 data/seoji.json 에 캐시한다.
// (알라딘 OpenAPI 종료 대체 — 알라딘은 평점 4곳 중 3곳을 담당했으나, 이 스크립트는 책소개만 담당.
//  평점·ISBN은 scrape-yes24.mjs가 수집한다.)
// - 키: data/yes24.json 의 isbn13 (bookKey 로 도서와 연결).
// - 책소개는 BOOK_INTRODUCTION/BOOK_SUMMARY 필드에 텍스트로 바로 들어있다
//   (같은 이름에 _URL이 붙은 필드도 있으나 실측 결과 항상 빈 값 — 참고용으로만 남겨둔다).
// - 출판사가 CIP 신청 시 등록한 정보라 커버리지가 100%가 아니다(실측 샘플 기준 약 20%).
//   책소개가 없는 책은 ok:true, description:'' 로 기록되고 인사이트 생성 단계에서 자동 스킵된다.
// - 증분: 이미 캐시에 있는 책은 건너뛴다 (--force 로 전체 재수집).
// - 환경변수 SEOJI_API_KEY 필요 (발급: https://www.nl.go.kr/NL/contents/N31101010000.do).
//
//   SEOJI_API_KEY=... node scripts/enrich-seoji.mjs
//   SEOJI_API_KEY=... node scripts/enrich-seoji.mjs --force
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseCSV, bookKey } from './lib-csv.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CSV_PATH = path.join(ROOT, 'data', 'books.csv');
const YES24_PATH = path.join(ROOT, 'data', 'yes24.json');
const OUT_PATH = path.join(ROOT, 'data', 'seoji.json');

const CERT_KEY = process.env.SEOJI_API_KEY;
const FORCE = process.argv.includes('--force');
const SLEEP_MS = Number(process.env.SEOJI_SLEEP_MS || 300);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let debugLogged = 0;

async function apiGet(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchSeoji(isbn13) {
  const url =
    `https://www.nl.go.kr/seoji/SearchApi.do?cert_key=${CERT_KEY}` +
    `&result_style=json&page_no=1&page_size=1&isbn=${isbn13}`;
  const data = await apiGet(url);
  // docs 필드 자체가 없으면 (빈 배열이 아니라) API 오류(승인 대기, 키 오류 등) 가능성이 높다 — 바로 드러낸다.
  if (!Array.isArray(data.docs)) {
    throw new Error(`예상치 못한 응답: ${JSON.stringify(data).slice(0, 300)}`);
  }
  const item = data.docs[0];
  if (!item) return null;

  if (debugLogged < 2) {
    console.log('  [debug] seoji raw response:', JSON.stringify(item, null, 2).slice(0, 2000));
    debugLogged++;
  }

  const description = (item.BOOK_INTRODUCTION || item.BOOK_SUMMARY || '').trim();

  return {
    seojiTitle: item.TITLE || '',
    seojiAuthor: item.AUTHOR || '',
    publisher: item.PUBLISHER || '',
    pubDate: item.PUBLISH_PREDATE || '',
    description,
    fetchedAt: new Date().toISOString().slice(0, 10),
  };
}

async function main() {
  if (!CERT_KEY) {
    console.error('환경변수 SEOJI_API_KEY 가 필요합니다.');
    process.exit(1);
  }

  const text = await fs.readFile(CSV_PATH, 'utf-8');
  const books = parseCSV(text);
  const yes24 = JSON.parse(await fs.readFile(YES24_PATH, 'utf-8').catch(() => '{}'));

  let cache = {};
  try { cache = JSON.parse(await fs.readFile(OUT_PATH, 'utf-8')); } catch { cache = {}; }

  let fetched = 0, skipped = 0, failed = 0, noIsbn = 0;

  for (const b of books) {
    const key = bookKey(b);
    const title = (b['도서제목'] || b['Title'] || '').trim();
    const author = (b['저자'] || b['Author'] || '').trim();
    if (!title) continue;

    if (!FORCE && cache[key] && cache[key].ok !== false) {
      skipped++;
      continue;
    }

    const isbn13 = yes24[key]?.isbn13;
    if (!isbn13) {
      noIsbn++;
      cache[key] = { ok: false, title, author, reason: 'isbn13 없음', fetchedAt: new Date().toISOString().slice(0, 10) };
      continue;
    }

    try {
      const data = await fetchSeoji(isbn13);
      if (data) {
        cache[key] = { ok: true, title, author, isbn13, ...data };
        fetched++;
        console.log(`  ✓ ${title}${data.description ? '' : ' (책소개 없음)'}`);
      } else {
        cache[key] = { ok: false, title, author, isbn13, fetchedAt: new Date().toISOString().slice(0, 10) };
        failed++;
        console.log(`  ✗ 검색결과 없음: ${title} (ISBN ${isbn13})`);
      }
    } catch (e) {
      failed++;
      console.log(`  ! 오류: ${title} — ${e.message}`);
    }
    await sleep(SLEEP_MS);
  }

  await fs.writeFile(OUT_PATH, JSON.stringify(cache, null, 2), 'utf-8');
  console.log(`\n완료: 신규 ${fetched} · 건너뜀 ${skipped} · ISBN없음 ${noIsbn} · 실패 ${failed}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
