---
name: 兽医文档中译
description: 把英文兽医、动物医学相关资料翻译为专业、术语统一的中文。用于翻译知识库中标记 needsTranslation 的英文文档，或任何英文教材、课件、论文与笔记。
---

# 兽医文档中译

这个 skill 只做一件事：**把英文兽医资料译成专业中文，并保持术语统一、结构完整**。它不负责扫描、建站或部署；那些由 `vetbrain-knowledge-site` skill 负责。

## 何时使用

- 用户说「把这篇英文资料翻译成中文」「翻译这篇课件」
- 知识库里出现 `needsTranslation: true` 的文档
- 需要统一一批英文资料的兽医专业术语译法

## 工作流程

1. 确认待译文档：
   - 在知识库项目中运行 `pnpm run translate:pending` 获取清单；
   - 或直接读取用户指定的 Markdown / 文本文件。
2. 读取项目里的 `data/glossary.json`（若不存在，可用 `templates/glossary.json` 作为起点）。
3. 按 `references/workflow.md` 逐篇翻译：
   - 保留原有 Markdown 结构（标题、列表、表格、图片引用）
   - 专业术语优先采用术语表既有译法
   - 新术语译出后补进术语表
4. 若是知识库文档，更新 frontmatter：`language: zh`、`needsTranslation: false`、`translatedFrom: en`，并用 `originalTitle` 保留英文原题。
5. 不要改动来源字段：`contentHash`、`syncedFrom`、`sourceName`、`sourceType`。
6. 翻译后建议运行 `pnpm run build`，确认检索与图谱包含新中文内容。

## 术语原则

- 解剖、药理、麻醉、临床病理等术语以中国兽医教材常用译法为准。
- 方位词：cranial=颅侧，caudal=尾侧，proximal=近端，distal=远端，rostral=吻侧。
- 拉丁学名与缩写（如 AKI、CKD、BUN、a. carotis communis）保留原文，必要时附中文说明。
- 药名、剂量、单位保持原样，不擅自换算。
- 不确定时优先查证，禁止编造专业术语。

## 参考

- `references/workflow.md`：逐步翻译流程与质量检查
- `templates/glossary.json`：可复制到项目的兽医英中术语表起点

## 与其他 skill 的关系

- `vetbrain-knowledge-site`：负责扫描本地文件夹、生成知识文档、图谱与检索索引。
- 本 skill：负责把其中或用户提供的英文资料译成专业中文。两者通过 `needsTranslation` 标记与 `data/glossary.json` 衔接。
