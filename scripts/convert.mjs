/**
 * 面向使用的转换命令：`pnpm convert`
 *
 *   pnpm convert                  转换 content/raw 下全部 Word / PDF
 *   pnpm convert --list           列出待转换文档及元数据情况
 *   pnpm convert --file xxx.pdf   只转换一个文档，并预览抽取结果
 *
 * 转换产物会进入 Astro 内容集合，随后由 graph.mjs 生成图谱、Pagefind 生成检索索引。
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ingestAll, ingestFile, listRawDocs, RAW_DIR } from './ingest.mjs';

const args = process.argv.slice(2);

function argValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function printHelp() {
  console.log(`用法：
  pnpm convert                  转换全部 Word / PDF 文档
  pnpm convert --list           列出 content/raw 中的文档
  pnpm convert --file <路径>    转换单个文档并预览结果
  pnpm convert --help           显示帮助

文档可放在 content/raw/分类名/ 下，目录名会自动成为分类。
可选：为文档添加同名 .meta.json，补充 title / category / tags / concepts / description。
`);
}

function preview(markdown, lines = 30) {
  const body = markdown.replace(/^---[\s\S]*?---\s*/, '');
  return body.split('\n').slice(0, lines).join('\n');
}

async function main() {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  if (args.includes('--list')) {
    const docs = await listRawDocs();
    if (docs.length === 0) {
      console.log('content/raw 中还没有 Word / PDF 文档。');
      return;
    }
    console.log('待转换文档：');
    for (const doc of docs) {
      console.log(
        `- ${path.relative(RAW_DIR, doc.filePath)}  [${doc.type.toUpperCase()}]  分类=${doc.category}  元数据=${doc.hasSidecar ? '有' : '无'}`
      );
    }
    return;
  }

  const fileArg = argValue('--file');
  if (fileArg) {
    const direct = path.resolve(process.cwd(), fileArg);
    const filePath = existsSync(direct) ? direct : path.resolve(RAW_DIR, fileArg);
    if (!existsSync(filePath)) throw new Error(`找不到文件：${fileArg}`);

    const base = path.basename(filePath, path.extname(filePath));
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const report = await ingestFile(filePath, { slug: `${base}-${ext}` });
    console.log(`\n[convert] ${report.type.toUpperCase()} -> ${report.output}`);
    console.log(`标题：${report.title}`);
    console.log(`分类：${report.category}`);
    console.log(`抽取字符数：${report.words}`);
    if (report.meta?.pages) console.log(`PDF 页数：${report.meta.pages}`);
    console.log(`缓存副本：.cache/converted/${report.slug}.md\n`);
    console.log('--- 转换预览（前 30 行）---');
    console.log(preview(report.markdown));
    return;
  }

  const reports = await ingestAll();
  console.log('\n转换结果：');
  for (const report of reports) {
    console.log(`- ${report.slug}.md  [${report.type}]  ${report.title}  (${report.words} 字符)`);
  }
}

main().catch((error) => {
  console.error('[convert] 失败：', error.message || error);
  process.exitCode = 1;
});
