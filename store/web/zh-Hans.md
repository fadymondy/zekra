<!-- Machine-assisted translation (2026-10-14), awaiting native-speaker review. Terms: lang/glossary.md -->

---
locale: zh-Hans
title: "Zekra — 通过 MCP 为 AI 智能体提供长期记忆"
description: "为 AI 智能体打造的记忆器官。长期回忆加实体图谱，任何智能体都能通过 MCP 使用：一次会话学到的，下一次会话已经知道。"
source: web/content/site/landing.en.json
---

# Zekra

_AI 智能体的记忆 · 基于 MCP_

为 AI 智能体打造的记忆器官。长期回忆加实体图谱，任何智能体都能通过 MCP 使用：一次会话学到的，下一次会话已经知道。

[打开应用](https://app.zekra.dev) · [阅读文档](@docs)

- 远程 MCP：mcp.zekra.dev
- 为 Claude.ai 和 ChatGPT 提供 OAuth 登录
- Postgres · VectorChord · BM25
- 你和智能体共享的笔记
- 一个 CLI，适用于 Claude Code、Codex、Gemini、Cursor
- 控制台：app.zekra.dev

## 功能

### 混合回忆，而不只是向量

向量相似度与 BM25 通过倒数排名融合，再重新排序。名称或精确短语，由擅长匹配名称的那一半搜索找到。

### 冷热分层，就像大脑

海马体式的热层负责快速响应，皮层式的冷层保存一切。基于显著性的巩固机制会在你不留意时，把重要的内容在两层之间转移。

### 回忆时再巩固

记起一件事就会改变它：回忆会强化记忆，并允许修正，而不是让过时的事实被反复检索出来。

### 任何客户端，一种协议

Claude Code 和 Desktop、Codex、Gemini CLI 以及 Cursor 通过 zekra CLI 连接。Claude.ai 和 ChatGPT 连接到 mcp.zekra.dev 的远程服务器，并通过 OAuth 登录，无需本地程序。

### 每条记忆都是一条笔记

智能体记住的内容就是一条笔记，你可以在控制台中阅读、打标签、链接和编辑，而且每条笔记都是大脑实体图谱中的一个节点。

### 受限的大脑与密钥保险库

每个大脑可按智能体、按个人授权，并使用限定范围的令牌。粘贴进记忆的凭据会转入加密的保险库，而不是以文本形式存储。

## 把团队所知变成幻灯片、报告和页面，支持阿拉伯语和英语

_面向你的团队_

智能体构建的记忆，也是你团队的记忆。Zekra 演示文稿可以从一条笔记、一次回忆查询或整个大脑出发，根据大脑里真正存有的内容，起草面向客户的幻灯片、报告或落地页。

### 来自笔记和大脑

选择笔记、查询或大脑，草稿由这些记忆生成，而不是从空白页开始。

### 幻灯片、报告或页面

同一份来源，三种形态：用于演示的幻灯片，用于发送的报告，用于发布的页面。

### 阿拉伯语和英语

从右到左的阿拉伯语会被正确排版，而不是事后镜像了事。

### PDF 和 Word

把幻灯片或报告导出为 PDF，或可编辑的 Word 文档。

### 私密分享链接

通过链接分享给客户；链接就是唯一的钥匙，你随时可以撤销。

### 归属于大脑

演示文稿与其来源的大脑放在一起，遵循相同的访问授权。

## 开始使用

1. 安装 CLI

   `curl -fsSL https://app.zekra.dev/install.sh | sh`

2. 使用控制台中的令牌登录

   `zekra auth login --token cbt_...`

3. 把 Zekra 接入你的客户端

   `zekra mcp:install claude-code --brain my-project`

4. 或者把它添加到 Claude.ai 或 ChatGPT

   `https://mcp.zekra.dev`

## 为什么选择 Zekra？

智能体了解一件事有四种方式，从最短暂到最持久。

## 状态

已上线。控制台运行在 app.zekra.dev，远程 MCP 服务器运行在 mcp.zekra.dev，基于 Postgres、VectorChord 和 BM25，嵌入与重排序通过 TEI 完成：记住、回忆、笔记和实体图谱都已在日常使用。

## 给你的智能体一份记忆。

打开控制台创建大脑、生成限定范围的令牌，然后连接 Claude Code、Cursor、Claude.ai、ChatGPT 或任何 MCP 客户端。

[打开应用](https://app.zekra.dev) · [在 GitHub 上加星](https://github.com/fadymondy/zekra)
