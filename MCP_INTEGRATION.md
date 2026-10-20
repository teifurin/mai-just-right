# 麦当劳 MCP 集成说明

## 状态与业务价值

麦麦刚刚好使用 MCP 获取决策所需的官方信息，让 Agent 先确认用户的目标餐品、预算、是否接受额外餐品，再读取门店、菜单、优惠和价格。核心价值是把“我想吃什么”和“怎么买划算”连接起来，并保留计算依据。

本仓库包含真实远程客户端和只读调用入口。**2026-10-20 已使用个人 Token 完成真实账号联调**（结果见文末“真实联调记录”与 [docs/evidence](docs/evidence/)）。离线演示与协议测试仍不作为真实 MCP 调用证据。

## 服务与配置

| 项目 | 配置 |
| --- | --- |
| Server | 麦当劳中国官方 MCP Server |
| 地址 | `https://mcp.mcd.cn` |
| 传输 | Streamable HTTP |
| 鉴权 | `Authorization: Bearer <MCD_MCP_TOKEN>` |
| Token 来源 | [官方开放平台](https://open.mcd.cn/mcp) |
| 公开配置 | 根目录 `mcp-config.example.json`，仅引用环境变量 |

官方说明见 [M-China/mcd-mcp-server](https://github.com/M-China/mcd-mcp-server)。当前工具 Schema 以经过认证的 `tools/list` 返回为准。README 中的工具列表只能确认名称及用途，不能替代实际参数定义。

`MCD_MCP_TOKEN` 仅在服务端读取，不出现在浏览器包、结果小票、localStorage 或提交材料中。`MCD_ALLOW_LOCAL=1` 只用于回环地址上的本地开发。托管账户访问默认关闭；只有在可信 Sites 网关后配置 `MCD_TRUST_SITES_IDENTITY=1` 和 `MCD_OWNER_USER_ID`，才接受该所有者的已认证身份。独立服务器不得直接信任客户端提供的身份请求头，具体边界见 [SECURITY.md](SECURITY.md)。服务返回 401 时检查访问配置或凭证，429 时停止密集请求并稍后重试。官方标示每 Token 每分钟最多 600 次请求。

## 工具与流程

这些是本项目工作流所依赖的官方工具。能否调用以及所需参数，还需用当前账号发现结果核验。

| 工具 | 在本项目中的用途 |
| --- | --- |
| `now-time-info` | 获取官方时间上下文 |
| `campaign-calendar` | 查找当前活动背景，避免把过期活动当作可用报价 |
| `query-nearby-stores` | 定位用户选定的门店 |
| `query-meals` | 读取该门店当前餐品及编码 |
| `query-meal-detail` | 核对套餐组成和可替换选项 |
| `available-coupons` | 查看当前可领取的优惠信息，不执行领取 |
| `query-my-coupons` | 读取用户已有券 |
| `query-store-coupons` | 核对所选门店可用券 |
| `calculate-price` | 按官方 Schema 对具体购物组合进行核价 |
| `list-nutrition-foods` | 有需要时提供来源清楚的餐品信息参考 |

建议的只读调用顺序：

1. `initialize` → 初始化通知 → `tools/list`，检查工具是否存在、参数是否符合 Schema。
2. 确认用户期望的餐品、份数、用餐方式、门店和预算。
3. 读取门店菜单、套餐详情与可用券；任何关键字段缺失时补充查询。
4. 构造明确的候选购物组合，不猜商品 ID、价格、券叠加规则或套餐替换规则。
5. 把相同需求下的基准与候选分别交给 `calculate-price`，以官方应付金额比较。
6. 输出选购内容、额外餐品、核价时间和来源；失败或缺项时明确显示未核价。

价格字段的单位和含义也应以实际返回定义为准，不把未知数字自动当作“元”，不从券标题解析折扣后冒充官方报价。

## 两条数据通道

### 演示优化器

演示模式使用仓库内的构造样例，执行受限范围内的精确组合搜索。它演示需求约束、额外餐品开关、基准解释、小票和分摊的完整交互。样例不代表当前门店菜单或官方促销。

### 官方只读入口与核价比较

服务端客户端支持发现工具、读取快照和依据真实 Schema 调用允许的工具。Web 查看器展示返回结果；Agent Skill 负责按用户需求组织调用，并保留核价的出处。

真实核价桥接器接收一个基准和一至五个候选。每项携带已经按实际 Schema 构造的 `calculate-price` 参数；请求顶层声明真实返回中的金额路径数组 `totalPath` 和单位 `yuan` 或 `fen`。桥接器顺序调用官方核价、读取 `structuredContent` 或文本中的 JSON，按核实的金额排序，并相对用户声明的基准计算差额。

如果响应不可解析、金额字段不存在、单位不合法或调用失败，流程明确报错，**不会回退到演示价格后继续声称是实时结果**。原始证据用于当前调用的核对，不能当作已脱敏的公开日志。

方案描述、额外餐品数量和“同样满足原始需求”由调用方提供，桥接器不会从价格结果自动证明餐品等价。比较前应确认基准与候选为同一门店、渠道和适用时段。核价不锁定库存或结算价格。

示例操作：

1. 保留 `examples/quote-request.template.json` 原模板，新建一个不提交到仓库的本地副本。
2. 运行 `npm run mcp:check`，用返回的 Schema 和只读查询结果填写每个候选的真实调用参数。
3. 根据实际官方返回确认 `totalPath` 与金额单位；模板中的占位值不是可直接使用的产品编码或字段路径。
4. 运行：

```sh
npm run mcp:quote -- --input /absolute/path/to/your-quote-request.json
```

Web 服务提供同一比较能力：向 `/api/mcp` 发送 POST JSON，提交 `action: "compare"`，`request` 使用与模板相同的核价请求结构。该接口同样需要认证，不允许浏览器传入 Token。

需要保留最小化工具发现证据时，可执行 `npm run mcp:check -- --evidence <path>`。该证据记录实际状态，不把仅发现工具等同于业务调用成功；普通命令输出可能包含账号相关返回，不应直接公开。

**当前没有通用的“任意 MCP 返回 → 优化器商品模型”自动适配器。** 任意门店菜单与优惠不能直接、静默地混入样例求解。后续如增加自动适配，应逐字段确认商品编码、套餐组成、价格单位、适用条件与库存，并继续使用官方核价。

## 调用边界

客户端实行只读工具允许列表；未列入允许列表的工具不能通过通用调用入口执行。项目不开放创建订单、支付、扣积分、抽奖、领券、地址写入或主题活动下单工具。发现工具可显示官方能力，但不代表本项目授予调用权限。

Agent Skill 使用的是 MCP 客户端环境中用户自己的凭证；Web 服务使用部署者服务端配置的凭证。二者不能假定为同一个账号。共享部署应保持所有者访问控制；需要多用户服务时，应先实现用户与各自凭证的隔离。

## 真实联调的完成标准

在持有个人 Token 的环境执行 `npm run mcp:check`，再完成一次只读查询与一次适用的 `calculate-price` 调用。记录工具名、时间、脱敏参数结构、成功或失败状态和返回字段含义。发布证据前移除 Token、手机号、地址、账户标识及可识别订单信息。

官方是否认可“真实使用”由主办方核验。

## 真实联调记录（2026-10-20）

均通过本仓库 CLI 与官方 `https://mcp.mcd.cn` 完成，协议版本 `2025-06-18`。

| 步骤 | 工具 | 结果 |
| --- | --- | --- |
| 初始化与工具发现 | `initialize` / `tools/list` | 成功；官方返回 35 个工具，其中 16 个在本项目只读允许列表内 |
| 只读快照 | `now-time-info`、`query-my-coupons`、`available-coupons`、`campaign-calendar` | 4 个均成功（账户返回内容不公开） |
| 门店 | `query-nearby-stores`（`beType=1, searchType=2`，城市 + 关键词） | 成功，取得所选门店；门店标识未公开 |
| 菜单 | `query-meals`、`query-meal-detail` | 成功，取得单品、套餐编码及各 round 可选项 |
| 核价比较 | `calculate-price` × 3（经 `mcp-quote`） | 成功：单点 ¥46.00；三件套 ¥33.50（少付 ¥12.50，无多余餐品）；四件套 ¥57.00（多付 ¥11.00，多一份麦乐鸡） |

实测得到的接入要点（以当时 Schema 为准，后续仍应以 `tools/list` 为准）：

- `calculate-price` 的 `structuredContent.data.price` 为应付金额，单位**分**；因此核价请求使用 `"totalPath": ["data", "price"]`、`"unit": "fen"`。
- 套餐与带规格单品（如可乐）通过 `items[].roundList[]` 指定，`round` 为 `query-meal-detail` 返回的 round `id` 字符串（如 `"1"`），`comboItemList[].code` 为所选子项编码。
- 到店自取（`orderType=1, beType=1`）不传 `beCode`。
- 菜单列表的 `currentPrice` 可能是带条件的展示价（实测四件套列表 ¥28、官方核价 ¥57），不能替代 `calculate-price`。

公开证据：[mcp-check-2026-10-20.json](docs/evidence/mcp-check-2026-10-20.json)（仅调用元数据）与 [quote-comparison-2026-10-20.json](docs/evidence/quote-comparison-2026-10-20.json)（核价请求结构与官方金额，门店编码已省略）。
