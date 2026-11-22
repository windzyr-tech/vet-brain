/**
 * 文档格式校验与规范化。
 *
 * 目标结构：
 *   1. frontmatter: title / description / category / date 完整
 *   2. 正文以唯一一个 H1 标题开始
 *   3. H1 后有简短摘要
 *   4. 较长文档带「## 目录」
 *   5. 去掉内联样式 / font 标签，统一标题与段落间距
 *
 * 用法：
 *   pnpm run format:check      只检查并报告
 *   pnpm run format:fix        自动修复
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';

const ROOT = process.cwd();
const DIRS = [
  path.join(ROOT, 'content/synced'),
  path.join(ROOT, 'content/manual'),
];
const fix = process.argv.includes('--fix');
const forceToc = process.argv.includes('--toc');
const LONG_DOC_CHARS = 1200;
const MIN_H2_FOR_TOC = 3;

function stringifyFrontmatter(data) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (Array.isArray(value) || typeof value === 'object') lines.push(`${key}: ${JSON.stringify(value)}`);
    else if (typeof value === 'number' || typeof value === 'boolean') lines.push(`${key}: ${value}`);
    else lines.push(`${key}: ${JSON.stringify(String(value))}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function slugifyHeading(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[`*_[\]()]/g, '')
    .replace(/[^\p{L}\p{N}\s-]+/gu, '')
    .replace(/\s+/g, '-');
}

function buildToc(body) {
  const headings = [];
  let inCode = false;
  for (const line of body.split('\n')) {
    if (/^```/.test(line.trim())) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const match = line.match(/^(#{2,3})\s+(.+)$/);
    if (!match) continue;
    const level = match[1].length;
    const text = match[2].trim();
    if (text === '目录' || text === '相关内容') continue;
    headings.push({ level, text });
  }
  if (headings.length === 0) return '';
  const seen = new Map();
  return headings.map(({ level, text }) => {
    const base = slugifyHeading(text) || 'section';
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    const anchor = count > 1 ? `${base}-${count}` : base;
    return `${'  '.repeat(level - 2)}- [${text}](#${anchor})`;
  }).join('\n');
}

function removeToc(body) {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => /^##\s+目录\s*$/.test(line));
  if (start < 0) return body;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  lines.splice(start, end - start);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function makeSummary(body) {
  const plain = body
    .replace(/^#{1,6}\s+.*$/gm, '')
    .replace(/^\s*>\s*/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return '暂无摘要。';
  return `${plain.slice(0, 80)}${plain.length > 80 ? '…' : ''}`;
}

function normalize(raw) {
  const issues = [];
  const parsed = matter(raw);
  const data = { ...parsed.data };
  let body = parsed.content.trim();

  if (!data.title || !String(data.title).trim()) {
    const firstHeading = body.match(/^#\s+(.+)$/m);
    data.title = firstHeading ? firstHeading[1].trim() : '未命名文档';
    issues.push('补齐标题');
  }

  // 去掉内联样式与 font 标签，避免字体大小/颜色不一致。
  const cleaned = body
    .replace(/<font[^>]*>/gi, '')
    .replace(/<\/font>/gi, '')
    .replace(/\s+style\s*=\s*(["'])[^"']*\1/gi, '');
  if (cleaned !== body) {
    body = cleaned;
    issues.push('清除内联样式');
  }

  // 只保留一个 H1；其余 H1 降级为 H2。
  const headings = [...body.matchAll(/^#\s+(.+)$/gm)];
  if (headings.length === 0) {
    body = `# ${data.title}\n\n${body}`;
    issues.push('添加 H1 标题');
  } else if (headings.length > 1) {
    let index = 0;
    body = body.replace(/^#\s+(.+)$/gm, (line) => {
      index += 1;
      return index === 1 ? line : `## ${line.replace(/^#\s+/, '')}`;
    });
    issues.push('多余的 H1 降级为 H2');
  }

  // 摘要：frontmatter 缺 description 时生成，并在 H1 后加摘要块。
  if (!data.description || !String(data.description).trim()) {
    data.description = makeSummary(body);
    issues.push('补齐摘要');
  }
  if (!/^>\s*\*\*摘要\*\*/m.test(body)) {
    body = body.replace(/^#\s+.+\n/, (h) => `${h}\n\n> **摘要**：${data.description}\n`);
    issues.push('添加摘要段落');
  }

  // 长文目录。
  const h2Count = (body.match(/^##\s+.+$/gm) || []).length;
  const isLong = body.length >= LONG_DOC_CHARS && h2Count >= MIN_H2_FOR_TOC;
  const hasToc = /^##\s+目录\s*$/m.test(body);
  if (isLong && (forceToc || !hasToc)) {
    const base = forceToc && hasToc ? removeToc(body) : body;
    const toc = buildToc(base);
    if (toc) {
      body = base.replace(/^#\s+.+\n\n(>\s*\*\*摘要\*\*[^\n]*\n)?/, (prefix) => `${prefix}\n## 目录\n\n${toc}\n`);
      issues.push(forceToc ? '重建目录' : '添加目录');
    }
  }

  // 标题前后保留空行。
  const spaced = body
    .replace(/(^|\n)(#{1,6}\s+.+)\n(?!\n)/g, '$1$2\n\n')
    .replace(/\n{3,}/g, '\n\n');
  if (spaced !== body) {
    body = spaced;
    issues.push('统一标题间距');
  }

  const output = `${stringifyFrontmatter(data)}\n\n${body.trim()}\n`;
  return { output, issues, changed: output !== raw };
}

async function main() {
  const files = [];
  for (const dir of DIRS) {
    files.push(...(await fg(['**/*.md'], { cwd: dir, absolute: true, onlyFiles: true })));
  }

  let changedCount = 0;
  for (const file of files.sort()) {
    const raw = await readFile(file, 'utf8');
    const result = normalize(raw);
    if (!result.changed) continue;
    changedCount += 1;
    console.log(`- ${path.relative(ROOT, file)}：${result.issues.join(' / ')}`);
    if (fix) await writeFile(file, result.output, 'utf8');
  }

  if (changedCount === 0) console.log('所有文档格式均已符合规范。');
  else console.log(`\n${fix ? '已修复' : '待修复'} ${changedCount} 篇文档。`);
}

main().catch((error) => {
  console.error('[format] 失败：', error.message || error);
  process.exitCode = 1;
});
