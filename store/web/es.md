<!-- Machine-assisted translation (2026-10-14), awaiting native-speaker review. Terms: lang/glossary.md -->

---
locale: es
title: "Zekra — Memoria a largo plazo para agentes de IA mediante MCP"
description: "Un órgano de memoria para agentes de IA. Recuerdo a largo plazo y un grafo de entidades al que cualquier agente accede mediante MCP, para que lo que aprende una sesión ya lo sepa la siguiente."
source: web/content/site/landing.en.json
---

# Zekra

_MEMORIA PARA AGENTES DE IA · MEDIANTE MCP_

Un órgano de memoria para agentes de IA. Recuerdo a largo plazo y un grafo de entidades al que cualquier agente accede mediante MCP, para que lo que aprende una sesión ya lo sepa la siguiente.

[Abrir la app](https://app.zekra.dev) · [Leer la documentación](@docs)

- MCP remoto en mcp.zekra.dev
- Inicio de sesión con OAuth para Claude.ai y ChatGPT
- Postgres · VectorChord · BM25
- Notas que compartes con tus agentes
- Una CLI para Claude Code, Codex, Gemini y Cursor
- Consola en app.zekra.dev

## Características

### Recuerdo híbrido, no solo vectores

Similitud vectorial y BM25 fusionadas por rango recíproco y luego reordenadas. Un nombre o una frase exacta los encuentra la mitad de la búsqueda que es buena con los nombres.

### Caliente y frío, como un cerebro

Un nivel caliente hipocampal responde rápido; un nivel frío cortical lo conserva todo. La consolidación por relevancia mueve lo importante entre ambos mientras no miras.

### Reconsolidación al recordar

Recordar algo lo cambia: al recordar, un recuerdo se refuerza y se puede corregir, en lugar de dejar un dato obsoleto para que se recupere eternamente.

### Cualquier cliente, un solo protocolo

Claude Code y Desktop, Codex, Gemini CLI y Cursor se conectan mediante la CLI de zekra. Claude.ai y ChatGPT se conectan al servidor remoto en mcp.zekra.dev e inician sesión con OAuth, sin binario local.

### Cada recuerdo es una nota

Lo que retiene un agente es una nota que puedes leer, etiquetar, enlazar y editar en la consola, y cada nota es un nodo del grafo de entidades del cerebro.

### Cerebros con alcance limitado y una bóveda de secretos

Cada cerebro se concede por agente y por persona, con tokens de alcance limitado. Una credencial pegada en un recuerdo pasa a una bóveda cifrada en lugar de guardarse como texto.

## Convierte lo que sabe tu equipo en presentaciones, informes y páginas, en árabe e inglés

_PARA TU EQUIPO_

La memoria que construyen tus agentes es también la de tu equipo. Las presentaciones de Zekra parten de una nota, una consulta de recuerdo o un cerebro entero y redactan una presentación, un informe o una página de destino listos para clientes con lo que el cerebro realmente contiene. Admiten contenido en árabe y en inglés.

### A partir de notas y cerebros

Elige notas, una consulta o un cerebro; el borrador se construye con esos recuerdos, no desde una página en blanco.

### Presentación, informe o página

Una sola fuente, tres formatos: diapositivas para presentar, un informe para enviar, una página para publicar.

### Árabe e inglés

El árabe de derecha a izquierda se maqueta como debe ser, no como un espejo improvisado.

### PDF y Word

Exporta una presentación o un informe como PDF o como documento de Word editable.

### Enlaces privados para compartir

Comparte con un cliente por enlace; el enlace es la única llave y puedes revocarlo.

### Pertenecen al cerebro

Las presentaciones viven con el cerebro del que proceden, bajo los mismos permisos de acceso.

## Empieza

1. Instala la CLI

   `curl -fsSL https://app.zekra.dev/install.sh | sh`

2. Inicia sesión con un token de la consola

   `zekra auth login --token cbt_...`

3. Conecta Zekra a tu cliente

   `zekra mcp:install claude-code --brain my-project`

4. O añádelo a Claude.ai o ChatGPT

   `https://mcp.zekra.dev`

## ¿Por qué Zekra?

Cuatro formas en que un agente puede saber algo, de la más efímera a la más duradera.

## Estado

En producción. La consola funciona en app.zekra.dev y el servidor MCP remoto en mcp.zekra.dev, sobre Postgres con VectorChord y BM25, con embeddings y reordenación mediante TEI. Retener, recordar, notas y el grafo de entidades se usan a diario.

## Dale memoria a tus agentes.

Abre la consola para crear un cerebro, generar un token de alcance limitado y conectar Claude Code, Cursor, Claude.ai, ChatGPT o cualquier cliente MCP.

[Abrir la app](https://app.zekra.dev) · [Danos una estrella en GitHub](https://github.com/fadymondy/zekra)
