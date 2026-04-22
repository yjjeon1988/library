import fs from 'node:fs/promises';
import path from 'node:path';

const TOKEN = process.env.NOTION_TOKEN;
const DB_ID = process.env.NOTION_DATABASE_ID;
const NOTION_VERSION = '2022-06-28';

if (!TOKEN) {
  console.error('환경변수 NOTION_TOKEN이 필요합니다.');
  process.exit(1);
}
if (!DB_ID) {
  console.error('환경변수 NOTION_DATABASE_ID가 필요합니다.');
  process.exit(1);
}

const ROOT = path.resolve(import.meta.dirname, '..');
const CSV_PATH = path.join(ROOT, 'data', 'books.csv');

async function queryDatabase() {
  const all = [];
  let cursor = undefined;
  let page = 0;
  do {
    page++;
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Notion API ${res.status} (page ${page}): ${text}`);
    }
    const data = await res.json();
    all.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : undefined;
    console.log(`  페이지 ${page}: ${data.results.length}개 받음 (누적 ${all.length})`);
  } while (cursor);
  return all;
}

function extractProperty(page, name) {
  const prop = page.properties?.[name];
  if (!prop) return '';
  switch (prop.type) {
    case 'title':
      return (prop.title || []).map((t) => t.plain_text).join('');
    case 'rich_text':
      return (prop.rich_text || []).map((t) => t.plain_text).join('');
    case 'select':
      return prop.select?.name || '';
    case 'multi_select':
      return (prop.multi_select || []).map((t) => t.name).join(', ');
    case 'date':
      return prop.date?.start || '';
    case 'url':
      return prop.url || '';
    case 'number':
      return prop.number != null ? String(prop.number) : '';
    case 'checkbox':
      return prop.checkbox ? 'true' : 'false';
    default:
      return '';
  }
}

function formatDateKorean(iso) {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${+m[1]}년 ${+m[2]}월 ${+m[3]}일`;
}

function csvEscape(s) {
  if (s == null) return '';
  const str = String(s);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

async function main() {
  console.log(`노션 DB 동기화 시작 (DB: ${DB_ID.slice(0, 8)}...)`);
  const pages = await queryDatabase();
  console.log(`총 ${pages.length}권 받음.`);

  const rows = pages.map((p) => ({
    완독일: formatDateKorean(extractProperty(p, '완독일')),
    구분: extractProperty(p, '구분'),
    도서제목: extractProperty(p, '도서제목'),
    저자: extractProperty(p, '저자'),
    출판사: extractProperty(p, '출판사'),
    링크: extractProperty(p, '링크'),
  }));

  // Sort by 완독일 desc
  const tsOf = (s) => {
    const m = s.match(/(\d{4})\D+(\d+)\D+(\d+)/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : 0;
  };
  rows.sort((a, b) => tsOf(b.완독일) - tsOf(a.완독일));

  const headers = ['완독일', '구분', '도서제목', '저자', '출판사', '링크'];
  const csv = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(',')),
  ].join('\n');

  await fs.mkdir(path.dirname(CSV_PATH), { recursive: true });
  await fs.writeFile(CSV_PATH, '﻿' + csv, 'utf-8');
  console.log(`✓ ${CSV_PATH} 저장 완료 (${rows.length}권)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
