# 文档上传流程

网站本身是静态的，没有服务端上传接口。用户要新增文档时，使用本地收件箱：

```
content/inbox/   ← 把 PDF / Word / PPTX 放进来
```

然后运行：

```bash
pnpm run upload                      # 处理收件箱中所有文档
pnpm run upload -- path/to/a.pdf     # 处理指定文档
pnpm run upload -- --no-push         # 只入库，不提交推送
```

## 三步处理

1. **转换**：复用 `scripts/extractors.mjs`，把 PDF / DOCX / PPTX 转成项目可渲染的 Markdown。
2. **校验与去重**：
   - 正文少于 200 字 → 判为无价值，跳过
   - 未识别到足够的兽医/动物医学专业关键词 → 跳过
   - 与现有文档内容哈希一致 → 跳过（完全重复）
   - 与现有文档 4-gram 相似度 > 0.75 → 跳过（近似重复）
3. **入库与刷新**：
   - 写入 `content/raw/新上传/`
   - 自动运行 `pnpm run build`（重新生成图谱、检索索引与静态页）
   - 自动 `git commit + push`，Cloudflare Pages 收到 push 后重建上线

## 结果

- 有效文档：被移除出收件箱，进入知识库
- 无效/重复文档：保留在收件箱，并打印跳过原因，由用户决定删除或补充元数据

## 补充元数据

在文档旁放同名 `.meta.json` 可指定 `title`、`category`、`tags`、`concepts`、`description`、`slug`，与新文档一起放进收件箱即可。
