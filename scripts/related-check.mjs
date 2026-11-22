/**
 * 根据每篇文档的实际内容计算相似度，在文末生成至少 5 个相关文档链接。
 *
 * 相关性依据：frontmatter 标签/概念/分类 + 正文中文词组 + 概念词典/术语表命中，
 * 使用倒排文档频率加权，避免仅按目录或标题匹配。
 *
 * 用法：
 *   pnpm run related:check   只报告每篇将推荐的前几篇
 *   pnpm run related:fix     写入文末「## 相关内容」区块
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';

const ROOT = process.cwd();
const DIRS = [path.join(ROOT, 'content/synced'), path.join(ROOT, 'content/manual')];
const MIN_RELATED = 5;
const fix = process.argv.includes('--fix');

const STOP = new Set([
  '的', '了', '和', '在', '是', '等', '及', '与', '或', '为', '有', '从', '对', '中', '上', '下',
  '一', '二', '三', '一个', '这个', '那个', '可以', '进行', '通过', '使用', '需要', '可能',
  '以及', '我们', '本文', '内容', '以下', '以上', '包括', '主要', '相关', '没有', '不是',
]);

async function loadDictionary() {
  const result = [];
  for (const file of ['data/concepts.json', 'data/glossary.json']) {
    try {
      const raw = JSON.parse(await readFile(path.join(ROOT, file), 'utf8'));
      const list = Array.isArray(raw) ? raw : Object.keys(raw);
      for (const item of list) {
        if (typeof item === 'string') result.push(item);
        else if (item && item.name) result.push(item.name, ...(item.aliases || []));
      }
    } catch {}
  }
  return result;
}

function tokenize(body, dictionary) {
  const text = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`_|~]/g, '')
    .replace(/\d+(?:\.\d+)?/g, '')
    .replace(/[A-Za-z]{2,}/g, '')
    .replace(/[^\p{L}\s]+/gu, ' ')
    .replace(/\s+/g, ' ');

  const tokens = new Set();
  for (const term of dictionary) {
    if (term && text.includes(term)) tokens.add(term);
  }
  for (const match of text.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    const run = match[0];
    for (let i = 0; i < run.length - 1; i++) {
      const bigram = run.slice(i, i + 2);
      if (!STOP.has(bigram)) tokens.add(bigram);
    }
    for (let i = 0; i < run.length - 2; i++) {
      const trigram = run.slice(i, i + 3);
      if (!STOP.has(trigram)) tokens.add(trigram);
    }
  }
  return tokens;
}

function buildRelatedSection(items) {
  const lines = ['## 相关内容', ''];
  for (const item of items) {
    lines.push(`- [${item.title}](/docs/${encodeURIComponent(item.slug)}/)`);
  }
  return lines.join('\n');
}

async function main() {
  const dictionary = await loadDictionary();
  const files = [];
  for (const dir of DIRS) {
    files.push(...(await fg(['**/*.md'], { cwd: dir, absolute: true, onlyFiles: true })));
  }

  const docs = [];
  for (const file of files) {
    const raw = await readFile(file, 'utf8');
    const parsed = matter(raw);
    const slug = path.basename(file, '.md');
    const terms = tokenize(parsed.content, dictionary);
    for (const value of [...(parsed.data.tags || []), ...(parsed.data.concepts || []), parsed.data.category]) {
      if (value) terms.add(String(value));
    }
    docs.push({
      file,
      slug,
      title: parsed.data.title || slug,
      category: parsed.data.category || '未分类',
      terms,
      raw,
    });
  }

  const df = new Map();
  for (const doc of docs) {
    for (const term of doc.terms) df.set(term, (df.get(term) || 0) + 1);
  }

  let updated = 0;
  for (const doc of docs) {
    const scored = [];
    for (const other of docs) {
      if (other.slug === doc.slug) continue;
      let score = 0;
      for (const term of doc.terms) {
        if (!other.terms.has(term)) continue;
        score += 1 / Math.sqrt(df.get(term) || 1);
      }
      if (score > 0) scored.push({ ...other, score });
    }
    scored.sort((a, b) => b.score - a.score);

    const chosen = [];
    const used = new Set();
    for (const item of scored) {
      if (chosen.length >= MIN_RELATED) break;
      if (used.has(item.slug)) continue;
      chosen.push(item);
      used.add(item.slug);
    }
    if (chosen.length < MIN_RELATED) {
      for (const item of docs) {
        if (chosen.length >= MIN_RELATED) break;
        if (item.slug === doc.slug || used.has(item.slug)) continue;
        if (item.category === doc.category) {
          chosen.push({ ...item, score: 0 });
          used.add(item.slug);
        }
      }
    }
    if (chosen.length < MIN_RELATED) {
      for (const item of docs) {
        if (chosen.length >= MIN_RELATED) break;
        if (item.slug === doc.slug || used.has(item.slug)) continue;
        chosen.push({ ...item, score: 0 });
        used.add(item.slug);
      }
    }

    const section = buildRelatedSection(chosen.slice(0, MIN_RELATED));
    const nextRaw = doc.raw.replace(/^## 相关内容\s*\n[\s\S]*$/m, '').trimEnd() + `\n\n${section}\n`;
    console.log(`- ${doc.slug} → ${chosen.slice(0, MIN_RELATED).map((x) => x.slug).join(', ')}`);
    if (fix && nextRaw !== doc.raw) {
      await writeFile(doc.file, nextRaw, 'utf8');
      updated += 1;
    }
  }

  if (fix) console.log(`\n已写入 ${updated} 篇文档的相关内容。`);
  else console.log('\n以上为推荐结果预览；运行 pnpm run related:fix 写入文档。');
}

main().catch((error) => {
  console.error('[related] 失败：', error.message || error);
  process.exitCode = 1;
});
