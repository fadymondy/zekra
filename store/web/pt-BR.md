<!-- Machine-assisted translation (2026-10-14), awaiting native-speaker review. Terms: lang/glossary.md -->

---
locale: pt-BR
title: "Zekra — Memória de longo prazo para agentes de IA via MCP"
description: "Um órgão de memória para agentes de IA. Recordação de longo prazo e um grafo de entidades que qualquer agente acessa via MCP — o que uma sessão aprende, a próxima já sabe."
source: web/content/site/landing.en.json
---

# Zekra

_MEMÓRIA PARA AGENTES DE IA · VIA MCP_

Um órgão de memória para agentes de IA. Recordação de longo prazo e um grafo de entidades que qualquer agente acessa via MCP — o que uma sessão aprende, a próxima já sabe.

[Abrir o app](https://app.zekra.dev) · [Ler a documentação](@docs)

- MCP remoto em mcp.zekra.dev
- Login com OAuth para Claude.ai e ChatGPT
- Postgres · VectorChord · BM25
- Notas compartilhadas entre você e seus agentes
- Uma CLI para Claude Code, Codex, Gemini e Cursor
- Console em app.zekra.dev

## Recursos

### Recordação híbrida, não só vetores

Similaridade vetorial e BM25 combinadas por rank recíproco e depois reordenadas. Um nome ou uma frase exata é encontrado pela metade da busca que é boa com nomes.

### Quente e frio, como um cérebro

Uma camada quente, como o hipocampo, responde rápido; uma camada fria, como o córtex, guarda tudo. A consolidação guiada por relevância move o que importa entre elas enquanto você não está olhando.

### Reconsolidação ao recordar

Lembrar de algo muda a lembrança — recordar fortalece uma memória e permite corrigi-la, em vez de deixar um fato desatualizado sendo recuperado para sempre.

### Qualquer cliente, um só protocolo

Claude Code e Desktop, Codex, Gemini CLI e Cursor se conectam pela CLI zekra. Claude.ai e ChatGPT se conectam ao servidor remoto em mcp.zekra.dev e entram com OAuth — sem binário local.

### Toda memória é uma nota

O que um agente guarda é uma nota que você pode ler, etiquetar, vincular e editar no console — e cada nota é um nó no grafo de entidades do cérebro.

### Cérebros restritos e um cofre de segredos

Cada cérebro é concedido por agente e por pessoa, com tokens restritos. Uma credencial colada em uma memória vai para um cofre criptografado em vez de ser guardada como texto.

## Transforme o que sua equipe sabe em slides, relatórios e páginas — em árabe e inglês

_PARA SUA EQUIPE_

A memória que seus agentes constroem também é da sua equipe. As apresentações do Zekra partem de uma nota, de uma consulta de recordação ou de um cérebro inteiro e criam um rascunho de slides, relatório ou landing page pronto para o cliente com base no que o cérebro realmente contém.

### A partir de notas e cérebros

Escolha notas, uma consulta ou um cérebro; o rascunho é criado a partir dessas memórias, não de uma página em branco.

### Slides, relatório ou página

Uma fonte, três formatos: slides para apresentar, um relatório para enviar, uma página para publicar.

### Árabe e inglês

O árabe da direita para a esquerda é diagramado corretamente, não apenas espelhado como detalhe final.

### PDF e Word

Exporte slides ou relatórios como PDF ou como um documento Word editável.

### Links privados de compartilhamento

Compartilhe com um cliente por link; o link é a única chave e você pode revogá-lo.

### Pertencem ao cérebro

As apresentações ficam com o cérebro de onde vieram, sob as mesmas permissões de acesso.

## Primeiros passos

1. Instale a CLI

   `curl -fsSL https://app.zekra.dev/install.sh | sh`

2. Entre com um token do console

   `zekra auth login --token cbt_...`

3. Conecte o Zekra ao seu cliente

   `zekra mcp:install claude-code --brain my-project`

4. Ou adicione ao Claude.ai ou ao ChatGPT

   `https://mcp.zekra.dev`

## Por que o Zekra?

Quatro formas de um agente saber algo, da mais efêmera à mais duradoura.

## Status

No ar. O console funciona em app.zekra.dev e o servidor MCP remoto em mcp.zekra.dev, com Postgres, VectorChord e BM25, e embeddings e reranking via TEI — guardar, recordar, notas e o grafo de entidades já estão em uso diário.

## Dê uma memória aos seus agentes.

Abra o console para criar um cérebro, gerar um token restrito e conectar Claude Code, Cursor, Claude.ai, ChatGPT ou qualquer cliente MCP.

[Abrir o app](https://app.zekra.dev) · [Dar uma estrela no GitHub](https://github.com/fadymondy/zekra)
