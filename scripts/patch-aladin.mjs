// 오매칭된 책을 정확한 알라딘 ItemId로 직접 조회해 data/aladin.json 을 바로잡는다.
// 사용자가 확인한 상품이므로 suspect=false 로 고정한다.
//   ALADIN_TTB_KEY=ttb... node scripts/patch-aladin.mjs
import fs from 'node:fs';
import path from 'node:path';
import { parseCSV, bookKey } from './lib-csv.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const AL_PATH = path.join(ROOT, 'data', 'aladin.json');
const TTB = process.env.ALADIN_TTB_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 제목(정확 일치) → 알라딘 ItemId
const FIX = {
  '에이전틱 AI': '384347624',
  '첫 줄': '372993925',
  '좋은 기분': '330508029',
  '더 팀': '228682602',
  '더 체인지': '248332678',
  '그림으로 이해하는 네트워크 구조와 기술': '320655918',
  '임원 : 인사제도와 인사관리': '374417434',
  'The Goal 2': '289177682',
  '누가 내 치즈를 옮겼을까? + 내 치즈는 어디에서 왔을까?': '59172854',
  'ChatGPT x HR': '321004970',
};

async function lookupByItemId(itemId) {
  const url =
    `https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx?ttbkey=${TTB}` +
    `&itemIdType=ItemId&ItemId=${itemId}&output=js&Version=20131101` +
    `&OptResult=ratingInfo,Toc,fulldescription`;
  const res = await fetch(url, { headers: { 'User-Agent': 'bookshelf-patch/1.0' } });
  const it = JSON.parse(await res.text()).item?.[0];
  if (!it) return null;
  const sub = it.subInfo || {};
  return {
    aladinTitle: it.title || '',
    aladinAuthor: it.author || '',
    aladinLink: (it.link || '').replace(/&amp;/g, '&'),
    description: it.description || '',
    categoryName: it.categoryName || '',
    isbn13: it.isbn13 || '',
    cover: it.cover || '',
    pubDate: it.pubDate || '',
    reviewRank: typeof it.customerReviewRank === 'number' ? it.customerReviewRank : null,
    ratingScore: sub.ratingInfo?.ratingScore ?? null,
    ratingCount: sub.ratingInfo?.ratingCount ?? null,
    toc: (sub.toc || '').trim(),
    fullDescription: (sub.fullDescription || '').trim(),
    fetchedAt: new Date().toISOString().slice(0, 10),
  };
}

async function main() {
  if (!TTB) { console.error('ALADIN_TTB_KEY 필요'); process.exit(1); }
  const books = parseCSV(fs.readFileSync(path.join(ROOT, 'data', 'books.csv'), 'utf8'));
  const cache = JSON.parse(fs.readFileSync(AL_PATH, 'utf8'));

  const titleToKey = {};
  for (const b of books) titleToKey[(b['도서제목'] || '').trim()] = { key: bookKey(b), author: b['저자'] || '' };

  for (const [title, itemId] of Object.entries(FIX)) {
    const m = titleToKey[title];
    if (!m) { console.log(`  ? CSV에 없음: ${title}`); continue; }
    const data = await lookupByItemId(itemId);
    if (!data) { console.log(`  ! 조회 실패: ${title} (${itemId})`); continue; }
    cache[m.key] = { ok: true, title, author: m.author, suspect: false, ...data };
    console.log(`  ✓ ${title} → 「${data.aladinTitle}」  ⭐${data.ratingScore ?? '-'} (리뷰 ${data.ratingCount ?? 0})`);
    await sleep(220);
  }

  fs.writeFileSync(AL_PATH, JSON.stringify(cache, null, 2), 'utf8');
  console.log('data/aladin.json 갱신 완료');
}
main().catch((e) => { console.error(e); process.exit(1); });
