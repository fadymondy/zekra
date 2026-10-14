<!-- Machine-assisted translation (2026-10-14), awaiting native-speaker review. Terms: lang/glossary.md -->

---
locale: ko
title: "Zekra — MCP로 연결하는 AI 에이전트의 장기 기억"
description: "AI 에이전트를 위한 기억 기관. 어떤 에이전트든 MCP로 접근하는 장기 회상과 엔티티 그래프로, 한 세션에서 배운 것을 다음 세션이 이미 알고 있게 해요."
source: web/content/site/landing.en.json
---

# Zekra

_AI 에이전트를 위한 기억 · MCP 연결_

AI 에이전트를 위한 기억 기관. 어떤 에이전트든 MCP로 접근하는 장기 회상과 엔티티 그래프로, 한 세션에서 배운 것을 다음 세션이 이미 알고 있게 해요.

[앱 열기](https://app.zekra.dev) · [문서 읽기](@docs)

- mcp.zekra.dev의 원격 MCP
- Claude.ai와 ChatGPT용 OAuth 로그인
- Postgres · VectorChord · BM25
- 나와 에이전트가 함께 쓰는 노트
- Claude Code, Codex, Gemini, Cursor를 위한 CLI 하나
- app.zekra.dev의 콘솔

## 기능

### 벡터만이 아닌 하이브리드 회상

벡터 유사도와 BM25를 상호 순위 결합으로 합친 뒤 다시 순위를 매겨요. 이름이나 정확한 문구는 이름에 강한 쪽 검색이 찾아내요.

### 뇌처럼 핫과 콜드로

해마에 해당하는 핫 계층은 빠르게 답하고, 피질에 해당하는 콜드 계층은 모든 것을 보관해요. 중요도에 따른 통합이 보이지 않는 곳에서 중요한 내용을 두 계층 사이로 옮겨요.

### 떠올릴 때 다시 굳어지는 기억

무언가를 기억하면 그 기억은 달라져요. 회상은 기억을 강화하고 바로잡을 수 있게 해 주어, 낡은 사실이 영원히 되살아나는 일을 막아요.

### 어떤 클라이언트든, 하나의 프로토콜

Claude Code와 Desktop, Codex, Gemini CLI, Cursor는 zekra CLI로 연결해요. Claude.ai와 ChatGPT는 mcp.zekra.dev의 원격 서버에 연결하고 OAuth로 로그인하므로 로컬 바이너리가 필요 없어요.

### 모든 기억은 노트

에이전트가 기억한 내용은 콘솔에서 읽고, 태그를 달고, 연결하고, 편집할 수 있는 노트예요. 모든 노트는 브레인의 엔티티 그래프를 이루는 노드이기도 해요.

### 범위가 정해진 브레인과 비밀 보관함

브레인은 에이전트별, 사람별로 범위가 지정된 토큰으로 권한을 부여해요. 기억에 붙여 넣은 자격 증명은 텍스트로 저장되지 않고 암호화된 보관함으로 옮겨져요.

## 팀이 아는 것을 발표 자료, 보고서, 페이지로 만드세요 — 아랍어와 영어 지원

_팀을 위해_

에이전트가 쌓은 기억은 팀의 기억이기도 해요. Zekra 프레젠테이션은 노트, 회상 쿼리, 브레인 전체에서 시작해 브레인에 실제로 담긴 내용으로 고객에게 보낼 수 있는 발표 자료, 보고서, 랜딩 페이지 초안을 만들어요.

### 노트와 브레인에서 시작

노트, 쿼리, 브레인을 고르세요. 빈 페이지가 아니라 그 기억을 바탕으로 초안이 만들어져요.

### 발표 자료, 보고서, 페이지

하나의 원본, 세 가지 형태예요. 발표할 슬라이드, 보낼 보고서, 게시할 페이지로 만들어요.

### 아랍어와 영어

오른쪽에서 왼쪽으로 쓰는 아랍어도 뒤늦게 뒤집은 것이 아니라 제대로 배치돼요.

### PDF와 Word

발표 자료나 보고서를 PDF 또는 편집 가능한 Word 문서로 내보내세요.

### 비공개 공유 링크

링크로 고객과 공유하세요. 링크가 유일한 열쇠이며 언제든 해제할 수 있어요.

### 브레인 소속

프레젠테이션은 만들어진 브레인에 속하며 같은 접근 권한을 따라요.

## 시작하기

1. CLI 설치

   `curl -fsSL https://app.zekra.dev/install.sh | sh`

2. 콘솔에서 받은 토큰으로 로그인

   `zekra auth login --token cbt_...`

3. 사용하는 클라이언트에 Zekra 연결

   `zekra mcp:install claude-code --brain my-project`

4. 또는 Claude.ai나 ChatGPT에 추가

   `https://mcp.zekra.dev`

## 왜 Zekra인가요?

에이전트가 무언가를 알게 되는 네 가지 방식을, 가장 짧게 유지되는 것부터 가장 오래 유지되는 것까지 살펴봐요.

## 상태

운영 중이에요. 콘솔은 app.zekra.dev에서, 원격 MCP 서버는 mcp.zekra.dev에서 Postgres, VectorChord, BM25 위에서 실행되며 임베딩과 재순위는 TEI로 처리해요. 기억하기, 회상, 노트, 엔티티 그래프를 매일 사용하고 있어요.

## 에이전트에게 기억을 주세요.

콘솔을 열어 브레인을 만들고, 범위가 지정된 토큰을 발급해 Claude Code, Cursor, Claude.ai, ChatGPT 또는 모든 MCP 클라이언트를 연결하세요.

[앱 열기](https://app.zekra.dev) · [GitHub에서 별 달기](https://github.com/fadymondy/zekra)
