import fs from 'node:fs/promises';
import path from 'node:path';
import { parseCSV, extractYes24ProductId, bookKey, isSuspectMatch } from './lib-csv.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CSV_PATH = path.join(ROOT, 'data', 'books.csv');
const ALADIN_PATH = path.join(ROOT, 'data', 'aladin.json');
const INSIGHTS_PATH = path.join(ROOT, 'data', 'insights.json');
const COVERS_DIR = path.join(ROOT, 'covers');
const DIST_DIR = path.join(ROOT, 'dist');

// main() 에서 채운다. renderBook 이 참조.
let ALADIN = {};
let INSIGHTS = {};

const escapeHtml = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// 분류(구분) 통합 매핑. 노션 원본 값과 무관하게 빌드 시 아래 규칙으로 묶는다.
// 노션 DB를 건드리지 않아도 동기화 이후 항상 통합 상태가 유지된다.
const CATEGORY_MAP = {
  '인문': '인문교양',
  '사회과학': '인문교양',
};
const normalizeCategory = (cat) => CATEGORY_MAP[cat] || cat;

const paletteColors = ['#5c4636', '#6b4f3a', '#4a3a2e', '#5e4838', '#553f30', '#6a4a36', '#4e3c30', '#604838'];

function fallbackCoverSvg(title = '', author = '', idx = 0) {
  const color = paletteColors[idx % paletteColors.length];
  const t = escapeHtml(title.slice(0, 18));
  const a = escapeHtml(author.slice(0, 20));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><rect fill="${color}" width="200" height="300"/><text x="100" y="140" text-anchor="middle" fill="rgba(245,232,208,0.92)" font-family="serif" font-size="14" font-weight="bold">${t}</text><text x="100" y="170" text-anchor="middle" fill="rgba(245,232,208,0.55)" font-family="sans-serif" font-size="10">${a}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function parseDateInfo(s) {
  if (!s) return null;
  const m = s.match(/(\d{4})[^\d]+(\d{1,2})[^\d]+(\d{1,2})/);
  if (!m) return null;
  const year = +m[1], month = +m[2], day = +m[3];
  return {
    year, month, day,
    ts: new Date(year, month - 1, day).getTime(),
    formatted: `${year}.${String(month).padStart(2, '0')}`,
  };
}

// 오매칭이면 평점·소개를 신뢰하지 않는다. 신뢰 가능한 알라딘 항목만 반환.
function trustedAladin(key, title) {
  const al = ALADIN[key];
  if (!al || al.ok === false) return {};
  const suspect = al.suspect ?? isSuspectMatch(title, al.aladinTitle);
  return suspect ? {} : al;
}

// 평점 배지: 0보다 큰 평점이 있을 때만. rating 은 0~10 스케일.
function ratingBadge(rating) {
  if (!rating || rating <= 0) return '';
  return `<div class="rating-badge" aria-label="평점 ${rating}점"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7z"/></svg><span>${rating.toFixed(1)}</span></div>`;
}

function renderBook(b, idx) {
  const title = b['도서제목'] || b['Title'] || '';
  const author = b['저자'] || b['Author'] || '';
  const link = b['링크'] || b['Link'] || '';
  const dateStr = b['완독일'] || '';
  const date = parseDateInfo(dateStr);
  const pid = extractYes24ProductId(link);
  const coverPath = pid ? `covers/${pid}.jpg` : fallbackCoverSvg(title, author, idx);
  const fallback = fallbackCoverSvg(title, author, idx);
  const key = bookKey(b);
  const al = trustedAladin(key, title);
  const rating = al.ratingScore ?? (al.reviewRank != null ? al.reviewRank / 2 : null);
  const hasInsight = !!(INSIGHTS[key] && (INSIGHTS[key].oneLine || (INSIGHTS[key].insights || []).length));
  const dateHtml = date ? `<div class="book-date">${date.formatted}</div>` : '';
  const tooltip = `${escapeHtml(title)}${author ? ` — ${escapeHtml(author)}` : ''}${date ? ` · ${date.formatted}` : ''}`;
  return `      <article class="book" role="button" tabindex="0" data-key="${escapeHtml(key)}" title="${tooltip}" aria-label="${escapeHtml(title)} 상세 보기">
        <div class="book-cover-wrap">
          ${ratingBadge(rating)}
          ${hasInsight ? '<div class="insight-dot" aria-hidden="true" title="핵심 인사이트 있음"></div>' : ''}
          <img class="book-cover" src="${escapeHtml(coverPath)}" alt="${escapeHtml(title)}" width="200" height="300" loading="lazy" onerror="this.onerror=null;this.src='${fallback}';" />
        </div>
        <div class="book-info">
          <div class="book-title">${escapeHtml(title)}</div>
          <div class="book-author">${escapeHtml(author)}</div>
          ${dateHtml}
        </div>
      </article>`;
}

// 모달 채움용 데이터. 키 → 표시 정보.
function buildBookData(books) {
  const data = {};
  for (const b of books) {
    const key = bookKey(b);
    if (data[key]) continue;
    const title = b['도서제목'] || b['Title'] || '';
    const author = b['저자'] || b['Author'] || '';
    const link = b['링크'] || b['Link'] || '';
    const date = parseDateInfo(b['완독일']);
    const pid = extractYes24ProductId(link);
    const al = trustedAladin(key, title);
    const ins = INSIGHTS[key] || {};
    const rating = al.ratingScore ?? (al.reviewRank != null ? al.reviewRank / 2 : null);
    data[key] = {
      title, author,
      category: b['구분'] || b['Category'] || '',
      date: date ? `${date.year}.${String(date.month).padStart(2, '0')}.${String(date.day).padStart(2, '0')}` : '',
      cover: pid ? `covers/${pid}.jpg` : '',
      rating: rating ?? null,
      ratingCount: al.ratingCount ?? null,
      oneLine: ins.oneLine || '',
      insights: ins.insights || [],
      description: al.description || '',
      yes24: link || '',
      aladin: al.aladinLink || '',
    };
  }
  return data;
}

function renderShelf(id, heading, count, booksHtml, subtitle = '') {
  return `    <section class="shelf" id="${id}">
      <div class="shelf-header">
        <h2 class="shelf-title">${escapeHtml(heading)}</h2>
        <div class="shelf-meta">
          <span class="shelf-count">${count}권</span>
          ${subtitle ? `<span class="shelf-sub">${escapeHtml(subtitle)}</span>` : ''}
        </div>
      </div>
      <div class="books">
${booksHtml}
      </div>
    </section>`;
}

async function main() {
  const text = await fs.readFile(CSV_PATH, 'utf-8');
  const books = parseCSV(text);

  ALADIN = await fs.readFile(ALADIN_PATH, 'utf-8').then(JSON.parse).catch(() => ({}));
  INSIGHTS = await fs.readFile(INSIGHTS_PATH, 'utf-8').then(JSON.parse).catch(() => ({}));

  await fs.rm(DIST_DIR, { recursive: true, force: true });
  await fs.mkdir(path.join(DIST_DIR, 'covers'), { recursive: true });

  const coverFiles = await fs.readdir(COVERS_DIR).catch(() => []);
  for (const f of coverFiles) {
    if (/\.(jpg|jpeg|png|webp)$/i.test(f)) {
      await fs.copyFile(path.join(COVERS_DIR, f), path.join(DIST_DIR, 'covers', f));
    }
  }

  const byCategory = new Map();
  for (const b of books) {
    const cat = normalizeCategory(b['구분'] || b['Category'] || '기타');
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(b);
  }
  for (const arr of byCategory.values()) {
    arr.sort((a, b) => (parseDateInfo(b['완독일'])?.ts ?? 0) - (parseDateInfo(a['완독일'])?.ts ?? 0));
  }
  const categoryEntries = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);

  const byYear = new Map();
  for (const b of books) {
    const d = parseDateInfo(b['완독일']);
    const year = d ? d.year : '미기록';
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(b);
  }
  for (const arr of byYear.values()) {
    arr.sort((a, b) => (parseDateInfo(b['완독일'])?.ts ?? 0) - (parseDateInfo(a['완독일'])?.ts ?? 0));
  }
  const yearEntries = [...byYear.entries()].sort((a, b) => {
    if (a[0] === '미기록') return 1;
    if (b[0] === '미기록') return -1;
    return b[0] - a[0];
  });

  const totalBooks = books.length;
  const bookData = buildBookData(books);
  const insightCount = Object.values(bookData).filter(d => d.oneLine || d.insights.length).length;

  // 전체 뷰: 카테고리 구분 없이 완독일 최신순으로 나열
  const allBooksSorted = [...books].sort(
    (a, b) => (parseDateInfo(b['완독일'])?.ts ?? 0) - (parseDateInfo(a['완독일'])?.ts ?? 0)
  );
  const allShelfHtml = `    <section class="shelf" id="all-books">
      <div class="books">
${allBooksSorted.map(renderBook).join('\n')}
      </div>
    </section>`;

  const categoryShelvesHtml = categoryEntries.map(([cat, bs]) => {
    const booksHtml = bs.map(renderBook).join('\n');
    return renderShelf(`cat-${encodeURIComponent(cat)}`, cat, bs.length, booksHtml);
  }).join('\n\n');

  const yearShelvesHtml = yearEntries.map(([yr, bs]) => {
    const booksHtml = bs.map(renderBook).join('\n');
    const label = yr === '미기록' ? '완독일 미기록' : `${yr}년`;
    const catCount = {};
    for (const b of bs) { const c = normalizeCategory(b['구분'] || '기타'); catCount[c] = (catCount[c] || 0) + 1; }
    const topCats = Object.entries(catCount).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${c} ${n}`).join(' · ');
    return renderShelf(`yr-${yr}`, label, bs.length, booksHtml, topCats);
  }).join('\n\n');

  const categoryNavHtml = categoryEntries.map(([cat, bs]) =>
    `<a href="#cat-${encodeURIComponent(cat)}" class="nav-link" data-target="cat-${encodeURIComponent(cat)}"><span>${escapeHtml(cat)}</span><span class="nav-count">${bs.length}</span></a>`
  ).join('');

  const yearNavHtml = yearEntries.map(([yr, bs]) => {
    const label = yr === '미기록' ? '미기록' : `${yr}`;
    return `<a href="#yr-${yr}" class="nav-link" data-target="yr-${yr}"><span>${label}</span><span class="nav-count">${bs.length}</span></a>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>독서리스트 · 나의 서재</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nanum+Myeongjo:wght@400;700;800&family=Noto+Sans+KR:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg-deep: #3d2514;
    --bg-card: #2b1810;
    --text-primary: #f5e8d0;   /* AAA on dark bg */
    --text-muted: #d4b78a;     /* ~7:1, AA large/AAA */
    --text-dim: #b59770;       /* 5.0:1, AA */
    --line: rgba(201, 168, 118, 0.14);
    --line-strong: rgba(201, 168, 118, 0.22);
    --topbar-h: 56px;
  }
  @media (max-width: 760px) {
    :root { --topbar-h: 104px; }
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { scroll-behavior: smooth; scroll-padding-top: calc(var(--topbar-h) + 24px); }
  body {
    font-family: 'Noto Sans KR', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', sans-serif;
    background:
      radial-gradient(ellipse at top, rgba(255,220,150,0.08), transparent 60%),
      linear-gradient(180deg, #4a2f1a 0%, var(--bg-deep) 100%);
    background-attachment: fixed;
    color: var(--text-primary);
    min-height: 100vh;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  a:focus-visible,
  button:focus-visible {
    outline: 2px solid var(--text-primary);
    outline-offset: 3px;
    border-radius: 3px;
  }

  /* ============ TOPBAR ============ */
  .topbar {
    position: sticky;
    top: 0;
    z-index: 50;
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    background: rgba(42, 25, 12, 0.88);
    border-bottom: 1px solid rgba(201, 168, 118, 0.15);
  }
  .topbar-inner {
    max-width: 1400px;
    margin: 0 auto;
    padding: 12px 32px;
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .brand {
    font-family: 'Nanum Myeongjo', serif;
    font-weight: 700;
    font-size: 18px;
    color: var(--text-primary);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .view-switch {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    flex-shrink: 0;
  }
  .view-switch-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    white-space: nowrap;
  }
  .view-toggle {
    display: flex;
    gap: 2px;
    background: rgba(0,0,0,0.38);
    border: 1px solid var(--line-strong);
    border-radius: 22px;
    padding: 3px;
    flex-shrink: 0;
  }
  .view-toggle button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 15px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 18px;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    white-space: nowrap;
    transition: background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
  }
  .view-toggle button svg {
    width: 15px;
    height: 15px;
    stroke-width: 2;
    opacity: 0.85;
  }
  .view-toggle button:hover { color: var(--text-primary); background: rgba(255,255,255,0.06); }
  .view-toggle button.active {
    background: var(--text-primary);
    color: var(--bg-deep);
    box-shadow: 0 2px 6px rgba(0,0,0,0.35);
  }
  .view-toggle button.active svg { opacity: 1; }

  .nav-wrap {
    flex: 1;
    overflow-x: auto;
    scrollbar-width: none;
    display: flex;
    min-width: 0;
    -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 16px, #000 calc(100% - 28px), transparent 100%);
            mask-image: linear-gradient(90deg, transparent 0, #000 16px, #000 calc(100% - 28px), transparent 100%);
  }
  .nav-wrap::-webkit-scrollbar { display: none; }
  .nav-group {
    display: flex;
    gap: 4px;
    padding: 0 4px;
  }

  .nav-link {
    font-size: 13px;
    color: var(--text-muted);
    text-decoration: none;
    white-space: nowrap;
    padding: 6px 12px;
    border-radius: 16px;
    transition: all 0.2s;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
  }
  .nav-link:hover {
    color: var(--text-primary);
    background: rgba(245, 232, 208, 0.08);
  }
  .nav-link.active {
    color: var(--bg-deep);
    background: var(--text-primary);
  }
  .nav-link.active .nav-count { color: var(--bg-deep); opacity: 0.7; }
  .nav-count {
    font-size: 11px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }

  /* ============ HERO ============ */
  .hero {
    padding: 96px 32px 48px;
    max-width: 1200px;
    margin: 0 auto;
    text-align: center;
  }
  .hero h1 {
    font-family: 'Nanum Myeongjo', serif;
    font-size: 56px;
    font-weight: 800;
    letter-spacing: -0.025em;
    color: var(--text-primary);
    margin-bottom: 14px;
    line-height: 1.1;
  }
  .hero p {
    color: var(--text-muted);
    font-size: 15px;
    letter-spacing: 0.01em;
  }

  .hero-stats {
    display: inline-flex;
    gap: 28px;
    align-items: center;
    margin-top: 40px;
    font-family: 'Nanum Myeongjo', serif;
  }
  .stat-primary {
    text-align: center;
  }
  .stat-primary .stat-num {
    font-size: 56px;
    font-weight: 800;
    color: var(--text-primary);
    line-height: 1;
    display: block;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
  }
  .stat-primary .stat-unit {
    font-size: 26px;
    font-weight: 600;
    color: var(--text-muted);
    margin-left: 4px;
    letter-spacing: 0;
  }
  .stat-primary .stat-label {
    font-size: 11px;
    color: var(--text-muted);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    margin-top: 14px;
    display: block;
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 500;
  }
  .hero-divider {
    width: 1px;
    height: 48px;
    background: rgba(201, 168, 118, 0.25);
  }
  .hero-secondary {
    display: flex;
    gap: 28px;
  }
  .stat-minor { text-align: center; }
  .stat-minor .stat-num {
    font-size: 26px;
    font-weight: 700;
    color: var(--text-primary);
    display: block;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
  }
  .stat-minor .stat-unit {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-muted);
    margin-left: 2px;
  }
  .stat-minor .stat-label {
    font-size: 11px;
    color: var(--text-dim);
    letter-spacing: 0.1em;
    margin-top: 10px;
    display: block;
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 400;
  }

  /* ============ SHELVES ============ */
  .shelves {
    max-width: 1400px;
    margin: 0 auto;
    padding: 32px 32px 80px;
  }
  .shelf {
    margin-bottom: 64px;
    scroll-margin-top: calc(var(--topbar-h) + 24px);
    padding-bottom: 40px;
    border-bottom: 1px solid var(--line);
  }
  .shelf:last-child { border-bottom: none; }
  .shelf-header {
    display: flex;
    align-items: baseline;
    gap: 16px;
    margin-bottom: 28px;
    padding: 0 4px;
    flex-wrap: wrap;
  }
  .shelf-title {
    font-family: 'Nanum Myeongjo', serif;
    font-size: 26px;
    font-weight: 700;
    color: var(--text-primary);
    letter-spacing: -0.01em;
  }
  .shelf-meta {
    display: flex;
    align-items: baseline;
    gap: 10px;
    font-size: 13px;
  }
  .shelf-count {
    color: var(--text-dim);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .shelf-sub {
    color: var(--text-dim);
    opacity: 0.85;
  }
  .shelf-sub::before {
    content: '·';
    margin-right: 10px;
    color: var(--text-dim);
    opacity: 0.6;
  }

  .books {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
    gap: 36px 24px;
    padding: 8px 4px;
  }

  /* ============ BOOK CARD ============ */
  .book {
    cursor: pointer;
    transition: transform 0.25s ease;
    text-decoration: none;
    color: inherit;
    display: block;
  }
  .book:hover { transform: translateY(-6px); }

  .book-cover-wrap {
    width: 100%;
    aspect-ratio: 2/3;
    position: relative;
    overflow: hidden;
    background: var(--bg-card);
    border-radius: 2px;
    box-shadow:
      0 10px 20px rgba(0,0,0,0.55),
      0 2px 4px rgba(0,0,0,0.35),
      inset 0 0 0 1px rgba(0,0,0,0.2);
    transition: box-shadow 0.25s ease;
  }
  .book:hover .book-cover-wrap {
    box-shadow:
      0 16px 28px rgba(0,0,0,0.65),
      0 4px 8px rgba(0,0,0,0.4),
      inset 0 0 0 1px rgba(0,0,0,0.2);
  }
  .book-cover {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .book-info {
    margin-top: 12px;
    padding: 0 2px;
  }
  .book-title {
    font-size: 13.5px;
    font-weight: 600;
    line-height: 1.4;
    color: var(--text-primary);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    letter-spacing: -0.005em;
  }
  .book-author {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-muted);
    margin-top: 6px;
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .book-date {
    font-size: 12px;
    color: var(--text-dim);
    margin-top: 4px;
    font-family: 'Nanum Myeongjo', serif;
    letter-spacing: 0.04em;
    font-variant-numeric: tabular-nums;
  }

  footer {
    text-align: center;
    padding: 48px 20px;
    color: var(--text-dim);
    font-size: 12px;
    border-top: 1px solid rgba(201, 168, 118, 0.1);
    margin-top: 20px;
  }

  /* ============ VIEW SWITCHING ============ */
  #view-all, #view-category, #view-year { display: none; }
  body[data-view="all"] #view-all { display: block; }
  body[data-view="category"] #view-category { display: block; }
  body[data-view="year"] #view-year { display: block; }
  #nav-category, #nav-year { display: none; }
  body[data-view="category"] #nav-category { display: flex; }
  body[data-view="year"] #nav-year { display: flex; }
  /* 전체 뷰는 섹션 구분이 없어 사이드 내비를 숨긴다 */
  body[data-view="all"] .nav-wrap { display: none; }

  /* ============ BACK TO TOP ============ */
  .back-to-top {
    position: fixed;
    right: 28px;
    bottom: 28px;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    background: var(--text-primary);
    color: var(--bg-deep);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow:
      0 8px 20px rgba(0,0,0,0.4),
      0 2px 6px rgba(0,0,0,0.3);
    opacity: 0;
    transform: translateY(12px) scale(0.9);
    pointer-events: none;
    transition: opacity 0.25s ease, transform 0.25s ease, background 0.15s ease;
    z-index: 60;
  }
  .back-to-top.visible {
    opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: auto;
  }
  .back-to-top:hover {
    background: #ffffff;
    transform: translateY(-2px) scale(1);
  }
  .back-to-top svg {
    width: 20px;
    height: 20px;
  }

  /* ============ RATING BADGE / INSIGHT DOT ============ */
  .rating-badge {
    position: absolute;
    top: 6px;
    left: 6px;
    z-index: 2;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 3px 7px 3px 5px;
    border-radius: 12px;
    background: rgba(20, 12, 6, 0.82);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    color: #ffd873;
    font-size: 11.5px;
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    pointer-events: none;
  }
  .rating-badge svg { width: 11px; height: 11px; }
  .insight-dot {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 2;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #7fd39b;
    box-shadow: 0 0 0 2px rgba(20,12,6,0.6), 0 0 8px rgba(127,211,155,0.7);
    pointer-events: none;
  }

  /* ============ MODAL ============ */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(10, 6, 3, 0.72);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
  }
  .modal-backdrop.open { opacity: 1; pointer-events: auto; }
  .modal {
    position: relative;
    width: 100%;
    max-width: 620px;
    max-height: min(88vh, 760px);
    overflow-y: auto;
    background: linear-gradient(180deg, #34200f, #2a1a0d);
    border: 1px solid rgba(201, 168, 118, 0.22);
    border-radius: 16px;
    box-shadow: 0 30px 70px rgba(0,0,0,0.6);
    padding: 28px 30px 30px;
    transform: translateY(14px) scale(0.98);
    transition: transform 0.22s ease;
  }
  .modal-backdrop.open .modal { transform: translateY(0) scale(1); }
  .modal-close {
    position: absolute;
    top: 14px;
    right: 14px;
    width: 34px;
    height: 34px;
    border: none;
    border-radius: 50%;
    background: rgba(0,0,0,0.32);
    color: var(--text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
  }
  .modal-close:hover { background: rgba(0,0,0,0.5); color: var(--text-primary); }
  .modal-close svg { width: 18px; height: 18px; }
  .modal-head { display: flex; gap: 18px; padding-right: 34px; }
  .modal-cover {
    width: 88px;
    aspect-ratio: 2/3;
    flex-shrink: 0;
    border-radius: 3px;
    object-fit: cover;
    background: var(--bg-card);
    box-shadow: 0 8px 18px rgba(0,0,0,0.5);
  }
  .modal-headtext { min-width: 0; }
  .modal-title {
    font-family: 'Nanum Myeongjo', serif;
    font-size: 23px;
    font-weight: 800;
    color: var(--text-primary);
    line-height: 1.25;
    letter-spacing: -0.01em;
  }
  .modal-author { color: var(--text-muted); font-size: 14px; margin-top: 7px; }
  .modal-metarow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    margin-top: 12px;
    font-size: 12.5px;
    color: var(--text-dim);
  }
  .modal-rating { display: inline-flex; align-items: center; gap: 4px; color: #ffce6a; font-weight: 700; }
  .modal-rating svg { width: 14px; height: 14px; }
  .modal-chip {
    padding: 3px 9px;
    border-radius: 11px;
    background: rgba(201,168,118,0.12);
    color: var(--text-muted);
    font-size: 11.5px;
    font-weight: 500;
  }

  .modal-section { margin-top: 24px; }
  .modal-section-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-dim);
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .modal-oneline {
    font-family: 'Nanum Myeongjo', serif;
    font-size: 17px;
    line-height: 1.55;
    color: var(--text-primary);
    padding: 14px 16px;
    background: rgba(127,211,155,0.08);
    border-left: 3px solid #7fd39b;
    border-radius: 0 8px 8px 0;
  }
  .modal-insights { list-style: none; display: flex; flex-direction: column; gap: 12px; }
  .modal-insights li {
    position: relative;
    padding-left: 24px;
    font-size: 14.5px;
    line-height: 1.62;
    color: var(--text-primary);
  }
  .modal-insights li::before {
    content: '';
    position: absolute;
    left: 4px;
    top: 9px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-muted);
  }
  .modal-desc {
    font-size: 13.5px;
    line-height: 1.7;
    color: var(--text-muted);
  }
  .modal-empty {
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--text-dim);
    padding: 14px 16px;
    background: rgba(0,0,0,0.18);
    border-radius: 8px;
  }
  .modal-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 26px; }
  .modal-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 10px 16px;
    border-radius: 10px;
    font-size: 13px;
    font-weight: 600;
    text-decoration: none;
    transition: transform 0.15s, background 0.15s;
  }
  .modal-btn:hover { transform: translateY(-1px); }
  .modal-btn.primary { background: var(--text-primary); color: var(--bg-deep); }
  .modal-btn.secondary { background: rgba(201,168,118,0.14); color: var(--text-primary); }
  .modal-btn svg { width: 15px; height: 15px; }

  /* ============ RESPONSIVE ============ */
  @media (max-width: 760px) {
    .topbar-inner { gap: 12px; padding: 10px 16px; flex-wrap: wrap; }
    .brand { font-size: 16px; }
    .nav-wrap { order: 3; width: 100%; margin-top: 2px; }
    .hero { padding: 56px 20px 28px; }
    .hero h1 { font-size: 36px; }
    .hero-stats { gap: 20px; margin-top: 28px; }
    .stat-primary .stat-num { font-size: 44px; }
    .stat-primary .stat-unit { font-size: 20px; }
    .stat-minor .stat-num { font-size: 22px; }
    .stat-minor .stat-unit { font-size: 12px; }
    .hero-divider { height: 40px; }
    .hero-secondary { gap: 20px; }
    .shelves { padding: 24px 16px 60px; }
    .shelf { margin-bottom: 56px; }
    .shelf-title { font-size: 22px; }
    .books {
      grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
      gap: 28px 16px;
      padding: 4px 0;
    }
    .book-info { margin-top: 10px; }
    .book-title { font-size: 13px; }
    .book-author, .book-date { font-size: 11.5px; }
    .back-to-top { right: 16px; bottom: 16px; width: 44px; height: 44px; }
    .modal-backdrop { padding: 0; align-items: flex-end; }
    .modal {
      max-width: 100%;
      max-height: 92vh;
      border-radius: 18px 18px 0 0;
      padding: 24px 20px 28px;
    }
    .modal-title { font-size: 20px; }
    .modal-cover { width: 72px; }
    .rating-badge { font-size: 10.5px; padding: 2px 6px 2px 4px; }
  }
</style>
</head>
<body data-view="all">
  <header class="topbar">
    <div class="topbar-inner">
      <div class="brand">📚 나의 서재</div>
      <div class="view-switch">
        <span class="view-switch-label">보기</span>
        <div class="view-toggle" role="tablist">
          <button data-view="all" class="active" role="tab" aria-selected="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            전체
          </button>
          <button data-view="category" role="tab" aria-selected="false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
            카테고리
          </button>
          <button data-view="year" role="tab" aria-selected="false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            연도
          </button>
        </div>
      </div>
      <nav class="nav-wrap" aria-label="섹션 바로가기">
        <div class="nav-group" id="nav-category">${categoryNavHtml}</div>
        <div class="nav-group" id="nav-year">${yearNavHtml}</div>
      </nav>
    </div>
  </header>

  <section class="hero">
    <h1>독서리스트</h1>
    <p>시대정신 및 철학사상 탐구 &amp; 나만의 가치 만들기</p>
    <div class="hero-stats">
      <div class="stat-primary">
        <span class="stat-num">${totalBooks}<span class="stat-unit">권</span></span>
        <span class="stat-label">완독</span>
      </div>
      <div class="hero-divider" aria-hidden="true"></div>
      <div class="hero-secondary">
        <div class="stat-minor">
          <span class="stat-num">${categoryEntries.length}<span class="stat-unit">개</span></span>
          <span class="stat-label">카테고리</span>
        </div>
        <div class="stat-minor">
          <span class="stat-num">${yearEntries.filter(([y]) => y !== '미기록').length}<span class="stat-unit">개</span></span>
          <span class="stat-label">연도</span>
        </div>
      </div>
    </div>
  </section>

  <main class="shelves" id="view-all">
${allShelfHtml}
  </main>

  <main class="shelves" id="view-category">
${categoryShelvesHtml}
  </main>

  <main class="shelves" id="view-year">
${yearShelvesHtml}
  </main>

  <footer>Built from Notion · ${new Date().toISOString().slice(0, 10)}</footer>

  <div class="modal-backdrop" id="bookModal" role="dialog" aria-modal="true" aria-labelledby="modalTitle" hidden>
    <div class="modal" id="modalBody">
      <button class="modal-close" id="modalClose" aria-label="닫기">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <div class="modal-head">
        <img class="modal-cover" id="modalCover" alt="" width="88" height="132" />
        <div class="modal-headtext">
          <div class="modal-title" id="modalTitle"></div>
          <div class="modal-author" id="modalAuthor"></div>
          <div class="modal-metarow" id="modalMeta"></div>
        </div>
      </div>
      <div id="modalContent"></div>
      <div class="modal-actions" id="modalActions"></div>
    </div>
  </div>

  <button class="back-to-top" id="backToTop" aria-label="맨 위로" title="맨 위로">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 19V5"/>
      <path d="M5 12l7-7 7 7"/>
    </svg>
  </button>

  <script>
    window.BOOK_DATA = ${JSON.stringify(bookData).replace(/</g, '\\u003c')};
  </script>
  <script>
    // ============ BOOK MODAL ============
    (function () {
      const backdrop = document.getElementById('bookModal');
      const elCover = document.getElementById('modalCover');
      const elTitle = document.getElementById('modalTitle');
      const elAuthor = document.getElementById('modalAuthor');
      const elMeta = document.getElementById('modalMeta');
      const elContent = document.getElementById('modalContent');
      const elActions = document.getElementById('modalActions');
      let lastFocus = null;

      const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const star = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7z"/></svg>';

      function fill(d) {
        elTitle.textContent = d.title || '';
        elAuthor.textContent = d.author || '';
        if (d.cover) { elCover.src = d.cover; elCover.style.display = ''; elCover.alt = d.title || ''; }
        else { elCover.removeAttribute('src'); elCover.style.display = 'none'; }

        const meta = [];
        if (d.rating) meta.push('<span class="modal-rating">' + star + d.rating.toFixed(1) +
          (d.ratingCount ? ' <span style="color:var(--text-dim);font-weight:500">· 리뷰 ' + d.ratingCount + '</span>' : '') + '</span>');
        if (d.category) meta.push('<span class="modal-chip">' + esc(d.category) + '</span>');
        if (d.date) meta.push('<span>' + esc(d.date) + ' 완독</span>');
        elMeta.innerHTML = meta.join('');

        let html = '';
        if (d.oneLine) {
          html += '<div class="modal-section"><div class="modal-section-label">한 줄 요약</div>' +
            '<div class="modal-oneline">' + esc(d.oneLine) + '</div></div>';
        }
        if (d.insights && d.insights.length) {
          html += '<div class="modal-section"><div class="modal-section-label">핵심 인사이트</div><ul class="modal-insights">' +
            d.insights.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></div>';
        }
        if (!d.oneLine && (!d.insights || !d.insights.length)) {
          html += '<div class="modal-section"><div class="modal-empty">아직 이 책의 핵심 인사이트가 정리되지 않았어요.' +
            (d.description ? ' 아래 책 소개를 참고하세요.' : '') + '</div></div>';
        }
        if (d.description) {
          html += '<div class="modal-section"><div class="modal-section-label">책 소개</div>' +
            '<div class="modal-desc">' + esc(d.description) + '</div></div>';
        }
        elContent.innerHTML = html;

        const acts = [];
        if (d.yes24) acts.push('<a class="modal-btn primary" href="' + esc(d.yes24) + '" target="_blank" rel="noopener">yes24에서 보기</a>');
        if (d.aladin) acts.push('<a class="modal-btn secondary" href="' + esc(d.aladin) + '" target="_blank" rel="noopener">알라딘에서 보기</a>');
        elActions.innerHTML = acts.join('');
      }

      function open(key) {
        const d = window.BOOK_DATA[key];
        if (!d) return;
        lastFocus = document.activeElement;
        fill(d);
        backdrop.hidden = false;
        requestAnimationFrame(() => backdrop.classList.add('open'));
        document.body.style.overflow = 'hidden';
        document.getElementById('modalClose').focus();
      }
      function close() {
        backdrop.classList.remove('open');
        document.body.style.overflow = '';
        setTimeout(() => { backdrop.hidden = true; }, 200);
        if (lastFocus) lastFocus.focus();
      }

      document.addEventListener('click', (e) => {
        const card = e.target.closest('.book');
        if (card && card.dataset.key) { open(card.dataset.key); return; }
        if (e.target === backdrop || e.target.closest('#modalClose')) close();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !backdrop.hidden) close();
        const card = e.target.closest && e.target.closest('.book');
        if (card && card.dataset.key && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault(); open(card.dataset.key);
        }
      });
    })();

    // View toggle
    document.querySelectorAll('.view-toggle button').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        document.body.dataset.view = view;
        document.querySelectorAll('.view-toggle button').forEach(b => {
          const active = b.dataset.view === view;
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', active);
        });
        document.querySelectorAll('.nav-link.active').forEach(l => l.classList.remove('active'));
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    // Scroll-spy: highlight current section in nav
    const spy = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const id = entry.target.id;
        const activeView = document.body.dataset.view;
        if (activeView === 'all') continue;
        const scope = activeView === 'category' ? '#nav-category' : '#nav-year';
        const container = document.querySelector(scope);
        if (!container) continue;
        const link = container.querySelector(\`[data-target="\${CSS.escape(id)}"]\`);
        if (!link) continue;
        container.querySelectorAll('.nav-link.active').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        // Scroll nav to keep active link visible
        const navWrap = link.closest('.nav-wrap');
        if (navWrap) {
          const linkRect = link.getBoundingClientRect();
          const wrapRect = navWrap.getBoundingClientRect();
          if (linkRect.left < wrapRect.left || linkRect.right > wrapRect.right) {
            link.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
          }
        }
      }
    }, { rootMargin: '-' + (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) + 24) + 'px 0px -60% 0px', threshold: 0 });
    document.querySelectorAll('.shelf').forEach(s => spy.observe(s));

    // Back to top
    const backBtn = document.getElementById('backToTop');
    const toggleBackBtn = () => {
      backBtn.classList.toggle('visible', window.scrollY > 400);
    };
    window.addEventListener('scroll', toggleBackBtn, { passive: true });
    backBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    toggleBackBtn();
  </script>
</body>
</html>`;

  await fs.writeFile(path.join(DIST_DIR, 'index.html'), html, 'utf-8');
  console.log(`빌드 완료: ${path.join(DIST_DIR, 'index.html')}`);
  console.log(`  ${totalBooks}권, ${categoryEntries.length}개 카테고리, ${yearEntries.length}개 연도 구간`);
}

main().catch((e) => { console.error(e); process.exit(1); });
