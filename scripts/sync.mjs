/**
 * 根配置驱动的本地增量扫描：vetbrain.config.json
 *
 * 读取配置里指定的本地文件夹，增量地把新/变化的 PDF / Word 转换成 Markdown，
 * 写入会被 Git 跟踪的 content/synced/。随后可选自动 commit + push，
 * GitHub Actions / Cloudflare Pages 会在 push 后重建检索索引与知识图谱。
 *
 * 用法：
 *   pnpm run sync             按配置增量扫描并可选推送
 *   pnpm run sync -- --force  忽略状态文件，强制全量转换
 *   pnpm run sync -- --no-push 本次不推送
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fg from 'fast-glob';
import { ROOT, guessTitle, readSidecar, slugify, yaml } from './ingest.mjs';
import { extractDocument } from './extractors.mjs';

const CONFIG_PATH = path.join(ROOT, 'vetbrain.config.json');
const args = process.argv.slice(2);
const force = args.includes('--force');
const noPush = args.includes('--no-push');

function expandPath(input) {
  const value = String(input || '');
  if (value === '~') return os.homedir();
  if (value.startsWith('~')) return path.join(os.homedir(), value.slice(2));
  return path.resolve(ROOT, value);
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadConfig() {
  const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  if (!Array.isArray(config.sources)) throw new Error('vetbrain.config.json 缺少 sources 数组');
  return config;
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/** 粗略判断文档语言：中文字符很少且拉丁字母很多时视为英文，等待翻译。 */
function detectLanguage(text) {
  const cjk = (String(text).match(/[\u3400-\u9fff]/g) || []).length;
  const latin = (String(text).match(/[A-Za-z]/g) || []).length;
  if (cjk < 30 && latin > 120) return 'en';
  return 'zh';
}

function buildFrontmatter(meta) {
  const lines = ['---'];
  for (const key of [
    'title', 'originalTitle', 'description', 'category', 'date',
    'language', 'needsTranslation', 'translatedFrom',
    'source', 'sourceType', 'sourceName', 'syncedFrom', 'contentHash',
  ]) {
    if (meta[key]) lines.push(`${key}: ${yaml(meta[key])}`);
  }
  lines.push(`tags: ${JSON.stringify(meta.tags || [])}`);
  lines.push(`concepts: ${JSON.stringify(meta.concepts || [])}`);
  lines.push('---');
  return lines.join('\n');
}

async function loadState(statePath) {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'));
  } catch {
    return { files: {} };
  }
}

function patternsFor(source) {
  const include = source.include?.length ? source.include : ['**/*.pdf', '**/*.docx', '**/*.pptx'];
  const exclude = source.exclude?.length ? source.exclude : ['**/~$*'];
  if (source.recursive === false) {
    return {
      include: include.map((p) => p.replace(/^\*\*\//, '')),
      exclude: exclude.map((p) => p.replace(/^\*\*\//, '')),
    };
  }
  return { include, exclude };
}

async function scanSource(source, config, state, currentKeys, outputDir, report) {
  if (source.enabled === false) {
    report.disabled.push(source.name);
    return;
  }

  const dir = expandPath(source.path);
  if (!(await exists(dir))) {
    console.warn(`[sync] 源文件夹不存在，已跳过：${dir}`);
    report.missing.push(source.name);
    return;
  }

  const { include, exclude } = patternsFor(source);
  const files = await fg(include, {
    cwd: dir,
    absolute: true,
    onlyFiles: true,
    ignore: exclude,
  });

  const minBytes = (config.scan?.minSizeKB || 0) * 1024;

  for (const filePath of files.sort()) {
    const info = await stat(filePath);
    if (info.size < minBytes) continue;

    const rel = path.relative(dir, filePath);
    const key = `${source.name}/${rel}`;
    currentKeys.add(key);

    const hash = await hashFile(filePath);
    const previous = state.files[key];
    if (!force && previous && previous.hash === hash && previous.size === info.size) {
      report.unchanged++;
      continue;
    }

    const extracted = await extractDocument(filePath, {
      assetsDir: path.join(ROOT, 'public/files/assets'),
      publicPrefix: '/files/assets',
    });
    if (!extracted.markdown.trim()) {
      console.warn(`[sync] 未抽取到文本，跳过（扫描件需先 OCR）：${rel}`);
      report.failed.push(rel);
      continue;
    }

    const sidecar = await readSidecar(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const slug = sidecar.slug || `${slugify(`${source.name}-${rel}`)}-${ext}`;
    const subfolder = path.relative(dir, path.dirname(filePath)).split(path.sep)[0];
    const category = sidecar.category
      || (source.useSubfolderAsCategory && subfolder ? subfolder : null)
      || source.category
      || '未分类';

    let sourceUrl;
    if (source.keepOriginal) {
      const originalsDir = path.join(ROOT, 'public/originals');
      await mkdir(originalsDir, { recursive: true });
      const name = `${slug}.${ext}`;
      await copyFile(filePath, path.join(originalsDir, name));
      sourceUrl = `/originals/${name}`;
    }

    const language = sidecar.language || detectLanguage(extracted.markdown);
    const needsTranslation = sidecar.needsTranslation !== undefined
      ? sidecar.needsTranslation
      : language === 'en';

    const meta = {
      title: sidecar.title || guessTitle(extracted.markdown, filePath),
      description: sidecar.description || '',
      category,
      tags: sidecar.tags || source.tags || [],
      concepts: sidecar.concepts || source.concepts || [],
      date: sidecar.date || new Date().toISOString().slice(0, 10),
      language,
      needsTranslation,
      source: sourceUrl,
      sourceType: ext,
      sourceName: path.basename(filePath),
      syncedFrom: `${source.name}/${rel}`,
      contentHash: hash,
    };

    const markdown = `${buildFrontmatter(meta)}\n\n${extracted.markdown.trim()}\n`;
    const outputPath = path.join(outputDir, `${slug}.md`);
    await writeFile(outputPath, markdown, 'utf8');

    state.files[key] = {
      hash,
      size: info.size,
      slug,
      output: path.relative(ROOT, outputPath),
      source: source.name,
    };

    if (previous) report.updated.push(rel);
    else report.added.push(rel);
  }
}

async function gitCommand(args) {
  const { stdout } = await execFile('git', args, { cwd: ROOT, encoding: 'utf8' });
  return stdout.trim();
}

async function pushChanges(config) {
  const status = await gitCommand(['status', '--porcelain']);
  if (!status) {
    console.log('[sync] 没有文件变化，无需提交。');
    return;
  }
  await gitCommand(['add', '-A']);
  const message = `${config.git?.commitPrefix || 'chore(sync): '}${new Date().toISOString().slice(0, 10)}`;
  await gitCommand(['commit', '-m', message]);
  await gitCommand(['push', 'origin', config.git?.branch || 'main']);
  console.log('[sync] 已提交并推送，Cloudflare Pages 将自动重建站点。');
}

async function main() {
  const config = await loadConfig();
  const outputDir = expandPath(config.scan?.outputDir || 'content/synced');
  await mkdir(outputDir, { recursive: true });

  const statePath = expandPath(config.scan?.stateFile || '.cache/scan-state.json');
  await mkdir(path.dirname(statePath), { recursive: true });
  const state = force ? { files: {} } : await loadState(statePath);

  const report = {
    added: [], updated: [], unchanged: 0, failed: [],
    removed: [], missing: [], disabled: [],
  };
  const currentKeys = new Set();

  for (const source of config.sources) {
    await scanSource(source, config, state, currentKeys, outputDir, report);
  }

  if (config.scan?.onDeleted === 'remove') {
    for (const [key, entry] of Object.entries(state.files)) {
      if (currentKeys.has(key)) continue;
      const outputPath = path.join(ROOT, entry.output);
      if (await exists(outputPath)) await rm(outputPath, { force: true });
      delete state.files[key];
      report.removed.push(key);
    }
  }

  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');

  console.log(`\n[sync] 扫描完成：新增 ${report.added.length}，更新 ${report.updated.length}，未变 ${report.unchanged}，删除 ${report.removed.length}。`);
  for (const name of report.added) console.log(`  + ${name}`);
  for (const name of report.updated) console.log(`  ~ ${name}`);
  for (const name of report.removed) console.log(`  - ${name}`);
  if (report.failed.length) console.log(`  跳过（无文本）：${report.failed.join('、')}`);
  if (report.missing.length) console.log(`  源文件夹缺失：${report.missing.join('、')}`);
  if (report.disabled.length) console.log(`  已禁用：${report.disabled.join('、')}`);

  if (config.git?.autoPush && !noPush) await pushChanges(config);
}

main().catch((error) => {
  console.error('[sync] 失败：', error.message || error);
  process.exitCode = 1;
});
