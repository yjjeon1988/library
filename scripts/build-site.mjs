import fs from 'node:fs/promises';
import path from 'node:path';
import { parseCSV, extractYes24ProductId } from './lib-csv.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CSV_PATH = path.join(ROOT, 'data', 'books.csv');
const COVERS_DIR = path.join(ROOT, 'covers');
const DIST_DIR = path.join(ROOT, 'dist');

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

function renderBook(b, idx) {
  const title = b['도서제목'] || b['Title'] || '';
  const author = b['저자'] || b['Author'] || '';
  const link = b['링크'] || b['Link'] || '';
  const dateStr = b['완독일'] || '';
  const date = parseDateInfo(dateStr);
  const pid = extractYes24ProductId(link);
  const coverPath = pid ? `covers/${pid}.jpg` : fallbackCoverSvg(title, author, idx);
  const fallback = fallbackCoverSvg(title, author, idx);
  const href = link ? escapeHtml(link) : '#';
  const dateHtml = date ? `<div class="book-date">${date.formatted}</div>` : '';
  const tooltip = `${escapeHtml(title)}${author ? ` — ${escapeHtml(author)}` : ''}${date ? ` · ${date.formatted}` : ''}`;
  return `      <a class="book" href="${href}" target="_blank" rel="noopener" title="${tooltip}">
        <div class="book-cover-wrap">
          <img class="book-cover" src="${escapeHtml(coverPath)}" alt="${escapeHtml(title)}" width="200" height="300" loading="lazy" onerror="this.onerror=null;this.src='${fallback}';" />
        </div>
        <div class="book-info">
          <div class="book-title">${escapeHtml(title)}</div>
          <div class="book-author">${escapeHtml(author)}</div>
          ${dateHtml}
        </div>
      </a>`;
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

  .view-toggle {
    display: flex;
    gap: 0;
    background: rgba(0,0,0,0.35);
    border-radius: 20px;
    padding: 3px;
    flex-shrink: 0;
  }
  .view-toggle button {
    padding: 7px 16px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 18px;
    font-size: 12px;
    font-weight: 500;
    font-family: inherit;
    transition: all 0.2s;
  }
  .view-toggle button:hover { color: var(--text-primary); }
  .view-toggle button.active {
    background: var(--text-primary);
    color: var(--bg-deep);
    font-weight: 600;
  }

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
  body[data-view="category"] #view-year,
  body[data-view="category"] #nav-year { display: none; }
  body[data-view="year"] #view-category,
  body[data-view="year"] #nav-category { display: none; }

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
  }
</style>
</head>
<body data-view="category">
  <header class="topbar">
    <div class="topbar-inner">
      <div class="brand">📚 나의 서재</div>
      <div class="view-toggle" role="tablist">
        <button data-view="category" class="active" role="tab" aria-selected="true">카테고리</button>
        <button data-view="year" role="tab" aria-selected="false">연도</button>
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

  <main class="shelves" id="view-category">
${categoryShelvesHtml}
  </main>

  <main class="shelves" id="view-year">
${yearShelvesHtml}
  </main>

  <footer>Built from Notion · ${new Date().toISOString().slice(0, 10)}</footer>

  <button class="back-to-top" id="backToTop" aria-label="맨 위로" title="맨 위로">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 19V5"/>
      <path d="M5 12l7-7 7 7"/>
    </svg>
  </button>

  <script>
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
