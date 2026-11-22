# VetBrain

面向兽医专业人员与动物医学从业者的知识库网站：系统整合专业文献、临床资料与学术文档，形成可检索、可关联的专业知识网络。

## 工作流

```
你本机的固定文件夹（根配置里指定）
        │  pnpm run sync —— 定时/手动，按文件哈希增量扫描
        ▼
content/synced/*.md   ← 会被 Git 跟踪的「已转换文档」
        │  git commit + push
        ▼
Cloudflare Pages（Git 集成自动构建）
        │  pnpm run build
        ▼
ingest → graph → astro → pagefind
        │
        ▼
下次打开网站 = 最新内容（新文档、新知识图谱、新检索索引）

此外 content/raw/（手动放的 PDF/Word）、content/manual/（手写 Markdown）也仍是内容来源。
data/concepts.json 是概念词典，决定图谱节点与关键词抽取。
```

- **检索**：Pagefind 构建中文索引，浏览器端查询，不需要搜索服务。
- **图谱**：构建时从文档中抽取概念与共现关系，D3 力导向图在浏览器渲染。
- **定时**：本地文件夹只有你的 Mac 能访问，所以「扫描」由本机定时任务完成；「构建部署」由 push 触发 Cloudflare Pages 自动完成。

## 本地开发

需要 Node.js 24（见 `.node-version`）。

```bash
pnpm install
pnpm run dev       # 先生成内容，再启动 Astro 开发服务器
pnpm run build     # 完整构建：ingest → graph → astro → pagefind
pnpm run preview   # 本地预览 dist/
```

> 开发模式下 `/search/` 没有索引（Pagefind 只在构建后生成），检索功能请用 `pnpm run build && pnpm run preview` 验证。

## 根配置 + 本地文件夹增量同步（核心）

根目录的 `vetbrain.config.json` 是整个自动化的总开关：它定义**扫描哪些本地文件夹、什么时候扫、扫描结果放哪、是否自动 push**。

```json
{
  "sources": [
    {
      "name": "兽医资料",
      "enabled": true,
      "path": "~/Documents/VetBrain-Sources",
      "category": "兽医资料",
      "include": ["**/*.pdf", "**/*.docx"],
      "exclude": ["**/~$*", "**/.DS_Store"],
      "recursive": true,
      "tags": [],
      "concepts": [],
      "keepOriginal": false
    }
  ],
  "scan": {
    "stateFile": ".cache/scan-state.json",
    "outputDir": "content/synced",
    "onDeleted": "remove",
    "minSizeKB": 1
  },
  "schedule": {
    "enabled": true,
    "hour": 3,
    "minute": 0,
    "label": "com.vetbrain.sync",
    "runAtLoad": false
  },
  "git": {
    "autoPush": true,
    "branch": "main",
    "commitPrefix": "chore(sync): "
  }
}
```

字段说明：

| 字段 | 作用 |
| --- | --- |
| `sources[].path` | 本地文件夹路径，支持 `~`；可写多个 source |
| `sources[].include / exclude` | glob 模式，决定哪些 PDF / Word 被扫描 |
| `sources[].category / tags / concepts` | 给该来源生成文档时写入的默认元数据，`concepts` 会进入知识图谱 |
| `sources[].keepOriginal` | 是否把原始文件复制到 `public/originals/` 并在页面提供下载（会增大仓库） |
| `scan.stateFile` | 增量状态文件（记录文件哈希），已 gitignore |
| `scan.onDeleted` | `remove` 表示源文件被删除时，同步删除生成的文档 |
| `schedule.hour / minute` | 本机每天执行扫描的时间 |
| `git.autoPush` | 扫描后是否自动 commit + push（push 后线上自动重建） |

单个源文件旁可放同名 `.meta.json` 覆盖 `title / category / tags / concepts / description / slug`。

常用命令：

```bash
pnpm run sync                       # 按配置增量扫描（新增/修改/删除）
pnpm run sync -- --force            # 忽略状态，强制全量转换
pnpm run sync -- --no-push          # 本次只生成，不推送
pnpm run sync:build                 # 扫描 + 本地完整构建
pnpm run sync:install               # 安装本机定时任务（macOS launchd）
pnpm run sync:install -- --uninstall # 卸载定时任务
```

增量判断基于 **SHA-256 文件内容哈希 + 文件大小**，所以没变化的文件不会重复转换；源文件被删除时，对应生成文档也会移除。

> 注意：Cloudflare Pages 读不到你本机的文件夹，所以扫描必须在本地跑。安装 `pnpm run sync:install` 后，每周六 10:00 会自动扫描、提交并 push；Cloudflare Pages 收到 push 就重建。这样你下次打开网站看到的就是最新内容。

## 配套 OpenCode 技能

项目内的 `.opencode/skills/` 提供三个技能，分别负责不同环节：

- `vetbrain-knowledge-site`：配置扫描、增量更新、构建与上线
- `vet-translation`：把英文资料译为专业兽医中文，统一术语
- `doc-format-guard`：校验并统一标题、摘要、正文与长文目录格式

在 OpenCode 中打开本项目后即可加载使用。

## 上传新文档（收件箱）

网站是静态的，没有服务端上传接口。新增资料请用本地收件箱：

```bash
# 1. 把 PDF / Word / PPTX 放进 content/inbox/
# 2. 执行
pnpm run upload
# 或处理指定文件：pnpm run upload -- path/to/a.pdf
# 只看结果不推送：pnpm run upload -- --no-push
```

`upload` 会自动完成：

1. **转换**：把 PDF / DOCX / PPTX 转成站点可渲染的 Markdown
2. **校验与去重**：正文过短、缺乏专业内容、与现有文档完全重复或高度相似的文件会被跳过，并打印原因
3. **入库与刷新**：有效文档写入 `content/raw/新上传/` → 重建站点与检索索引 → 自动 commit + push → Cloudflare Pages 自动发布

被跳过的文件会留在收件箱，确认后自行删除或补充同名 `.meta.json` 再试。

## Word / PDF 转换层

Word 和 PDF 的转换逻辑集中在 `scripts/extractors.mjs`，摄取流程在 `scripts/ingest.mjs`。转换结果（Markdown）会同时供**知识图谱生成**和**Pagefind 检索索引**使用，所以转换质量直接决定检索与图谱效果。

面向日常使用的命令：

```bash
pnpm run convert --list                         # 列出 content/raw 中的文档及元数据情况
pnpm run convert --file content/raw/临床/a.pdf  # 只转换一个文档，并打印抽取预览
pnpm run convert                                # 转换全部 Word / PDF
```

- `--file` 模式会把抽取结果同时写入 `.cache/converted/<文件名>.md`，方便你检查中文断行、表格、图片是否正常。
- 支持的格式：`.pdf`、`.docx`；老式 `.doc` 若本机有 LibreOffice 会自动转 `.docx`，否则请先另存为 `.docx`。
- PDF 必须是**文字版**；扫描件需要先 OCR。PDF 抽取时会启用 pdfjs-dist 的 CJK 字符映射以改善中文效果。
- DOCX 的标题/列表/表格会转成 Markdown 结构，图片会写到 `public/files/assets/` 并在文中引用。
- 同一分类目录下的文档会自动带上分类；还可用同名 `.meta.json` 补充 `title / category / tags / concepts / description`，其中 `concepts` 会直接进入知识图谱。

## 放入你的文档

1. 把 PDF / DOCX 放到 `content/raw/`，可以用子目录表示分类：

   ```
   content/raw/临床/犬急性肾损伤.pdf
   content/raw/临床/猫肾病.docx.meta.json   # 可选，见下
   content/manual/我的笔记.md                # 手写 Markdown
   ```

   子目录名（如“临床”）会自动成为分类；直接放在 `content/raw/` 根目录的文件归入“未分类”。

2. 可选：为某个文档添加同名 `.meta.json`  sidecar 来补充元数据：

   ```json
   {
     "title": "犬急性肾损伤：诊断思路",
     "category": "急诊与重症",
     "tags": ["犬", "肾脏"],
     "concepts": ["急性肾损伤", "肌酐"],
     "description": "来自某某教材的读书笔记",
     "date": "2026-11-22",
     "slug": "aki-dog"
   }
   ```

3. 概念词典在 `data/concepts.json`。构建时会在正文中匹配这些术语（含别名），用于生成图谱节点。你可以持续补充自己的兽医学术语。

4. 手写 Markdown 放在 `content/manual/`，可使用 YAML frontmatter（`title`、`category`、`tags`、`concepts`、`date`、`description`）。正文中也支持 `[[概念]]` 形式的链接写法（目前按普通文本参与概念匹配）。

## 注意事项

- PDF 必须是**文字版**；扫描版需要先 OCR，否则抽取不到文本（构建日志会提示）。
- DOCX 支持 `.docx`；老式 `.doc` 请先用 Word / LibreOffice 另存为 `.docx`。
- 手动放进 `content/raw/` 的原始文件会复制到 `public/files/`（gitignore）；自动扫描来源的原始文件仅在 `keepOriginal: true` 时复制到 `public/originals/`（会被 Git 跟踪）。
- 中文 PDF 的抽取质量依赖字体映射；项目已引入 `pdfjs-dist` 的 CJK 字符映射以改善效果。

## 部署到 Cloudflare Pages

1. 把项目推送到你的 GitHub 仓库（当前远程：`https://github.com/windzyr-tech/vet-brain.git`）。
2. 在 Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git 选择该仓库。安装命令填 `pnpm install --frozen-lockfile`，构建命令填 `pnpm run build`，输出目录 `dist`，Node 版本 24（或设置环境变量 `NODE_VERSION=24`）。
3. 环境变量设置 `NODE_VERSION=24`；首次部署后再加 `SITE_URL=https://vet-brain.pages.dev`（或你的自定义域名）。
4. 点击 Save and Deploy。之后每次 push 到 `main`，Cloudflare Pages 都会自动重建并发布。
5. 本项目采用 Cloudflare Pages 的 Git 集成，无需 GitHub Actions；GitHub Actions 相关配置已移除。
6. 如有自定义域名，修改 `astro.config.mjs` 中的 `site` 或设置 `SITE_URL` 环境变量。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm run convert` | 转换全部 Word / PDF（等价于 ingest，但偏日常使用） |
| `pnpm run convert --list` | 列出待转换文档与元数据情况 |
| `pnpm run convert --file <路径>` | 转换单个文档并预览抽取结果 |
| `pnpm run sync` | 按根配置增量扫描本地文件夹 |
| `pnpm run sync -- --force` | 强制全量扫描 |
| `pnpm run sync -- --no-push` | 扫描但不推送 |
| `pnpm run sync:build` | 扫描 + 完整构建 |
| `pnpm run sync:install` | 安装/卸载本机定时任务 |
| `pnpm run ingest` | 只重新抽取文档（转换层的内部入口） |
| `pnpm run graph` | 只重新生成图谱数据 |
| `pnpm run generate` | ingest + graph |
| `pnpm run build` | 完整静态构建（含 Pagefind 索引） |
| `pnpm run check` | Astro / TypeScript 检查 |
