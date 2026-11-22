# 内容审核判定细则

## 直接过滤（无需询问）

| 类型 | 例子 |
| --- | --- |
| 网址 | `https://example.edu/...` |
| 邮箱 | `name@university.edu` |
| 版权 | `Copyright © 2024`、`All rights reserved` |
| 孤立页码 | `3`、`12`、`45` 单独成行 |
| 课程宣传 | `3-Day Continuing Education Course`、`三天持续教育课程` |
| 讲师与日期行 | `Hazai Diána 26.02.2024` 单独成行 |

## 保留（即使看起来像格式信息）

- 标题、小标题、摘要、目录
- 解剖学名与拉丁术语：`A. carotis communis`、`Plexus brachialis`
- 专业缩写与指标：`AKI`、`CKD`、`BUN`、`CREA`、`TAP`、`ESP`
- 剂量与单位：`2 mg/kg`、`0.5%`、`1:200,000`
- 表格中的专业数据

## 待人工确认

- 无法判断专业含义的孤立句子
- 大段致谢、课程介绍、机构介绍
- 重复出现的页眉页脚文字
- 与动物医学无关但也不明显是噪声的内容

处理方式：先保留，问我确认后再删。

## 审核后检查

过滤完成后按顺序检查：

1. `pnpm run format:check`：标题、摘要、目录是否仍完整
2. `pnpm run segment:check`：是否产生新的超长段落
3. `pnpm run build`：检索索引与图谱是否正常
