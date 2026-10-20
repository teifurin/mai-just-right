# 官方来源与核验记录

核验日期：**2026 年 10 月 20 日（Asia/Tokyo）**。已重新核对完整活动规则、官方 README、声明原始文件与 MCP 中文指南；页面仍可能更新。

| 来源 | URL | 本项目据此确认的内容 |
| --- | --- | --- |
| 比赛 README | https://github.com/M-China/mcd-developer-innovation-challenge | 报名字段、公开仓库、源码与声明原样保留要求 |
| 完整活动规则 | https://github.com/M-China/mcd-developer-innovation-challenge/blob/main/activityGuidelines.md | `mcp-config.example.json` 要求、真实 MCP 使用、资格、时间与排名机制 |
| 官方参赛声明 | https://github.com/M-China/mcd-developer-innovation-challenge/blob/main/CONTEST_DECLARATION.md | 独立开发、信息安全及参赛声明的官方内容 |
| 声明原始文件 | https://raw.githubusercontent.com/M-China/mcd-developer-innovation-challenge/main/CONTEST_DECLARATION.md | 用于直接下载并逐字保留 |
| MCP 中文指南 | https://github.com/M-China/mcd-mcp-server | 服务地址、Streamable HTTP、Bearer Token、工具名称与用途 |
| MCP 英文指南 | https://github.com/M-China/mcd-mcp-server/blob/main/README_EN.md | 与当前中文指南交叉核验 |
| MCP 开放平台 | https://open.mcd.cn/mcp | 官方指南列出的个人 Token 申请入口 |

## 与交付直接相关的规则

- 报名窗口：北京时间 2026-10-09 10:30 至 2026-10-25 23:59。最终排名依据为北京时间 2026-10-26 00:00 的公开 Star 总数。
- 完整规则比 README 简表多列出 `mcp-config.example.json`；本项目按完整规则提供。
- 参赛项目必须真实使用麦当劳 MCP；工具接入代码、样例数据和模拟测试不能替代真实联调。
- 规则要求中国大陆地区合法居民，成年或取得监护人同意。奖品申领还涉及大陆收货地址及实名手机号；该资格由参赛者本人确认。
- WorkBuddy 专项要求实际使用该产品并提供上下文记录。本项目未使用，因此不提供虚构的 `workbuddy.md`。

## 声明文件校验

本次下载的根目录 `CONTEST_DECLARATION.md` SHA-256：

```text
cd28101bcb29cc8fb24b372fe91ce6b42c4a1487a54e01f7ade0c8c6a84241b7
```

此值对应本次交付版本。官方后续如更新声明，应重新下载原文件并更新校验记录，不能只修改本地声明的措辞。

## 未核验事项

开放平台的交互式 Token 申请流程未亲验，申请入口依据官方 GitHub 文档记录。本轮脚本从本机环境变量取得凭证，已验证真实工具发现、四项只读查询及三组官方核价；未读取或展示 `.env` 原文。当前工具参数以运行时 `tools/list` 为权威，验证范围见 [VALIDATION.md](VALIDATION.md)。

检索缓存曾显示旧的协议版本限制，但重新打开的当前中英文 README 已未载明，项目不据此声称存在该限制。
