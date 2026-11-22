/**
 * 文档上传流程（本地收件箱）
 *
 *   pnpm run upload                     处理 content/inbox/ 下的所有文档
 *   pnpm run upload -- path/to/a.pdf   处理指定文档
 *   pnpm run upload -- --no-push       只入库，不提交推送
 *
 * 步骤：
 *   1. 转换为项目可渲染的 Markdown（复用 extractors.mjs）
 *   2. 校验内容专业性 + 与现有文档重复性
 *   3. 写入 content/raw/ → 重新构建 → git commit + push
 */
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import fg from 'fast-glob';
import matter from 'gray-matter';
import { ROOT, RAW_DIR, frontmatter, guessTitle, readSidecar, slugify } from './ingest.mjs';
import { extractDocument } from './extractors.mjs';

const INBOX_DIR = path.join(ROOT, 'content/inbox');
const args = process.argv.slice(2);
const noPush = args.includes('--no-push');
const fileArg = args.find((arg) => !arg.startsWith('--') && /\.(pdf|docx|pptx|doc)$/i.test(arg));

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[#>*`_|~\[\]()]/g, '')
    .replace(/\s+/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function ngrams(text, size = 4) {
  const clean = normalize(text);
  const set = new Set();
  for (let i = 0; i <= clean.length - size; i++) set.add(clean.slice(i, i + size));
  return set;
}

function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared++;
  return shared / Math.min(a.size, b.size);
}

async function loadKnowledge() {
  const files = [];
  for (const dir of ['content/synced', 'content/raw', 'content/manual']) {
    files.push(...(await fg(['**/*.md'], {
      cwd: path.join(ROOT, dir),
      absolute: true,
      onlyFiles: true,
    })));
  }
  const items = [];
  for (const file of files) {
    const parsed = matter(await readFile(file, 'utf8'));
    items.push({
      title: parsed.data.title || '',
      hash: parsed.data.contentHash || '',
      grams: ngrams(parsed.content),
    });
  }
  return items;
}

function isUseful(text) {
  const content = String(text).trim();
  if (content.length < 200) {
    return { ok: false, reason: `正文过短（${content.length} 字）` };
  }
  const dictionary = ['兽医', '动物', '犬', '猫', '解剖', '生理', '病理', '药理', '麻醉', '镇痛',
    '阻滞', '超声', '诊断', '治疗', '剂量', '毒性', '并发症', '肌肉', '骨骼', '神经', '血管',
    'anatomy', 'physiology', 'pharmacology', 'anesthesia', 'block', 'ultrasound', 'veterinary',
    'canine', 'feline', 'artery', 'vein', 'nerve', 'muscle'];
  const lower = content.toLowerCase();
  const hits = dictionary.filter((word) => lower.includes(word));
  if (hits.length < 2) {
    return { ok: false, reason: '未识别到足够的兽医/动物医学专业内容' };
  }
  return { ok: true, reason: `识别到 ${hits.length} 类专业关键词` };
}

async function git(args) {
  const { stdout } = await execFile('git', args, { cwd: ROOT, encoding: 'utf8' });
  return stdout.trim();
}

async function commitAndPush(message) {
  const status = await git(['status', '--porcelain']);
  if (!status) {
    console.log('[upload] 没有文件变化，无需提交。');
    return;
  }
  await git(['add', '-A']);
  await git(['commit', '-m', message]);
  await git(['push', 'origin', 'main']);
  console.log('[upload] 已提交并推送，Cloudflare Pages 将自动重建。');
}

async function processFile(filePath, knowledge) {
  const bytes = await readFile(filePath);
  const hash = hashBytes(bytes);
  const ext = path.extname(filePath).slice(1).toLowerCase();

  if (knowledge.some((item) => item.hash === hash)) {
    console.log(`[upload] 跳过重复文件（内容哈希一致）：${path.basename(filePath)}`);
    return { skipped: true };
  }

  const extracted = await extractDocument(filePath, {
    assetsDir: path.join(ROOT, 'public/files/assets'),
    publicPrefix: '/files/assets',
  });
  const useful = isUseful(extracted.markdown);
  if (!useful.ok) {
    console.log(`[upload] 跳过：${path.basename(filePath)} —— ${useful.reason}`);
    return { skipped: true };
  }

  const grams = ngrams(extracted.markdown);
  const duplicate = knowledge.find((item) => similarity(grams, item.grams) > 0.75);
  if (duplicate) {
    console.log(`[upload] 跳过近似重复：${path.basename(filePath)} ≈ ${duplicate.title}`);
    return { skipped: true };
  }

  const sidecar = await readSidecar(filePath);
  const slug = sidecar.slug || slugify(`${path.basename(filePath, path.extname(filePath))}-${ext}`);
  const meta = {
    title: sidecar.title || guessTitle(extracted.markdown, filePath),
    description: sidecar.description || '',
    category: sidecar.category || '新上传',
    tags: sidecar.tags || [],
    concepts: sidecar.concepts || [],
    date: sidecar.date || new Date().toISOString().slice(0, 10),
    source: '',
    sourceType: ext,
    sourceName: path.basename(filePath),
  };

  const outputDir = path.join(RAW_DIR, '新上传');
  await mkdir(outputDir, { recursive: true });
  const mdPath = path.join(outputDir, `${slug}.md`);
  const fm = frontmatter(meta).replace(/\n---$/, `\ncontentHash: ${JSON.stringify(hash)}\n---`);
  await writeFile(mdPath, `${fm}\n\n${extracted.markdown.trim()}\n`, 'utf8');
  await copyFile(filePath, path.join(outputDir, `${slug}.${ext}`));

  knowledge.push({ title: meta.title, hash, grams });
  console.log(`[upload] 已入库：${meta.title} → ${path.relative(ROOT, mdPath)}`);
  return { skipped: false, title: meta.title };
}

async function main() {
  await mkdir(INBOX_DIR, { recursive: true });
  const knowledge = await loadKnowledge();

  let files = [];
  if (fileArg) {
    files = [path.resolve(process.cwd(), fileArg)];
  } else {
    files = await fg(['*.{pdf,docx,pptx,doc}'], { cwd: INBOX_DIR, absolute: true, onlyFiles: true });
  }

  if (files.length === 0) {
    console.log(`[upload] 收件箱为空。把 PDF/Word/PPTX 放进 ${INBOX_DIR} 后重试。`);
    return;
  }

  let added = 0;
  for (const file of files.sort()) {
    const result = await processFile(file, knowledge);
    if (!result.skipped) {
      added += 1;
      if (!fileArg) await rm(file, { force: true });
    }
  }

  if (added === 0) {
    console.log('[upload] 没有新文档入库。');
    return;
  }

  console.log(`\n[upload] 新增 ${added} 篇文档，开始重建站点……`);
  await execFile('pnpm', ['run', 'build'], { cwd: ROOT, encoding: 'utf8', stdio: 'inherit' });

  if (!noPush) {
    await commitAndPush(`chore(upload): 新增 ${added} 篇文档`);
  }
}

main().catch((error) => {
  console.error('[upload] 失败：', error.message || error);
  process.exitCode = 1;
});
