# 日常使用与上线

## 最常用命令

```bash
pnpm run sync -- --no-push      # 今天扫一遍，不推送
pnpm run sync                   # 扫描；若配置开启 autoPush 会自动提交推送
pnpm run translate:pending      # 查看哪些英文文档还没翻译
pnpm run build                  # 生成最新站点、检索索引与图谱
pnpm run check                  # 检查项目是否正常
pnpm run sync:install           # 安装本机定时扫描
pnpm run sync:install -- --uninstall  # 卸载定时扫描
```

## 定时扫描

配置里的 `schedule.weekday` / `hour` / `minute` 决定每周什么时候扫描。当前项目设为**每周六 10:00**；不填 `weekday` 则每天执行。安装后，到点会自动执行：

1. 增量扫描本机文件夹
2. 新文档写入 `content/synced/`
3. 英文文档标记为待翻译
4. 如果 `git.autoPush: true`，提交并推送

> 翻译这一步需要你在 OpenCode 里加载本 skill 完成。定时扫描只做识别和准备，不会强行用通用翻译覆盖专业术语。

## 上线

推送后，GitHub Actions / Cloudflare Pages 会重新构建并发布网站。下次打开就是最新内容。

首次上线需要：

- 把项目推送到你的 GitHub 仓库
- 在 Cloudflare Pages 连接该仓库，构建命令 `pnpm run build`，输出目录 `dist`，Node 24
- 在 GitHub Secrets 里配置 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`

## 排错

| 现象 | 处理 |
| --- | --- |
| 扫描说「未抽取到文本」 | 该 PDF 是扫描件，先做 OCR |
| 文档数量和源文件数量不一致 | 检查同名文件是否靠 slug 扩展名区分；必要时 `--force` 重扫 |
| 翻译后的文档又被变回英文 | 源文件变化后会重新生成，需重新翻译；避免对已翻译项目用 `--force` |
| 网站没更新 | 确认已推送，且 Pages 构建成功 |
| 搜索没有结果 | 运行 `pnpm run build` 生成索引；开发模式下搜索页不可用 |
