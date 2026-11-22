/**
 * Word / PDF 文档转换层。
 *
 * 这一步是知识库的核心入口：把原始的 .pdf / .docx 转成干净的 Markdown，
 * 供后续的 knowledge graph（scripts/graph.mjs）和 Pagefind 检索索引使用。
 *
 * 全部在构建期本地完成，不调用任何后端 API。
 */
import { execFile } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import TurndownService from 'turndown';
import { definePDFJSModule, extractText, getDocumentProxy } from 'unpdf';

const run = promisify(execFile);

// PDF.js 的 CJK 字符映射：中文 PDF 抽取质量更好。
try {
  await import('pdfjs-dist/legacy/build/pdf.mjs');
  definePDFJSModule(() => import('pdfjs-dist/legacy/build/pdf.mjs'));
} catch {
  console.warn('[extractors] pdfjs-dist 不可用，使用 unpdf 内置 PDF.js（中文抽取可能变差）');
}

/**
 * PDF 抽取出来的是按视觉行断开的文本，这里把软换行合并回段落，
 * 避免在页面上出现「一句中文被拆成很多行」的情况。
 */
export function pdfTextToMarkdown(raw) {
  const blocks = String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+\n/g, '\n')
    .split(/\n\s*\n+/);

  return blocks
    .map((block) => {
      const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
      let out = '';
      for (const line of lines) {
        if (!out) {
          out = line;
          continue;
        }
        const prev = out.slice(-1);
        const next = line[0];
        const asciiJoin = /[A-Za-z0-9]/.test(prev) && /[A-Za-z0-9]/.test(next);
        const hardBreak = /[。！？!?；;：:]$/.test(prev) || /^[（(【[]/.test(next);
        out += hardBreak ? `\n${line}` : `${asciiJoin ? ' ' : ''}${line}`;
      }
      return out;
    })
    .filter(Boolean)
    .join('\n\n');
}

/** PDF -> Markdown。返回页数等元信息，便于报告。 */
export async function extractPdf(filePath) {
  const bytes = new Uint8Array(await readFile(filePath));
  const pdf = await getDocumentProxy(bytes, { maxImageSize: 16_777_216 });
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  const raw = Array.isArray(text) ? text.join('\n\n') : text;
  return {
    markdown: pdfTextToMarkdown(raw),
    text: raw,
    meta: { pages: totalPages, type: 'pdf' },
  };
}

/**
 * DOCX -> Markdown。
 * - 标题、列表、表格会转成对应的 Markdown 结构
 * - 图片写到 public/files/assets/，并在 Markdown 中引用 /files/assets/xxx.png
 */
export async function extractDocx(filePath, options = {}) {
  const assetsDir = options.assetsDir || path.join(process.cwd(), 'public/files/assets');
  const publicPrefix = options.publicPrefix || '/files/assets';
  await mkdir(assetsDir, { recursive: true });

  let imageCount = 0;
  const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });
  const convertImage = mammoth.images.imgElement(async (image) => {
    const ext = (image.contentType || 'image/png').split('/')[1] || 'png';
    const name = `img-${Date.now()}-${++imageCount}.${ext}`;
    const buffer = await image.readAsBuffer();
    await writeFile(path.join(assetsDir, name), buffer);
    return { src: `${publicPrefix}/${name}` };
  });

  const result = await mammoth.convertToHtml(
    { path: filePath },
    { convertImage, styleMap: ["p[style-name='Title'] => h1:fresh"] }
  );

  return {
    markdown: turndown.turndown(result.value).trim(),
    text: result.value,
    meta: { warnings: result.messages.length, type: 'docx' },
  };
}

function decodeXml(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)));
}

/** PPTX -> Markdown：逐页提取 <a:t> 文本，保留幻灯片顺序。 */
export async function extractPptx(filePath) {
  const zip = await JSZip.loadAsync(await readFile(filePath));
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]));

  const sections = [];
  for (const [index, name] of slides.entries()) {
    const xml = await zip.file(name).async('string');
    const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
      .map((match) => decodeXml(match[1]).trim())
      .filter(Boolean);
    if (texts.length) sections.push(`## 幻灯片 ${index + 1}\n\n${texts.join('\n')}`);
  }

  const markdown = sections.join('\n\n');
  return { markdown, text: markdown, meta: { slides: slides.length, type: 'pptx' } };
}

/** 老式 .doc：如果本机装了 LibreOffice 就自动转成 docx，否则给出明确提示。 */
async function convertLegacyDoc(filePath) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'vetbrain-doc-'));
  try {
    await run('soffice', ['--headless', '--convert-to', 'docx', '--outdir', tmp, filePath]);
    const converted = path.join(tmp, `${path.basename(filePath).replace(/\.doc$/i, '')}.docx`);
    await access(converted);
    return { filePath: converted, cleanup: () => rm(tmp, { recursive: true, force: true }) };
  } catch {
    await rm(tmp, { recursive: true, force: true });
    throw new Error(
      `老式 .doc 转换失败：${filePath}\n请安装 LibreOffice，或先用 Word 把文件另存为 .docx。`
    );
  }
}

/** 统一入口：自动识别 PDF / DOCX / DOC，返回 Markdown。 */
export async function extractDocument(filePath, options = {}) {
  const ext = path.extname(filePath).toLowerCase();
  let target = filePath;
  let cleanup = async () => {};

  if (ext === '.doc') {
    const converted = await convertLegacyDoc(filePath);
    target = converted.filePath;
    cleanup = converted.cleanup;
  }

  try {
    if (target.toLowerCase().endsWith('.pdf')) return await extractPdf(target);
    if (target.toLowerCase().endsWith('.docx')) return await extractDocx(target, options);
    if (target.toLowerCase().endsWith('.pptx')) return await extractPptx(target);
    throw new Error(`不支持的文档格式：${ext || '(无扩展名)'}`);
  } finally {
    await cleanup();
  }
}
