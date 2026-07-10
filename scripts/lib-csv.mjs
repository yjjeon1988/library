// Minimal CSV parser — handles quoted fields, escaped quotes, newlines inside quotes.
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = false; }
      } else {
        current += c;
      }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { row.push(current); current = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(current); current = '';
        if (row.some(v => v !== '')) rows.push(row);
        row = [];
      } else {
        current += c;
      }
    }
  }
  if (current !== '' || row.length) { row.push(current); if (row.some(v => v !== '')) rows.push(row); }

  if (rows.length === 0) return [];
  const header = rows[0].map(h => h.trim().replace(/^﻿/, ''));
  return rows.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

export function extractYes24ProductId(url) {
  if (!url) return null;
  const m = url.match(/Goods\/(\d+)/i);
  return m ? m[1] : null;
}

// 제목 정규화: 한글·영숫자만 남긴다.
function normTitle(s) {
  return (s || '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
}

// csv 제목과 알라딘 제목의 일치도(0~1). 알라딘은 "제목 - 부제" 형태가 흔하다.
export function titleMatchScore(csvTitle, aladinTitle) {
  const x = normTitle(csvTitle);
  const y = normTitle(aladinTitle);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (y.startsWith(x) || x.startsWith(y)) return 1;      // 부제 포함
  if (y.includes(x) || x.includes(y)) return 0.9;
  const bigrams = (s) => {                                 // 문자 bigram Jaccard
    const g = new Set();
    for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2));
    return g;
  };
  const A = bigrams(x), B = bigrams(y);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  const uni = A.size + B.size - inter;
  return uni ? inter / uni : 0;
}

// 알라딘 검색이 엉뚱한 책을 물어왔는지 판정. 일치도 0.4 미만이면 오매칭으로 본다.
export function isSuspectMatch(csvTitle, aladinTitle) {
  return titleMatchScore(csvTitle, aladinTitle) < 0.4;
}

// aladin.json / insights.json 과 도서를 잇는 안정 키.
// yes24 상품ID 우선, 없으면 `t:제목|저자`.
export function bookKey(b) {
  const pid = extractYes24ProductId(b['링크'] || b['Link'] || '');
  if (pid) return `y${pid}`;
  const title = (b['도서제목'] || b['Title'] || '').trim();
  const author = (b['저자'] || b['Author'] || '').trim();
  return `t:${title}|${author}`;
}
