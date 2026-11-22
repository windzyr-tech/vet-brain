/**
 * 文档摄取：content/raw (PDF/DOCX/DOC) + content/manual (Markdown)
 *              -> src/content/docs/*.md（Astro 内容集合）
 *              -> public/files/（原始文件副本）
 *
 * 转换逻辑在 scripts/extractors.mjs；本文件负责目录、元数据与落盘。
 */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fg from 'fast-glob';
import matter from 'gray-matter';
import { extractDocument } from './extractors.mjs';

export const ROOT = process.cwd();
export const RAW_DIR = path.join(ROOT, 'content/raw');
export const MANUAL_DIR = path.join(ROOT, 'content/manual');
export const SYNCED_DIR = path.join(ROOT, 'content/synced');
export const OUT_DIR = path.join(ROOT, 'src/content/docs');
export const FILES_DIR = path.join(ROOT, 'public/files');
export const CACHE_DIR = path.join(ROOT, '.cache/converted');

const usedSlugs = new Set();

export function slugify(input) {
  const base = path.basename(input, path.extname(input));
  const slug = base
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'doc';
}

function uniqueSlug(input) {
  const base = slugify(input);
  let slug = base;
  let n = 2;
  while (usedSlugs.has(slug)) slug = `${base}-${n++}`;
  usedSlugs.add(slug);
  return slug;
}

export function yaml(value) {
  return JSON.stringify(value ?? '');
}

export function guessTitle(text, fallback) {
  const heading = text.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim();
  const firstLine = text.split('\n').find((line) => line.trim().length > 0);
  if (firstLine) return firstLine.trim().slice(0, 80);
  return path.basename(fallback, path.extname(fallback));
}

export async function readSidecar(filePath) {
  const sidecar = filePath.replace(/(\.[^.]+)$/, '') + '.meta.json';
  try {
    return JSON.parse(await readFile(sidecar, 'utf8'));
  } catch {
    return {};
  }
}

function categoryFromPath(filePath) {
  const rel = path.relative(RAW_DIR, filePath);
  const first = rel.split(path.sep)[0];
  return first && first !== path.basename(filePath) ? first : '未分类';
}

export function frontmatter(meta) {
  const lines = ['---'];
  lines.push(`title: ${yaml(meta.title)}`);
  if (meta.description) lines.push(`description: ${yaml(meta.description)}`);
  lines.push(`category: ${yaml(meta.category || '未分类')}`);
  lines.push(`tags: ${JSON.stringify(meta.tags || [])}`);
  lines.push(`concepts: ${JSON.stringify(meta.concepts || [])}`);
  if (meta.date) lines.push(`date: ${yaml(meta.date)}`);
  if (meta.source) lines.push(`source: ${yaml(meta.source)}`);
  if (meta.sourceType) lines.push(`sourceType: ${yaml(meta.sourceType)}`);
  if (meta.sourceName) lines.push(`sourceName: ${yaml(meta.sourceName)}`);
  lines.push('---');
  return lines.join('\n');
}

/** 列出 content/raw 中的可转换文档，供 `pnpm convert --list` 使用。 */
export async function listRawDocs() {
  const files = await fg(['**/*.{pdf,docx,pptx,doc}'], { cwd: RAW_DIR, absolute: true, onlyFiles: true });
  return files.sort().map((filePath) => {
    const metaPath = filePath.replace(/(\.[^.]+)$/, '') + '.meta.json';
    return {
      filePath,
      type: path.extname(filePath).slice(1).toLowerCase(),
      category: categoryFromPath(filePath),
      hasSidecar: existsSync(metaPath),
    };
  });
}

/**
 * 转换单个 Word / PDF 文档。
 * 返回报告对象；Markdown 同时写入站点内容目录与 .cache/converted/ 以便检查转换质量。
 */
export async function ingestFile(filePath, options = {}) {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(FILES_DIR, { recursive: true });
  await mkdir(CACHE_DIR, { recursive: true });

  const meta = await readSidecar(filePath);
  const extracted = await extractDocument(filePath, {
    assetsDir: path.join(FILES_DIR, 'assets'),
    publicPrefix: '/files/assets',
  });

  if (!extracted.markdown.trim()) {
    throw new Error(`未抽取到文本（可能是扫描件，需先 OCR）：${filePath}`);
  }

  const ext = path.extname(filePath).toLowerCase();
  const slug = uniqueSlug(meta.slug || options.slug || filePath);
  const publicName = `${slug}${ext}`;
  await copyFile(filePath, path.join(FILES_DIR, publicName));

  const title = meta.title || guessTitle(extracted.markdown, filePath);
  const markdown = [
    frontmatter({
      title,
      description: meta.description || '',
      category: meta.category || categoryFromPath(filePath),
      tags: meta.tags || [],
      concepts: meta.concepts || [],
      date: meta.date || new Date().toISOString().slice(0, 10),
      source: `/files/${publicName}`,
      sourceType: ext.replace('.', ''),
      sourceName: path.basename(filePath),
    }),
    '',
    extracted.markdown,
    '',
  ].join('\n');

  await writeFile(path.join(OUT_DIR, `${slug}.md`), markdown, 'utf8');
  await writeFile(path.join(CACHE_DIR, `${slug}.md`), markdown, 'utf8');

  return {
    slug,
    title,
    type: ext.replace('.', ''),
    category: meta.category || categoryFromPath(filePath),
    concepts: meta.concepts || [],
    words: extracted.markdown.length,
    meta: extracted.meta,
    markdown,
    output: path.join(OUT_DIR, `${slug}.md`),
  };
}

/** 全量摄取：清空生成目录后重建所有内容。 */
export async function ingestAll() {
  await mkdir(RAW_DIR, { recursive: true });
  await mkdir(MANUAL_DIR, { recursive: true });
  await mkdir(path.join(RAW_DIR, '未分类'), { recursive: true });
  await rm(OUT_DIR, { recursive: true, force: true });
  await rm(FILES_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(FILES_DIR, { recursive: true });

  usedSlugs.clear();
  const reports = [];

  const rawFiles = await fg(['**/*.{pdf,docx,pptx,doc}'], { cwd: RAW_DIR, absolute: true, onlyFiles: true });
  for (const file of rawFiles.sort()) {
    try {
      reports.push(await ingestFile(file));
    } catch (error) {
      console.warn(`[ingest] 跳过 ${path.basename(file)}：${error.message}`);
    }
  }

  await mkdir(SYNCED_DIR, { recursive: true });

  const copyMarkdownDir = async (dir) => {
    const files = await fg(['**/*.md'], { cwd: dir, absolute: true, onlyFiles: true });
    for (const file of files.sort()) {
      const raw = await readFile(file, 'utf8');
      const parsed = matter(raw);
      const slug = uniqueSlug(parsed.data.slug || file);
      const data = {
        title: parsed.data.title || guessTitle(parsed.content, file),
        description: parsed.data.description || '',
        category: parsed.data.category || (dir === SYNCED_DIR ? '已同步' : categoryFromPath(file)),
        tags: parsed.data.tags || [],
        concepts: parsed.data.concepts || [],
        date: parsed.data.date || new Date().toISOString().slice(0, 10),
      };
      await writeFile(path.join(OUT_DIR, `${slug}.md`), `${frontmatter(data)}\n\n${parsed.content.trim()}\n`, 'utf8');
      reports.push({
        slug,
        title: data.title,
        type: 'md',
        category: data.category,
        concepts: data.concepts,
        words: parsed.content.length,
        output: path.join(OUT_DIR, `${slug}.md`),
      });
    }
  };

  // content/synced 是扫描器产出、会被 Git 跟踪；content/manual 是手写笔记。
  await copyMarkdownDir(SYNCED_DIR);
  await copyMarkdownDir(MANUAL_DIR);

  console.log(`[ingest] 完成，共生成 ${reports.length} 篇文档。`);
  return reports;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  ingestAll().catch((error) => {
    console.error('[ingest] 失败：', error);
    process.exitCode = 1;
  });
}
