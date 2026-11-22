# 项目配置说明（vetbrain.config.json）

这个文件放在项目根目录，是整个知识库的总开关。它决定：扫描哪些本地文件夹、怎么归类、什么时候扫、扫描后是否推送。

## sources：要扫描的文件夹

可以写多个来源。常用字段：

| 字段 | 说明 |
| --- | --- |
| `name` | 来源名称，会用于文档标识 |
| `enabled` | 是否启用这个来源 |
| `path` | 本地路径，支持 `~/...`，例如 `~/Desktop/vetBrain` |
| `category` | 默认分类 |
| `useSubfolderAsCategory` | `true` 时，用资料所在的一级子目录名作为分类 |
| `include` | 要扫描的文件类型，默认 PDF / Word / PPTX |
| `exclude` | 要忽略的文件，例如临时文件 `**/~$*` |
| `recursive` | 是否扫描子目录 |
| `tags` / `concepts` | 给这个来源生成文档时写入的默认标签与概念 |
| `keepOriginal` | `true` 时把原始文件也放进网站供下载；会增大仓库，默认 `false` |

## scan：扫描行为

| 字段 | 说明 |
| --- | --- |
| `stateFile` | 扫描进度记录的位置，默认 `.cache/scan-state.json` |
| `outputDir` | 生成文档的位置，默认 `content/synced/` |
| `onDeleted` | `remove` 表示源文件删掉后，对应文档也移除 |
| `minSizeKB` | 小于该体积的文件忽略 |

## schedule：定时设置

| 字段 | 说明 |
| --- | --- |
| `enabled` | 是否安装本机定时任务 |
| `weekday` | 每周执行 scan 的星期，`0=周日, 6=周六`；不填则每天执行 |
| `hour` / `minute` | 执行扫描的时间 |
| `label` | macOS 任务标识 |
| `runAtLoad` | 安装时是否立刻运行一次 |

## git：推送行为

| 字段 | 说明 |
| --- | --- |
| `autoPush` | 扫描后是否自动提交并推送 |
| `branch` | 推送分支，一般 `main` |
| `commitPrefix` | 提交信息前缀，默认 `chore(sync): ` |

## 单份资料的补充元数据

在原始资料旁边放一个同名 `.meta.json`，可以覆盖自动生成的元数据：

```json
{
  "title": "犬急性肾损伤：诊断思路",
  "category": "急诊与重症",
  "tags": ["犬", "肾脏"],
  "concepts": ["急性肾损伤", "肌酐"],
  "description": "来自某某教材的读书笔记",
  "date": "2026-11-22",
  "slug": "aki-dog",
  "language": "en",
  "needsTranslation": true,
  "enabled": false
}
```

- `language: en` 会让扫描器把文档标记为待翻译；术语统一用 `data/glossary.json`。
- `enabled: false`（或 `exclude: true`）表示**保留源文件但从网站移除该文档**，下次同步生效。
