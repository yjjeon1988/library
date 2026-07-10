// 알라딘 OpenAPI로 도서 평점·소개를 수집해 data/aladin.json 에 캐시한다.
// - 키: yes24 상품ID(pid). 링크가 없으면 `제목|저자`.
// - 증분: 이미 캐시에 있는 책은 건너뛴다 (--force 로 전체 재수집).
// - 환경변수 ALADIN_TTB_KEY 필요.
//
//   ALADIN_TTB_KEY=ttb... node scripts/enrich-aladin.mjs
//   ALADIN_TTB_KEY=ttb... node scripts/enrich-aladin.mjs --force
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseCSV, bookKey, isSuspectMatch } from './lib-csv.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CSV_PATH = path.join(ROOT, 'data', 'books.csv');
const OUT_PATH = path.join(ROOT, 'data', 'aladin.json');

const TTB = process.env.ALADIN_TTB_KEY;
const FORCE = process.argv.includes('--force');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiGet(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'bookshelf-enrich/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  return JSON.parse(text);
}

async function fetchAladin(title, author) {
  const q = encodeURIComponent(title);
  const searchUrl =
    `https://www.aladin.co.kr/ttb/api/ItemSearch.aspx?ttbkey=${TTB}` +
    `&Query=${q}&QueryType=Title&MaxResults=1&start=1&SearchTarget=Book` +
    `&output=js&Version=20131101`;
  const search = await apiGet(searchUrl);
  const item = search.item?.[0];
  if (!item) return null;

  const out = {
    aladinTitle: item.title || '',
    aladinAuthor: item.author || '',
    aladinLink: (item.link || '').replace(/&amp;/g, '&'),
    description: item.description || '',
    categoryName: item.categoryName || '',
    isbn13: item.isbn13 || '',
    cover: item.cover || '',
    pubDate: item.pubDate || '',
    // customerReviewRank: 0~10 정수 (별점×2). ratingInfo 실패 시 폴백.
    reviewRank: typeof item.customerReviewRank === 'number' ? item.customerReviewRank : null,
    ratingScore: null,
    ratingCount: null,
    toc: '',
    fullDescription: '',
    fetchedAt: new Date().toISOString().slice(0, 10),
  };

  // ItemLookUp 으로 정밀 평점(0~10 소수)·목차·상세소개 보강
  if (out.isbn13) {
    try {
      const lookupUrl =
        `https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx?ttbkey=${TTB}` +
        `&itemIdType=ISBN13&ItemId=${out.isbn13}&output=js&Version=20131101` +
        `&OptResult=ratingInfo,Toc,fulldescription`;
      const look = await apiGet(lookupUrl);
      const li = look.item?.[0];
      const sub = li?.subInfo || {};
      if (sub.ratingInfo) {
        out.ratingScore = sub.ratingInfo.ratingScore ?? null;
        out.ratingCount = sub.ratingInfo.ratingCount ?? null;
      }
      out.toc = (sub.toc || '').trim();
      out.fullDescription = (sub.fullDescription || '').trim();
    } catch (e) {
      // 상세조회 실패해도 검색결과만으로 진행
    }
  }
  return out;
}

async function main() {
  if (!TTB) {
    console.error('환경변수 ALADIN_TTB_KEY 가 필요합니다.');
    process.exit(1);
  }

  const text = await fs.readFile(CSV_PATH, 'utf-8');
  const books = parseCSV(text);

  let cache = {};
  try {
    cache = JSON.parse(await fs.readFile(OUT_PATH, 'utf-8'));
  } catch {
    cache = {};
  }

  let fetched = 0, skipped = 0, failed = 0;
  const misses = [];

  for (const b of books) {
    const key = bookKey(b);
    const title = (b['도서제목'] || b['Title'] || '').trim();
    const author = (b['저자'] || b['Author'] || '').trim();
    if (!title) continue;

    if (!FORCE && cache[key] && cache[key].ok !== false) {
      skipped++;
      continue;
    }

    try {
      const data = await fetchAladin(title, author);
      if (data) {
        const suspect = isSuspectMatch(title, data.aladinTitle);
        cache[key] = { ok: true, title, author, suspect, ...data };
        fetched++;
        if (suspect) console.log(`    ⚠ 오매칭 의심: "${title}" → "${data.aladinTitle}"`);
        console.log(`  ✓ ${title}  ⭐${data.ratingScore ?? (data.reviewRank != null ? data.reviewRank / 2 : '?')}`);
      } else {
        cache[key] = { ok: false, title, author, fetchedAt: new Date().toISOString().slice(0, 10) };
        failed++;
        misses.push(title);
        console.log(`  ✗ 검색결과 없음: ${title}`);
      }
    } catch (e) {
      failed++;
      misses.push(`${title} (${e.message})`);
      console.log(`  ! 오류: ${title} — ${e.message}`);
    }
    await sleep(220); // 알라딘 API 예의상 지연
  }

  await fs.writeFile(OUT_PATH, JSON.stringify(cache, null, 2), 'utf-8');
  console.log(`\n완료: 신규 ${fetched} · 건너뜀 ${skipped} · 실패 ${failed}`);
  if (misses.length) console.log('미매칭:', misses.slice(0, 30).join(', '));
}

main().catch((e) => { console.error(e); process.exit(1); });
