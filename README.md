# AI Career Intelligence Hub

面向时间序列建模博士的中文优先职业情报站，追踪中国大陆与英国的 AI 产业、企业、招聘和技术项目。

[打开在线站点](https://haoming58.github.io/ai-career-intelligence-hub/) · [查看更新和发布记录](https://github.com/haoming58/ai-career-intelligence-hub/actions/workflows/pages.yml)

- **公司与岗位**按地区浏览雇主、部门或招聘分组和具体岗位。岗位页汇总可核验的职责、要求、官方投递入口、招聘流程和对应的面试练习。
- **情报库**支持关键词、地区、记录类型、方向和岗位状态组合筛选。覆盖时序算法、Applied Scientist、Research Engineer、MLE、LLM 推理与通信 AI。
- **个人工作台**支持添加、编辑和删除能力、科研项目、工程项目和学习计划，记录状态、目标日期和成果。内置六道可按方向筛选的面试练习题。
- **月度报告**统计上月首次收录、岗位状态变化和样本分布。首版附当月采集快照。
- **部署**使用 Python 标准库、JSON、原生 HTML/CSS/JavaScript、GitHub Actions 和 GitHub Pages。构建与采集无需安装 Python 包。

## 本地运行

Python 3.11+ 可构建和采集。Node.js 22+ 用于前端测试。

```powershell
python -m unittest discover -s tests -v
node --test tests/frontend.test.cjs
python hub.py build
python -m http.server 8000 --bind 127.0.0.1 --directory dist
```

浏览器打开 [本地预览](http://127.0.0.1:8000/)。工作台使用当前站点的浏览器本地存储，个人记录和复习进度仅在该浏览器配置文件中可见。清理站点数据会删除这些记录。

## 采集与报告

```powershell
python hub.py update
python hub.py report
python hub.py report --month 2026-11
python hub.py build
```

`report` 默认生成上一个 UTC 自然月的报告。指定当前月份时输出月内快照。报告按首次收录和状态变化统计，跨方向标签可以重复计数。统计描述这个情报库的覆盖范围。

| 采集范围 | 方式 | 字段与覆盖说明 |
| --- | --- | --- |
| 时序、推理与通信 AI 论文 | arXiv Atom API，一次请求最多收录 24 篇 | 首次提交日期取 Atom 元数据。Atom 限流或服务端暂不可用时，读取官方 RSS 的最近一期新论文公告。RSS 日期为公告日期，标题短语在 `data/sources.json` 中配置。 |
| 开源项目 | GitHub REST API | 定点跟踪 Chronos、vLLM、Sionna、Qwen3。发布日期字段记录仓库创建时间。 |
| 英国岗位 | Anthropic 的官方 Greenhouse Job Board API | 采集职位和部门元数据，筛选英国地点和相关标题。列表缺少首次发布日期时保留空值。 |
| 中国大陆岗位 | 六家雇主的公开 Greenhouse 职位板 | 定期采集安贤投资、SES AI、小鹏汽车、RZR Global、AlphaGrep、Rock Bund Capital 的中国大陆相关岗位及公开部门。 |
| 中国大陆与英国其他岗位 | 雇主官方招聘页或官网链接的招聘系统，人工核验 | 包括百度、DeepSeek、美团、博世、腾讯、Apple、Amazon、Arm 等。人工核验记录与自动职位板状态分开展示。 |
| 产业报告与企业 | GOV.UK Content API 及官方资料人工核验 | 英国 AI 产业调查自动更新元数据，中国大陆报告及企业资料人工维护。 |

接口说明见 [arXiv API 条款](https://info.arxiv.org/help/api/tou.html)、[arXiv RSS](https://info.arxiv.org/help/rss.html)、[GitHub 仓库 API](https://docs.github.com/en/rest/repos/repos#get-a-repository)、[Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html) 和 [GOV.UK Content API](https://www.gov.uk/api/content/government/publications/artificial-intelligence-sector-study-2025)。

### 证据与历史

- **A** 表示雇主、项目维护者或报告发布机构的原始资料。**B** 表示 arXiv 预印本资料。等级描述来源性质。
- 每条记录保留来源链接、来源发布日期、首次和最近采集时间，以及字段变化的快照。日期缺失显示「未公开」。
- **官方职位板在列**表示最近一次成功请求时在匹配范围内。**已从职位板移除**表示完整职位板中已无该 ID。**已超出监测范围**表示职位板仍有此 ID，但地点或标题条件已变化。**人工核验样本**表示曾在雇主官方页面核验，申请前请打开原始页面确认。
- 用稳定 ID 和归一化来源链接去重。接口失败保留最近记录与最后成功时间。Greenhouse 仅在收到非空、数量一致且 ID 唯一的完整结果时更新岗位状态。
- 仓库仅发布必要的公开元数据和摘要。采集使用明确配置的公开 API，人工记录保留链接，便于按来源规则核对。
- 招聘流程来自雇主公开指南，标明核验日期与适用范围。仅对匹配地区、岗位或类别展示对应指南。按岗位方向匹配的练习题用于自测。

## GitHub Pages 部署

1. 在 GitHub 创建空的公开仓库 `ai-career-intelligence-hub`，默认分支使用 `main`。
2. 在本地仓库目录提交代码，然后推送。以下命令中的 `OWNER` 替换为 GitHub 用户名。
   ```powershell
   git remote add origin https://github.com/OWNER/ai-career-intelligence-hub.git
   git push -u origin main
   ```
3. 打开 **Settings → Pages → Build and deployment**，将 **Source** 设为 **GitHub Actions**。
4. 打开 **Actions → Publish Career Hub → Run workflow**。首次发布选 `publish`，验证采集和报告可选 `update-and-report`。部署作业的 `github-pages` 环境会显示站点地址。
5. 验证站点能打开并搜索，再查看 Actions 的任务结果。若仓库规则保护 `main`，允许工作流写入采集结果，或按维护策略调整数据写入方式。

周一 07:17 UTC 采集，每月 1 日 07:43 UTC 生成上月报告。每次周更也会补算上月报告。任务在同一流程中运行测试、保存 JSON、构建并部署，因而定时任务写入数据后会发布同一份数据。默认使用仓库的 `GITHUB_TOKEN`，配置了对应作业的权限。GitHub 公共仓库长时间无活动时，可能需要重新启用定时任务。 [GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) · [GitHub Actions 定时事件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## 目录

| 路径 | 用途 |
| --- | --- |
| `hub.py` | 公开接口采集、去重和历史、报告、静态构建 |
| `data/sources.json` | 公开接口采集配置 |
| `data/seed.json` | 初始及人工核验的来源记录 |
| `data/catalog.json` | 最近采集结果与记录历史 |
| `data/reports/` | 月度报告 JSON |
| `site/` | 响应式前端与面试、学习计划模板 |
| `site/hiring.json` | 官方申请与面试指南及适用范围 |
| `tests/` | 采集、历史、月报与前端回归测试 |
| `.github/workflows/` | 拉取请求测试及自动采集、月报与 Pages 发布 |
