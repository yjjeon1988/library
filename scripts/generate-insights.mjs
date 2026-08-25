// Google Gemini API(무료 티어)로 알라딘 소개글을 근거로 책 핵심 인사이트를 자동 생성해
// data/insights.json 에 저장한다.
// - 증분: 이미 insights.json 에 있는 책은 건너뛴다.
// - 알라딘 소개글(fullDescription/description)이 없는 책은 건너뛴다.
// - 환경변수 GEMINI_API_KEY 필요 (무료: https://aistudio.google.com/apikey).
//   GEMINI_MODEL 로 모델 override 가능 (기본 gemini-3.5-flash-lite).
//
//   GEMINI_API_KEY=... node scripts/generate-insights.mjs
//
// (2026-07-30 GitHub Models 완전 종료로 Anthropic API → GitHub Models → Gemini API 순으로 교체됨)
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseCSV, bookKey } from './lib-csv.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CSV_PATH = path.join(ROOT, 'data', 'books.csv');
const ALADIN_PATH = path.join(ROOT, 'data', 'aladin.json');
const INSIGHTS_PATH = path.join(ROOT, 'data', 'insights.json');

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const SLEEP_MS = Number(process.env.GEMINI_SLEEP_MS || 4500); // 무료 등급 분당 요청 제한(15 RPM) 대응
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    oneLine: { type: 'string' },
    insights: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
  },
  required: ['oneLine', 'insights'],
};

async function generateInsight(title, author, intro) {
  const prompt =
    `아래는 책 "${title}"${author ? ` (저자: ${author})` : ''}의 소개글이다.\n\n` +
    `"""\n${intro.slice(0, 4000)}\n"""\n\n` +
    `이 소개글만 근거로, 과장하거나 없는 내용을 지어내지 말고 한국어로 한 줄 요약(oneLine)과 ` +
    `독자에게 실질적으로 도움되는 핵심 인사이트 3가지(insights)를 작성하라.`;

  const res = await fetch(`${ENDPOINT}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('응답에 텍스트 없음');
  return JSON.parse(text);
}

async function main() {
  if (!API_KEY) {
    console.error('환경변수 GEMINI_API_KEY 가 필요합니다.');
    process.exit(1);
  }

  const csvText = await fs.readFile(CSV_PATH, 'utf-8');
  const books = parseCSV(csvText);
  const aladin = JSON.parse(await fs.readFile(ALADIN_PATH, 'utf-8').catch(() => '{}'));

  let insights = {};
  try {
    insights = JSON.parse(await fs.readFile(INSIGHTS_PATH, 'utf-8'));
  } catch {
    insights = {};
  }

  let generated = 0, skipped = 0, failed = 0, noIntro = 0;

  for (const b of books) {
    const key = bookKey(b);
    const title = (b['도서제목'] || b['Title'] || '').trim();
    const author = (b['저자'] || b['Author'] || '').trim();
    if (!title) continue;

    if (insights[key] && insights[key].oneLine) {
      skipped++;
      continue;
    }

    const a = aladin[key];
    const intro = (a?.fullDescription || a?.description || '').trim();
    if (!intro) {
      noIntro++;
      continue;
    }

    try {
      const result = await generateInsight(title, author, intro);
      const oneLine = (result.oneLine || '').trim();
      const arr = Array.isArray(result.insights) ? result.insights.filter((x) => x && x.trim()) : [];
      if (!oneLine || arr.length < 2) {
        failed++;
        console.log(`  ✗ 형식 불량: ${title}`);
        continue;
      }
      insights[key] = { oneLine, insights: arr };
      generated++;
      console.log(`  ✓ ${title}`);
    } catch (e) {
      failed++;
      console.log(`  ! 오류: ${title} — ${e.message}`);
    }
    await sleep(SLEEP_MS);
  }

  await fs.writeFile(INSIGHTS_PATH, JSON.stringify(insights, null, 2) + '\n', 'utf-8');
  console.log(`\n완료: 생성 ${generated} · 건너뜀 ${skipped} · 소개글 없음 ${noIntro} · 실패 ${failed}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
