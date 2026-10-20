# 许可、来源与第三方说明

## 原创代码

麦麦刚刚好新增的业务代码、界面文案、样例数据、脚本与原创文档按根目录 [LICENSE](../LICENSE) 中的 MIT 条款授权。该授权仅覆盖作者有权授权的原创贡献。

## 官方文件与商标

`CONTEST_DECLARATION.md` 来自麦当劳官方比赛仓库，为满足参赛材料要求原样保留，不主张其为本项目原创，也不以本项目 MIT 许可重新授权。

“麦当劳”“McDonald's”及相关商标的权利属于各自权利人。本项目名称、说明和接口集成不代表官方出品、认证或背书。官方 MCP 示例及文档的使用受其原有条款约束；本项目许可不扩大其授权范围。

声明原文见[官方比赛仓库](https://github.com/M-China/mcd-developer-innovation-challenge/blob/main/CONTEST_DECLARATION.md)；MCP 服务说明见[官方接入指南](https://github.com/M-China/mcd-mcp-server)。

## 第三方运行环境

本项目基于 React/Vinext Sites 脚手架继续开发，保留实际使用的构建和运行基础设施。相关文件及依赖不因新增项目 LICENSE 而改变其原有权利和许可；其中 Sites 插件许可保留于 `build/sites-vite-plugin.LICENSE`。

具体依赖和锁定版本见 `package.json` 与锁文件；其许可证以各自包内文件和上游仓库为准。`patches/` 中的安全修补适用于相应上游包，不改变上游包的许可证。

## 数据

演示中的商品价格、优惠条件和组合是用于验证交互与算法的构造样例，不是当前官方数据、真实会员记录或实时促销承诺。真实 MCP 结果属于其来源服务，发布截图或调用证据时应移除个人信息与凭证。
