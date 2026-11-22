/**
 * 内容审核：判断文档内容是否属于专业兽医 / 动物医学知识，并识别可过滤噪声。
 *
 * 用法：
 *   pnpm run review:check      只报告
 *   pnpm run review:fix        过滤明确的非知识噪声（URL、版权、页码、课程宣传等）
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';

const ROOT = process.cwd();
const DIRS = [path.join(ROOT, 'content/synced'), path.join(ROOT, 'content/manual')];
const fix = process.argv.includes('--fix');

// 明确的非知识噪声：可直接过滤
const NOISE = [
  /^\s*https?:\/\/\S+\s*$/i,
  /^\s*www\.\S+\s*$/i,
  /^\s*[\w.+-]+@[\w.-]+\.\w+\s*$/,
  /^\s*\d{1,3}\s*$/,
  /^\s*(copyright|all rights reserved|©)/i,
  /(3-day continuing education course|continuing education course|continuing education|三天持续教育课程)/i,
  /^\s*(dr\.?|prof\.?|professor)\s+[A-Z][a-z]+/,
  /^\s*\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\s*$/,
];

// 专业相关性词：用于标记「可能无关」的段落，不直接删除
const DOMAIN = [
  '兽医', '动物', '犬', '猫', '解剖', '生理', '病理', '药理', '麻醉', '镇痛', '阻滞',
  '超声', '影像', '临床', '诊断', '治疗', '剂量', '毒性', '并发症', '适应证', '禁忌证',
  '肌肉', '骨骼', '神经', '血管', '动脉', '静脉', '心脏', '肝', '肾', '脑', '脊髓',
  'anatomy', 'physiology', 'pathology', 'pharmacology', 'anesthesia', 'analgesia',
  'block', 'ultrasound', 'diagnosis', 'treatment', 'dose', 'toxicity', 'canine', 'feline',
  'artery', 'vein', 'nerve', 'muscle', 'heart', 'kidney', 'brain', 'veterinary',
];

function stripInlineNoise(text) {
  return text
    .replace(/https?:\/\/[^\s，。；）)]+/gi, '')
    .replace(/\bwww\.[^\s，。；）)]+/gi, '')
    .replace(/[\w.+-]+@[\w.-]+\.\w+/g, '')
    .replace(/\b(?:Hazai\s+Diána|Diana\s+Hazai|Hazai|Daniela\s+Farke|Agnieszka\s+Olszewska|Kathrin\s+Büttner|Martin\s+J\.\s+Schmidt|Dr\.?\s+[A-Z][a-z]+)\b/gi, '')
    .replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, '')
    .replace(/\b\d{4}年\d{1,2}月(?:\d{1,2}[–-]\d{1,2})?日?/g, '')
    .replace(/©[^\s，。；）)]*/g, '')
    .replace(/(3-Day\s+)?Continuing Education Course/gi, '')
    .replace(/三天持续教育课程/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function isNoise(line) {
  return NOISE.some((re) => re.test(line.trim()));
}

function isDomainRelated(text) {
  const lower = text.toLowerCase();
  return DOMAIN.some((word) => lower.includes(word.toLowerCase()));
}

function audit(body) {
  const blocks = body.split(/\n\s*\n/);
  const noise = [];
  const lowRelevance = [];
  const kept = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const lines = trimmed.split('\n');
    if (lines.every(isNoise)) {
      noise.push(lines.join(' | '));
      continue;
    }

    const cleaned = lines.map(stripInlineNoise).filter(Boolean).join('\n');
    if (!cleaned) {
      noise.push(trimmed.slice(0, 100));
      continue;
    }
    if (cleaned !== trimmed) {
      noise.push(`内联噪声：${trimmed.slice(0, 80)}`);
    }

    // 纯标题/列表/表格不判为低相关；长段正文才判断。
    const isPlainText = !/^#{1,6}\s/.test(cleaned) && !/^\s*[-*+]\s/.test(cleaned) && !/^\s*\|/.test(cleaned);
    if (isPlainText && cleaned.length > 60 && !isDomainRelated(cleaned)) {
      lowRelevance.push(cleaned.slice(0, 100));
    }
    kept.push(cleaned);
  }

  return {
    noise,
    lowRelevance,
    cleaned: kept.join('\n\n').replace(/\n{3,}/g, '\n\n'),
  };
}

async function main() {
  const files = [];
  for (const dir of DIRS) {
    files.push(...(await fg(['**/*.md'], { cwd: dir, absolute: true, onlyFiles: true })));
  }

  let noiseCount = 0;
  let lowCount = 0;
  let fixedCount = 0;

  for (const file of files.sort()) {
    const raw = await readFile(file, 'utf8');
    const marker = raw.indexOf('\n---\n', 4);
    const head = marker >= 0 ? raw.slice(0, marker + 5) : '';
    const body = marker >= 0 ? raw.slice(marker + 5) : raw;
    const result = audit(body);

    if (result.noise.length || result.lowRelevance.length) {
      console.log(`\n${path.relative(ROOT, file)}`);
      for (const item of result.noise) console.log(`  [噪声] ${item.slice(0, 100)}`);
      for (const item of result.lowRelevance) console.log(`  [待人工确认] ${item.slice(0, 100)}…`);
      noiseCount += result.noise.length;
      lowCount += result.lowRelevance.length;
    }

    if (fix && result.noise.length) {
      await writeFile(file, head + result.cleaned, 'utf8');
      fixedCount += 1;
    }
  }

  console.log(`\n噪声块 ${noiseCount} 个，待人工确认 ${lowCount} 个。`);
  if (fix) console.log(`已过滤 ${fixedCount} 篇文档中的明确噪声。`);
  else console.log('如需过滤明确噪声，运行 pnpm run review:fix');
}

main().catch((error) => {
  console.error('[review] 失败：', error.message || error);
  process.exitCode = 1;
});
