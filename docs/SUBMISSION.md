# 报名材料草稿

**状态：技术验证与真实个人账号 MCP 联调已完成；报名 Issue 尚未提交。项目仓库：<https://github.com/teifurin/mai-just-right>。**

这份文件是发布前的草稿，不代表用户已经接受参赛声明或完成资格确认。比赛要求及最终解释以[官方活动规则](https://github.com/M-China/mcd-developer-innovation-challenge/blob/main/activityGuidelines.md)为准。

## 发布前完成

1. 已完成真实只读查询与三组官方核价；脱敏证据和测试结果见 `docs/VALIDATION.md`。
2. 参赛者需确认：中国大陆地区合法居民，且年满 18 周岁或已取得监护人同意；已阅读并接受活动规则及根目录官方参赛声明。
3. 核对公开仓库可访问，含 `README.md`、原样 `CONTEST_DECLARATION.md`、`MCP_INTEGRATION.md`、`mcp-config.example.json` 及源码。
4. 经参赛者授权后，使用下文向官方比赛仓库提交 Issue，再核对自动审核结果；不能把公开发布等同于已报名。

**报名截止为北京时间 2026 年 10 月 25 日 23:59，东京时间 10 月 26 日 00:59。** 排名按公开 Star 数量计算；不使用刷榜或虚构调用记录的方式补足条件。完整时间与规则来源见 [SOURCES.md](SOURCES.md)。

## Issue 标题

```text
【参赛申请】麦麦刚刚好 Mai Just Right：从想吃的餐品出发，算清套餐与优惠
```

## Issue 正文模板

**技术内容已经过真实调用复核；提交仍需参赛者确认资格和声明。**

```text
【参赛申请】
项目名称：麦麦刚刚好 Mai Just Right
项目地址：https://github.com/teifurin/mai-just-right
项目简介：面向麦当劳中国用餐场景的需求优先决策工具，提供中文 Web 应用、确定性组合优化器、CLI 与 Agent Skill。用户先选择想吃的餐品、数量及预算，再比较严格满足需求和允许额外餐品两种购买组合，查看清楚的计算基准、来源标签、小票与多人分摊。项目接入官方 MCP，依据运行时 Schema 查询门店、菜单与优惠，并使用 calculate-price 核价；样例演示与真实调用分开标识。包含必需参赛文件、可运行源码和脱敏验证说明。未使用 WorkBuddy 开发，不申请 WorkBuddy 专项开发奖励。
```

每个字段与值保持同一行，项目地址使用公开 GitHub 仓库的裸 URL。

## 推荐仓库简介

```text
Intent-first McDonald's meal planning: bounded exact combo search, clear savings baselines, receipts, group splitting, and a read-only MCP workflow. Demo data is explicitly labeled.
```
