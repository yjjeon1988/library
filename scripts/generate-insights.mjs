// GitHub Models(무료 추론 API)로 알라딘 소개글을 근거로 책 핵심 인사이트를 자동 생성해
// data/insights.json 에 저장한다.
// - 증분: 이미 insights.json 에 있는 책은 건너뛴다.
// - 알라딘 소개글(fullDescription/description)이 없는 책은 건너뛴다.
// - GitHub Actions: 워크플로 permissions에 `models: read` 만 있으면 GITHUB_TOKEN으로 그대로 동작.
// - 로컬: models:read 권한이 있는 개인 액세스 토큰을 GITHUB_TOKEN 환경변수로 넘긴다.
//   (https://github.com/settings/tokens → Fine-grained token → Account permissions → Models: Read-only)
//
//   GITHUB_TOKEN=github_pat_... node scripts/generate-insights.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseCSV, bookKey } from './lib-csv.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CSV_PATH = path.join(ROOT, 'data', 'books.csv');
const ALADIN_PATH = path.join(ROOT, 'data', 'aladin.json');
const INSIGHTS_PATH = path.join(ROOT, 'data', 'insights.json');

const TOKEN = process.env.GITHUB_TOKEN;
const MODEL = process.env.GH_MODELS_MODEL || 'openai/gpt-4o-mini';
const SLEEP_MS = Number(process.env.GH_MODELS_SLEEP_MS || 4000); // 무료 등급 분당 요청 제한 대응
const ENDPOINT = 'https://models.github.ai/inference/chat/completions';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('JSON 블록을 찾을 수 없음');
  return JSON.parse(text.slice(start, end + 1));
}

async function generateInsight(title, author, intro) {
  const prompt =
    `아래는 책 "${title}"${author ? ` (저자: ${author})` : ''}의 소개글이다.\n\n` +
    `"""\n${intro.slice(0, 4000)}\n"""\n\n` +
    `이 소개글만 근거로, 과장하거나 없는 내용을 지어내지 말고 다음 JSON 형식으로만 답하라. ` +
    `다른 텍스트나 코드블록 없이 JSON 객체 하나만 출력할 것.\n` +
    `{"oneLine": "책의 핵심 메시지를 압축한 한 문장(한국어)", ` +
    `"insights": ["독자에게 실질적으로 도움되는 핵심 인사이트 1", "핵심 인사이트 2", "핵심 인사이트 3"]}`;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  return extractJson(text);
}

async function main() {
  if (!TOKEN) {
    console.error('환경변수 GITHUB_TOKEN 이 필요합니다 (models: read 권한).');
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
