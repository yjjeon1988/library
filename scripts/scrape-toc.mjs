// yes24 상품 페이지에서 목차를 스크래핑해 data/toc.json 에 캐시한다.
// - 키: bookKey (yes24 pid 기반).
// - 증분: 이미 캐시에 있는 책은 건너뜀 (--force 로 전체 재수집).
// - 목차 없는 책은 lines: [] 로 기록(재시도 안 함).
//   node scripts/scrape-toc.mjs
//   node scripts/scrape-toc.mjs --force
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseCSV, extractYes24ProductId, bookKey } from './lib-csv.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CSV_PATH = path.join(ROOT, 'data', 'books.csv');
const TOC_PATH = path.join(ROOT, 'data', 'toc.json');
const DELAY_MS = 400;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const FORCE = process.argv.includes('--force');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const decodeEntities = (s) => s
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// 목차 HTML → 정제된 줄 배열
function parseToc(html) {
  const start = html.indexOf('id="infoset_toc"');
  let raw = '';
  if (start >= 0) {
    const region = html.slice(start, start + 40000);
    const m = region.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/i);
    if (m) raw = m[1];
  }
  // 폴백: 주석 구간
  if (!raw) {
    const a = html.indexOf('목차 시작'), b = html.indexOf('목차 끝');
    if (a > 0 && b > a) raw = html.slice(a, b).replace(/^[^>]*-->/, '');
  }
  if (!raw) return [];

  let txt = decodeEntities(
    raw.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  );
  txt = txt.replace(/\?*\s*·\s*\?*/g, ' · '); // 챕터 구분점(·) 주변 yes24 깨짐문자 정리
  return txt.split('\n')
    .map((l) => l.replace(/\s+/g, ' ').replace(/\s*\?\s*$/, '').trim()) // 끝 물음표(원본 깨짐) 제거
    .filter((l) => l && !/^(펼쳐보기|접어보기|더보기|목차)$/.test(l) && !l.includes('txtContentText'));
}

async function fetchToc(pid) {
  const url = `https://www.yes24.com/Product/Goods/${pid}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return parseToc(buf.toString('utf8'));
}

async function main() {
  const text = await fs.readFile(CSV_PATH, 'utf-8');
  const books = parseCSV(text);

  let cache = {};
  try { cache = JSON.parse(await fs.readFile(TOC_PATH, 'utf-8')); } catch { cache = {}; }

  let scraped = 0, withToc = 0, skipped = 0, failed = 0;
  for (let i = 0; i < books.length; i++) {
    const b = books[i];
    const title = b['도서제목'] || b['Title'] || '';
    const pid = extractYes24ProductId(b['링크'] || b['Link'] || '');
    if (!pid) continue;
    const key = bookKey(b);
    if (!FORCE && cache[key]) { skipped++; continue; }

    try {
      const lines = await fetchToc(pid);
      cache[key] = { lines, scrapedAt: new Date().toISOString().slice(0, 10) };
      scraped++;
      if (lines.length) withToc++;
      console.log(`  [${i + 1}/${books.length}] ${lines.length ? '✓ ' + lines.length + '줄' : '· 목차없음'}  ${title}`);
      await sleep(DELAY_MS);
    } catch (e) {
      failed++;
      console.log(`  [${i + 1}/${books.length}] ✗ ${title} — ${e.message}`);
    }
  }

  await fs.writeFile(TOC_PATH, JSON.stringify(cache, null, 2), 'utf-8');
  console.log(`\n완료: 신규 ${scraped}(목차 있음 ${withToc}) · 건너뜀 ${skipped} · 실패 ${failed} · 총 ${Object.keys(cache).length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
