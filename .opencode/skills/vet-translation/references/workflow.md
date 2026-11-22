# 英文文档 → 专业兽医中文

这个项目里的英文资料不会交给通用机器翻译。扫描器只负责识别并标记，翻译由 OpenCode 在这个 skill 里完成，以保证兽医专业术语准确、风格统一。

## 判断标准

扫描时，如果一份文档中文字符很少、拉丁字母很多，frontmatter 会写入：

```yaml
language: en
needsTranslation: true
```

中文文档则保持 `language: zh`、`needsTranslation: false`。

## 翻译步骤

1. 运行 `pnpm run translate:pending`，拿到待翻译清单。
2. 逐篇打开 `content/synced/<文件名>.md`。
3. 阅读 `data/glossary.json`，优先采用里面的既有译法。
4. 翻译标题与正文，保留原有 Markdown 结构：
   - 标题层级、列表、表格、图片引用都不要改结构
   - 专业术语保持统一，例如 ultrasound → 超声，nerve block → 神经阻滞
   - 剂量、药名、缩写（如 AKI、CKD、BUN）按兽医惯例保留或加中文注释
5. 更新 frontmatter：
   - `title` 改为中文标题
   - `originalTitle` 保留英文原题（新增字段）
   - `language: zh`
   - `needsTranslation: false`
   - `translatedFrom: en`
6. 译出一个新术语时，把它补进 `data/glossary.json`，下次保持一致。
7. 不要改动 `contentHash`、`syncedFrom`、`sourceName`、`sourceType` 等来源字段。

## 需要注意

- 源文件发生变化时，下次扫描会重新生成该文档，它会再次变成英文待翻译状态。
- 源文件没变时，扫描器不会覆盖你已经翻译好的文档。
- 不要用 `--force` 全量重扫已经翻译过的项目，否则会覆盖翻译结果，除非你准备重新翻译。
- 翻译完成后运行 `pnpm run build`，确认检索索引和图谱包含新中文内容。

## 质量检查

- 专业术语是否与术语表一致
- 是否保留了原文的标题层级与列表结构
- 是否误译了解剖方位词（cranial/caudal/proximal/distal）
- 是否把药品名、剂量、缩写保留为专业写法
