/**
 * 内容分段检查与基础拆分。
 *
 * 问题：PDF / PPTX 抽取后的文本常常是一整段长文字，阅读体验差。
 * 本脚本负责：
 *   1. 找出超长段落（默认 > 500 字）
 *   2. 在句子边界处拆成 180-300 字的自然段
 *   3. 把挤在一行里的编号条目拆成列表
 *
 * 语义层面的章节划分（加小标题、按主题重组）由 content-segmentation skill 完成。
 *
 * 用法：
 *   pnpm run segment:check      只报告
 *   pnpm run segment:fix        自动拆分
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';

const ROOT = process.cwd();
const DIRS = [path.join(ROOT, 'content/synced'), path.join(ROOT, 'content/manual')];
const fix = process.argv.includes('--fix');
const LONG_PARAGRAPH = 500;
const TARGET = 240;

function isSpecial(line) {
  return /^#{1,6}\s/.test(line)
    || /^\s*[-*+]\s/.test(line)
    || /^\s*>\s/.test(line)
    || /^\s*\d+[.)]\s/.test(line)
    || /^\s*\|/.test(line)
    || /^\s*```/.test(line)
    || /^\s*!\[/.test(line)
    || /^\s*- \[/.test(line);
}

function splitSentences(text) {
  return text
    .replace(/([。！？；!?;])\s*/g, '$1\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function reflow(text) {
  const sentences = splitSentences(text);
  if (sentences.length <= 1) return [text];

  const paragraphs = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > TARGET) {
      paragraphs.push(current);
      current = sentence;
    } else {
      current += current ? sentence : sentence;
    }
  }
  if (current) paragraphs.push(current);
  return paragraphs;
}

function splitNumberedItems(line) {
  // 形如 "1. xxx 2. xxx 3. xxx" 的挤压行
  if (line.length < LONG_PARAGRAPH) return null;
  const parts = line.split(/(?=(?:^|\s)\d{1,2}\.\s+[A-Z])/).map((s) => s.trim()).filter(Boolean);
  return parts.length >= 3 ? parts : null;
}

function segment(body) {
  const lines = body.split('\n');
  const output = [];
  let changed = false;

  for (const line of lines) {
    if (isSpecial(line) || line.length <= LONG_PARAGRAPH) {
      output.push(line);
      continue;
    }

    const numbered = splitNumberedItems(line);
    if (numbered) {
      changed = true;
      output.push('', ...numbered.map((item) => `${item}`), '');
      continue;
    }

    const paragraphs = reflow(line);
    if (paragraphs.length > 1) {
      changed = true;
      output.push('', ...paragraphs.flatMap((p, i) => (i < paragraphs.length - 1 ? [p, ''] : [p])), '');
    } else {
      output.push(line);
    }
  }

  const result = output.join('\n').replace(/\n{3,}/g, '\n\n');
  return { result, changed: changed || result !== body };
}

async function main() {
  const files = [];
  for (const dir of DIRS) {
    files.push(...(await fg(['**/*.md'], { cwd: dir, absolute: true, onlyFiles: true })));
  }

  let affected = 0;
  for (const file of files.sort()) {
    const raw = await readFile(file, 'utf8');
    const marker = raw.indexOf('\n---\n', 4);
    const head = marker >= 0 ? raw.slice(0, marker + 5) : '';
    const body = marker >= 0 ? raw.slice(marker + 5) : raw;
    const { result, changed } = segment(body);
    if (!changed) continue;
    affected += 1;
    console.log(`- ${path.relative(ROOT, file)}`);
    if (fix) await writeFile(file, head + result, 'utf8');
  }

  if (affected === 0) console.log('没有发现需要分段的超长段落。');
  else console.log(`\n${fix ? '已分段' : '待分段'} ${affected} 篇文档。`);
}

main().catch((error) => {
  console.error('[segment] 失败：', error.message || error);
  process.exitCode = 1;
});
