// out-batch*.json 을 data/insights.json 에 병합·검증한다.
// 각 항목이 {oneLine, insights[3]} 형식인지 확인하고 걸러낸다.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const INS_PATH = path.join(ROOT, 'data', 'insights.json');

const insights = JSON.parse(fs.readFileSync(INS_PATH, 'utf8'));
let added = 0, skipped = 0;
const bad = [];

for (const f of fs.readdirSync(ROOT)) {
  if (!/^out-batch\d+\.json$/.test(f)) continue;
  let obj;
  try {
    obj = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  } catch (e) {
    console.log(`  ! ${f} JSON 파싱 실패: ${e.message}`);
    continue;
  }
  for (const [key, v] of Object.entries(obj)) {
    const oneLine = (v && v.oneLine || '').trim();
    const arr = Array.isArray(v && v.insights) ? v.insights.filter(x => x && x.trim()) : [];
    if (!oneLine || arr.length < 2) { bad.push(`${key} (${f})`); skipped++; continue; }
    insights[key] = { oneLine, insights: arr };
    added++;
  }
}

fs.writeFileSync(INS_PATH, JSON.stringify(insights, null, 2) + '\n', 'utf8');
console.log(`병합 완료: 추가/갱신 ${added} · 불량 ${skipped} · 총 ${Object.keys(insights).length}권`);
if (bad.length) console.log('불량:', bad.slice(0, 20).join(', '));
