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

## 快速开始

需要 Node.js 22.13 或更高，以及一个能用 Grok Bot 的 Cursor 账号。

```bash
npx -y github:hanyu1212/grokbot-bridge-mcp setup
```

它会依次：

1. 没登录 Cursor 就打开浏览器授权
2. 问你 Bot 的名字（默认 `Grok Bot`）
3. 在 `~/.config/grokbot-bridge/app` 装一份固定副本，之后客户端启动只要一两秒
4. 找到本机装的 Cursor、Codex、Claude Code，逐个问你要不要配上（改配置前先备份）
5. 发一条测试消息确认连通

完成后重启客户端，说“让 Grok Bot ……”就行。想升级到最新版，重新跑一次这条命令。

## 提供的工具

| 工具 | 作用 |
| --- | --- |
| `grokbot_ask` | 发一条消息并等回复。`wait_seconds: 0` 表示发出去就返回，稍后再查 |
| `grokbot_check` | 读取上次之后的新回复（`ask` 返回 `status: "running"` 时用） |
| `grokbot_interrupt` | 停掉 Bot 当前这一轮，对话和记忆保留 |
| `grokbot_list` | 列出允许联系和已联系过的 Bot，不发消息 |

回复原样返回，中间不经过任何额外模型。

## 手动安装

不想用 `setup` 时：

```bash
npx @cursor/bdk login                                  # 登录 Cursor，或者设置环境变量 CURSOR_API_KEY
npm install -g github:hanyu1212/grokbot-bridge-mcp     # 装好后有 grokbot-bridge-mcp 命令
```

再按客户端加配置。`GROKBOT_AGENTS` 填 Bot 的名字，必须和 Grok Bot 应用里显示的**完全一致**，多个用英文逗号分隔。不在名单里的名字会被拒绝；但名单里的名字如果拼错了，第一次联系时会新建一个空 Bot，返回结果里会带 `created: true`。

### Cursor

编辑 `~/.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "grokbot": {
      "command": "grokbot-bridge-mcp",
      "env": { "GROKBOT_AGENTS": "Grok Bot" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add grokbot --scope user -e GROKBOT_AGENTS="Grok Bot" -- grokbot-bridge-mcp
```

### Codex

编辑 `~/.codex/config.toml`：

```toml
[mcp_servers.grokbot]
command = "grokbot-bridge-mcp"
startup_timeout_sec = 90
tool_timeout_sec = 660

[mcp_servers.grokbot.env]
GROKBOT_AGENTS = "Grok Bot"
```

几点说明：

- `tool_timeout_sec` 要大于 `wait_seconds` 的上限（600 秒），否则长任务会被 Codex 先掐断。
- `grokbot_ask` 和 `grokbot_interrupt` 会给 Bot 发消息，Codex 默认每次弹窗确认；`grokbot_list` 和 `grokbot_check` 标成了只读。想免确认，在配置里加 `default_tools_approval_mode = "approve"`。
- Codex 要模型自己去搜 MCP 工具，技能装得多时，“问问 Grok Bot”可能被派去别的技能。在 `~/.codex/AGENTS.md` 里加一句“提到 Grok Bot 就用 grokbot 的工具”会稳很多，`setup` 会问你要不要加。
- Codex 桌面版自带的命令行在 `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`，也可以用 `codex mcp add` 添加，加完再手动补上两行超时。

不要在配置里写 `npx -y github:...` 直接启动：每次都要从 GitHub 重新拉代码，要等半分钟以上，Codex 会因为太慢跳过这个工具。其他客户端的写法见 [examples/](examples/)。

### 可选：装上 skill

不装也能用：什么时候派活、消息怎么写、长任务先发再查，这些规则已经通过 MCP 的服务说明和工具描述交给了 Agent，“这一轮里做完”也由代码自动补在每条消息末尾。

[skill/SKILL.md](skill/SKILL.md) 是更详细的版本，适合想按自己的习惯定分工的人。复制到客户端的 skill 目录即可，比如 Cursor 的 `~/.cursor/skills/grokbot-dispatch/SKILL.md`，然后按自己的习惯改分工部分。

## 命令行

全局安装后也有一个命令行工具，不用 MCP 也能直接调：

```bash
export GROKBOT_AGENTS="Grok Bot"
grokbot-bridge ask "把今天的 AI 新闻整理成 5 条摘要" --wait 120
grokbot-bridge check
grokbot-bridge list
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
- 不碰 GitHub 凭据：BDK 启动时默认会找 GitHub 凭据（环境变量和 `gh auth token`），给它的 GitHub 功能用。本项目用不到，所以会在启动 BDK 前去掉这些环境变量，并屏蔽 `gh`。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `GROKBOT_AGENTS` | 必填。允许联系的 Bot 名字，逗号分隔 |
| `CURSOR_API_KEY` | 可选。不想用 `bdk login` 时使用 |
| `GROKBOT_BRIDGE_STATE_DIR` | 可选。状态目录，默认 `~/.config/grokbot-bridge` |
| `GROKBOT_FINISH_IN_TURN` | 可选。默认在每条消息末尾自动加一句“在这一轮里做完再结束”，因为 Grok Bot 一轮结束后不会自己醒来补发结果。设为 `0` 关闭 |

## 开发

```bash
npm install
npm test                                        # 单元测试
GROKBOT_E2E=1 GROKBOT_AGENTS="Grok Bot" npm test # 加上真实接口的端到端测试
```

## 许可证

[MIT](LICENSE)
