---
name: VetBrain 兽医知识库站点
description: 把本地 PDF / Word / PPTX 文档做成可检索、带知识图谱的静态兽医知识库。用于搭建新站点、新增文档格式、配置本地文件夹增量扫描，或接好定时同步与线上部署；英文文档标记为待翻译后交给独立的 vet-translation skill。
---

# VetBrain 兽医知识库站点

## 项目定位

**让兽医知识形成可检索、可关联的知识网络。**

系统整合专业文献、临床资料与学术文档，按学科体系分类整理，提供精准检索与知识图谱导航。持续更新，随时呈现最新知识脉络。

## 这套能力做什么

把一个本地资料文件夹变成「下次打开就是最新内容」的兽医知识库：

- 扫描本机固定文件夹里的 PDF / DOCX / PPTX，增量转换成 Markdown
- 建立中文全文检索索引与知识图谱导航，支持精准定位与关联浏览
- 从文档和概念词典生成知识图谱（文档—概念—共现关系）
- 英文文档标记为待翻译，交由独立的 `vet-translation` skill 译成专业中文
- 本地定时扫描 + git push → CI 重建并部署到 Cloudflare Pages

## 何时使用

- 用户说「建一个收录我文档的网站 / 知识库」「加检索 / 知识图谱」
- 用户说「上传一个文档」「新加一份资料」「定时扫描某个本地文件夹」「增量更新」「push 后线上自动更新」
- 用户要支持新的文档格式（PDF、Word、PPTX）
- 用户要处理英文文档时，转交 `vet-translation` skill
- 用户说文档格式不统一、缺标题/摘要/目录时，转交 `doc-format-guard` skill
- 用户说内容堆在一起、需要合理分段时，转交 `content-segmentation` skill
- 用户说内容不专业、需要过滤无关内容时，转交 `content-review` skill

## 快速流程

1. **确认现状**：查看项目根目录是否已有 `vetbrain.config.json`、`scripts/`、`content/synced/`。若没有，从 `templates/` 复制：
   - `templates/vetbrain.config.json` → `<项目根>/vetbrain.config.json`
   - `templates/scripts/*.mjs` → `<项目根>/scripts/`
   - `templates/data/*.json` → `<项目根>/data/`
2. **改配置**：编辑根配置的 `sources[].path`（支持 `~`）、`include`、`category` / `useSubfolderAsCategory`、`schedule`、`git.autoPush`。详见 `references/config-schema.md`。
3. **先扫一遍**：`pnpm run sync -- --no-push`，确认 `content/synced/*.md` 数量、分类、正文质量。
4. **处理用户上传的文档**：把文件放进 `content/inbox/`，运行 `pnpm run upload`；脚本会转换、校验专业性、去重、入库、重建并推送。详见 `references/upload.md`。
5. **处理英文文档**：运行 `pnpm run translate:pending` 得到清单，然后加载 `vet-translation` skill 逐篇翻译；本 skill 不直接翻译。
6. **格式校验**：`pnpm run format:check`，必要时 `pnpm run format:fix`（由 `doc-format-guard` skill 负责细节）。
7. **构建验证**：`pnpm run build` 与 `pnpm run check`，确认 Pagefind 索引页数、图谱节点/边数正常。
8. **布置定时**：`pnpm run sync:install`（macOS launchd）。
9. **上线**：确认后 `git add . && git commit && git push`；或开启 `git.autoPush` 让下次扫描自动推送。

## 关键文件

| 文件 | 作用 |
| --- | --- |
| `vetbrain.config.json` | 根配置：扫描哪些文件夹、何时扫、是否自动 push |
| `scripts/extractors.mjs` | PDF / DOCX / PPTX → Markdown 的转换层 |
| `scripts/sync.mjs` | 增量扫描器（SHA-256 判重、子目录分类、英文标记） |
| `scripts/graph.mjs` | 从文档 + 概念词典生成图谱 JSON |
| `scripts/translation.mjs` | 列出 `needsTranslation: true` 的文档 |
| `scripts/install-schedule.mjs` | 安装/卸载 macOS 定时任务 |
| `data/concepts.json` | 概念词典，决定图谱节点 |
| `data/glossary.json` | 英中兽医术语表，翻译时必须使用 |
| `content/synced/` | 扫描产出，会被 Git 跟踪 |
| `.cache/scan-state.json` | 增量状态，gitignore |

## 翻译规则（重要）

- 只翻译 `needsTranslation: true` 的文档；翻译后把 frontmatter 改为 `language: zh`、`needsTranslation: false`、`translatedFrom: en`，并保留 `originalTitle`。
- 保留原有 Markdown 结构（标题层级、列表、表格、图片引用）。
- 专业术语必须优先采用 `data/glossary.json` 的译法；新术语译出后补充进术语表。
- 不要改动 `contentHash`、`syncedFrom`、`sourceName` 等来源字段。
- 源文件未变时，增量扫描不会覆盖已翻译文档；源文件变化后会重新变成英文待翻译。

## 常用命令

```bash
pnpm run sync -- --no-push      # 扫描但不推送
pnpm run sync -- --force        # 强制全量重扫（会覆盖已有翻译）
pnpm run translate:pending      # 列出待翻译文档
pnpm run build                  # 完整构建：ingest → graph → astro → pagefind
pnpm run check                  # 类型检查
pnpm run sync:install           # 安装定时扫描
```

## 参考

- `references/architecture.md`：项目流程、目录结构与更新机制
- `references/config-schema.md`：完整配置字段、sidecar 元数据、frontmatter 字段
- `references/translation-workflow.md`：英文文档翻译的逐步流程与质量检查
- `references/operations.md`：定时、部署、排错

## 注意

- PDF 必须是文字版；扫描件需要先 OCR，否则抽取为空会跳过。
- PPTX 通过解压 `ppt/slides/slideN.xml` 提取 `<a:t>` 文本，按幻灯片顺序生成标题。
- 同名 PDF 与 PPTX 的 slug 会带扩展名后缀，避免互相覆盖。
- 本机文件夹只有本机可见，因此「扫描」是本地定时任务；「构建部署」由 push 触发 CI 完成。
