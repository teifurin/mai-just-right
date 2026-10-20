![麦麦刚刚好：按需选餐、优惠比较与清楚分账](docs/images/mai-just-right-banner.png)

# 麦麦刚刚好 · Mai Just Right

**先决定想吃什么，再计算怎么买：把套餐、优惠与预算放在同一张清楚的账单上。**

麦麦刚刚好是一个面向麦当劳中国用餐场景的点餐决策项目，包含可运行的中文 Web 应用、确定性的组合优化器、命令行工具和通用 Agent Skill。它先记录用户原本想吃的餐品，再比较购买组合；用户可以选择只买所需餐品，或明确允许套餐带来额外餐品。

项目为独立开发的参赛作品，非麦当劳官方产品。**演示餐品、价格和优惠均为构造样例，不代表当前官方售价或可用优惠。**

## 适合谁

- 想吃的东西已经确定，希望算清单点、套餐与优惠组合的人。
- 有明确预算、希望看清“优惠后是否真的少付钱”的人。
- 需要一起点餐、核对总价并分摊金额的小组。
- 希望通过 MCP 客户端读取官方信息、逐项核价的开发者与 Agent 用户。

## 主要功能

| 功能 | 行为 |
| --- | --- |
| 需求优先 | 先选想吃的餐品和数量，再求解购买组合 |
| 两种购买边界 | 默认不接受多余餐品；显式开启后才把额外餐品纳入候选 |
| 预算检查 | 显示方案总额与预算的关系，不把超预算方案伪装成可行解 |
| 可解释账单 | 展示购买组合、额外餐品与计算基准；节省额始终有对应基准 |
| 数据来源 | 演示数据与 MCP 返回分开标识 |
| 小票与本地历史 | 留下可核对的结果，历史保存在当前浏览器 |
| 多人分摊 | 将总金额分摊给参与者，分摊之和与总额一致 |
| 真实接入入口 | 服务端 MCP 客户端、运行时工具发现和只读查看器 |
| 官方核价比较 | 对一个基准和最多五个候选分别调用官方核价，再比较应付金额 |
| Agent Skill | 用用户当前需求组织官方信息查询和核价流程 |

### 怎样理解“最优”

优化器针对**当前输入、当前样例商品集和规定的搜索边界**计算最低成本组合。它并未穷尽全国所有门店、渠道、活动和账户权益。允许多余餐品时，额外餐品会单独列出，用户可以立即切回“只买想吃的”。

节省额采用相同需求的单点基准，不把宣传原价、已省金额或额外餐品的标价再次算作节省。演示优化结果不会自动成为实时官方报价；真实订单金额须通过官方 `calculate-price` 返回核实。

## 本地运行

需要 **Node.js 22.13.0 或更新版本**。依赖由锁定的 **pnpm 11.25.0** 管理；在项目目录执行：

```sh
npx --yes pnpm@11.25.0 install --frozen-lockfile
npm run dev
```

打开终端打印的地址。普通本地环境默认从 `http://localhost:5173` 启动；托管预览可能使用其他端口。无需 Token 即可体验全部演示优化流程。

| 命令 | 用途 |
| --- | --- |
| `npm run demo` | 运行命令行演示 |
| `npm test` | 运行核心测试 |
| `npm run verify` | 运行项目验证流程 |
| `npm run verify:live -- --evidence evidence/check.json` | 真实只读复核，只输出脱敏调用元数据 |
| `npm run receipt` | 在终端输出演示小票 |
| `npm run mcp:check` | 使用服务端 Token 发现官方工具并读取允许的只读快照 |
| `npm run mcp:call -- --tool <name> --input <path>` | 用 JSON 文件中的真实参数调用允许的只读工具 |
| `npm run mcp:quote -- --input <path>` | 对文件中的基准与候选逐一进行官方核价 |
| `npm run build` | 构建应用 |
| `npm start` | 在本地预览构建结果 |

核心 `.mjs` 计算与 CLI 使用 Node.js 标准能力；Web 应用依赖由 `pnpm-lock.yaml` 固定。上述安装命令无需全局安装 pnpm，后续 `npm run` 仅用于启动脚本。原始运行环境说明保留在 [STARTER_NOTES.md](docs/STARTER_NOTES.md)，当前项目的启动步骤以本 README 为准。

CLI 也支持自然语言与结构化需求：

```sh
node scripts/mai-cli.mjs plan --text "35元，一个麦辣鸡腿堡、一份薯条、一杯可乐"
node scripts/mai-cli.mjs plan --input examples/intent.json --json
node scripts/mai-cli.mjs help
```

## 接入真实麦当劳 MCP

1. 在[麦当劳 MCP 开放平台](https://open.mcd.cn/mcp)申请个人 Token。
2. 将 Token 配为**服务端环境变量** `MCD_MCP_TOKEN`。不要使用 `NEXT_PUBLIC_` 前缀，不要提交到仓库或粘贴到浏览器前端。
3. 运行 `npm run verify:live` 做脱敏连通性验证。开发者需要完整参数 Schema 或原始结果时，再运行 `npm run mcp:check`；原始输出可能含账户信息，不要公开。
4. 使用应用中的只读 MCP 查看器，或安装 Agent Skill，在实际 Schema 下读取门店、菜单和优惠信息。
5. 按真实返回填写 `examples/quote-request.template.json` 的副本，明确金额字段 `totalPath` 及单位，运行 `npm run mcp:quote -- --input <你的请求文件>`。

配置模板见 [.env.example](.env.example) 和 [mcp-config.example.json](mcp-config.example.json)。模板中的变量由运行环境或 MCP 客户端的安全配置解析；不同客户端的变量注入方式可能不同。

托管环境的真实 MCP API 必须经过身份验证。本地调试才可显式设置 `MCD_ALLOW_LOCAL=1`；不要在公开部署中启用该开关。详细的数据边界和接入流程见 [MCP_INTEGRATION.md](MCP_INTEGRATION.md)。

### Agent Skill 安装

保留整个项目目录，将 `skills/mai-just-right/SKILL.md` 注册到支持 Agent Skills 的客户端中，或在客户端打开本仓库并加载该 Skill。它需要能访问本仓库的 `scripts/mai-cli.mjs`，不要只复制说明文件后删除其脚本依赖。把 `mcp-config.example.json` 的远程连接配置加入客户端，并通过客户端的安全设置注入自己的 Token。

示例请求：

> 两个人吃。我想要一个汉堡和一杯饮料，同伴想要鸡块，预算 60 元。先只买这些；如果有更省的套餐，请把多出来的餐品和实际多付或少付的钱讲清楚。拿不到实时价格就明确告诉我。

## 真实核价与验证

- 演示模式可以独立运行；**56 项离线测试、TypeScript 和生产构建通过**。测试、真实调用和浏览器验证边界见 [VALIDATION.md](docs/VALIDATION.md)。
- **已使用个人 Token 完成真实账号联调（2026-10-20）**：工具发现、4 个只读业务工具、门店 / 菜单 / 套餐详情查询，以及一次“基准 + 两个候选”的官方 `calculate-price` 核价比较全部成功。脱敏证据见 [docs/evidence](docs/evidence/)。
- 实测示例（深圳华强北一家门店，到店自取，未用券）：

  | 方案 | 官方核价 | 相对单点 | 多出餐品 |
  | --- | ---: | ---: | --- |
  | 单点：麦辣鸡腿汉堡 + 中薯条 + 可乐中杯（基准） | ¥46.00 | — | 0 |
  | 麦辣鸡腿汉堡三件套 | **¥33.50** | 少付 ¥12.50 | 0 |
  | 麦辣鸡腿堡四件套 | ¥57.00 | 多付 ¥11.00 | 麦乐鸡 4 块 |

  四件套在菜单列表中显示 ¥28（带“麦金卡”标签），但本账户的官方核价为 ¥57.00。列表价不等于应付金额，这正是本项目坚持以官方核价为准的原因。价格是当时快照，会随门店、时段和账户变化。

## 开发文档

- [架构与算法边界](docs/ARCHITECTURE.md)
- [MCP 集成](MCP_INTEGRATION.md)
- [测试与真实核价验证](docs/VALIDATION.md)
- [参赛声明](CONTEST_DECLARATION.md)
- [许可与第三方说明](docs/NOTICE.md)

原创项目代码采用 [MIT License](LICENSE)。官方参赛声明按原文件保留，第三方组件、脚手架和相关商标的权利不因本项目许可而改变。
