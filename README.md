# grokbot-bridge-mcp

[English](README.en.md)

> **非官方项目。** 与 Cursor、Anysphere、xAI 均无关联。它依赖 `@cursor/bdk` 里的 Grok Bot 扩展，背后的接口随时可能变化。

让 Cursor、Claude Code、Codex 等任意 MCP 客户端，直接给你的 **Grok Bot** 派活、查进度、叫停。

本地的活留在编辑器里做；远程、长时间、需要登录态网页、定时执行的活，一句话交给 Grok Bot 在它的云电脑上跑，不用在两个应用之间来回切。

```text
你：让 Grok Bot 打开后台导出本周订单，存到 /workspace/orders，告诉我总数
Agent ──grokbot_ask──▶ Grok Bot（云电脑上执行）
Agent ◀──── 回复 ────── "已导出 312 单，文件在 /workspace/orders/2026-W42.csv"
```

## 提供的工具

| 工具 | 作用 |
| --- | --- |
| `grokbot_ask` | 发一条消息并等回复。`wait_seconds: 0` 表示发出去就返回，稍后再查 |
| `grokbot_check` | 读取上次之后的新回复（`ask` 返回 `status: "running"` 时用） |
| `grokbot_interrupt` | 停掉 Bot 当前这一轮，对话和记忆保留 |
| `grokbot_list` | 列出允许联系和已联系过的 Bot，不发消息 |

回复原样返回，中间不经过任何额外模型。

## 前置条件

- Node.js 22.13 或更高
- 一个能用 Grok Bot 的 Cursor 账号
- Cursor 凭据，二选一：
  - 运行一次 `npx @cursor/bdk login`，在浏览器里授权
  - 或者设置环境变量 `CURSOR_API_KEY`

## 安装

`GROKBOT_AGENTS` 填 Bot 的名字，必须和 Grok Bot 应用里显示的**完全一致**，多个用英文逗号分隔。名字拼错会被拒绝，避免意外新建一个空 Bot。

### Cursor

编辑 `~/.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "grokbot": {
      "command": "npx",
      "args": ["-y", "grokbot-bridge-mcp"],
      "env": { "GROKBOT_AGENTS": "Grok Bot" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add grokbot -e GROKBOT_AGENTS="Grok Bot" -- npx -y grokbot-bridge-mcp
```

### Codex

编辑 `~/.codex/config.toml`：

```toml
[mcp_servers.grokbot]
command = "npx"
args = ["-y", "grokbot-bridge-mcp"]
env = { GROKBOT_AGENTS = "Grok Bot" }
```

其他客户端的写法见 [examples/](examples/)。

### 可选：装上 skill

[skill/SKILL.md](skill/SKILL.md) 教 Agent 什么时候该交给 Grok Bot、消息怎么写才完整、长任务怎么处理。复制到客户端的 skill 目录即可，比如 Cursor 的 `~/.cursor/skills/grokbot-dispatch/SKILL.md`，然后按自己的习惯改分工部分。

## 命令行

不用 MCP 也能直接调：

```bash
export GROKBOT_AGENTS="Grok Bot"
npx -p grokbot-bridge-mcp grokbot-bridge ask "把今天的 AI 新闻整理成 5 条摘要" --wait 120
npx -p grokbot-bridge-mcp grokbot-bridge check
npx -p grokbot-bridge-mcp grokbot-bridge list
```

## 工作原理

1. 启动时在本机回环地址上拉起一个 `bdk serve`，挂载 `@cursor/bdk` 官方的 `cursor-grokbot-agents` 扩展，端口随机，带随机 bearer token。
2. 每次工具调用都通过 serve 暴露的 `call_tool` 直接执行扩展里的工具，不跑模型。
3. 已读位置保存在 `~/.config/grokbot-bridge/serve/`，重启后 `check` 依然接得上。

本项目不包含、也不复制 `@cursor/bdk` 的代码，只把它当作依赖使用。`@cursor/bdk` 遵循 Cursor 自己的许可证和[服务条款](https://cursor.com/terms-of-service)。

## 安全建议

- **Grok Bot 能在外部真的执行操作**（发消息、点网页、改文件）。建议在 Grok Bot 里设好边界，比如“对外发送、付款、删除、发布之前先问我”。
- **把 Bot 的回复当作不可信内容。** 工具描述里已经提醒调用方 Agent 不要把回复当指令执行，你自己的规则里最好也写上。
- 如果你给 MCP 工具开了自动运行（免审批），就等于 Agent 可以不经确认地给 Bot 派活，请确认你接受这一点。
- 凭据只从 `CURSOR_API_KEY` 或 `bdk login` 读取，本项目不会打印或保存你的 key。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `GROKBOT_AGENTS` | 必填。允许联系的 Bot 名字，逗号分隔 |
| `CURSOR_API_KEY` | 可选。不想用 `bdk login` 时使用 |
| `GROKBOT_BRIDGE_STATE_DIR` | 可选。状态目录，默认 `~/.config/grokbot-bridge` |

## 开发

```bash
npm install
npm test                                        # 单元测试
GROKBOT_E2E=1 GROKBOT_AGENTS="Grok Bot" npm test # 加上真实接口的端到端测试
```

## 许可证

[MIT](LICENSE)
