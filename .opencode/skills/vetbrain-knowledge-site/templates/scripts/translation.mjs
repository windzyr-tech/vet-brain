/**
 * 列出等待翻译成中文的文档（由 sync 标记为 needsTranslation: true）。
 * 翻译本身由 OpenCode skill 完成，保证兽医专业术语质量。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';

const ROOT = process.cwd();
const DIRS = [
  path.join(ROOT, 'content/synced'),
  path.join(ROOT, 'content/manual'),
];

const pending = [];
for (const dir of DIRS) {
  const files = await fg(['**/*.md'], { cwd: dir, absolute: true, onlyFiles: true });
  for (const file of files) {
    const parsed = matter(await readFile(file, 'utf8'));
    if (parsed.data.needsTranslation === true) {
      pending.push({
        file: path.relative(ROOT, file),
        title: parsed.data.title || path.basename(file, '.md'),
        language: parsed.data.language || 'en',
        source: parsed.data.sourceName || '',
      });
    }
  }
}

if (pending.length === 0) {
  console.log('没有待翻译文档。');
} else {
  console.log(`待翻译文档 ${pending.length} 篇：`);
  for (const item of pending) {
    console.log(`- ${item.file}  [${item.language}]  ${item.title}`);
  }
  console.log('\n请在 OpenCode 中加载 vetbrain-knowledge-site skill，按兽医术语表逐篇翻译。');
}
