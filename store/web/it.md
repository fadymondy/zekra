<!-- Machine-assisted translation (2026-10-14), awaiting native-speaker review. Terms: lang/glossary.md -->

---
locale: it
title: "Zekra — Memoria a lungo termine per gli agenti IA tramite MCP"
description: "Un organo di memoria per gli agenti IA. Richiamo a lungo termine e un grafo di entità che qualsiasi agente raggiunge tramite MCP, così quello che impara una sessione, la successiva lo sa già."
source: web/content/site/landing.en.json
---

# Zekra

_MEMORIA PER AGENTI IA · TRAMITE MCP_

Un organo di memoria per gli agenti IA. Richiamo a lungo termine e un grafo di entità che qualsiasi agente raggiunge tramite MCP, così quello che impara una sessione, la successiva lo sa già.

[Apri l'app](https://app.zekra.dev) · [Leggi la documentazione](@docs)

- MCP remoto su mcp.zekra.dev
- Accesso OAuth per Claude.ai e ChatGPT
- Postgres · VectorChord · BM25
- Note condivise tra te e i tuoi agenti
- Una sola CLI per Claude Code, Codex, Gemini, Cursor
- Console su app.zekra.dev

## Funzioni

### Richiamo ibrido, non solo vettori

Similarità vettoriale e BM25 fuse con il reciprocal rank, poi riordinate. Un nome o una frase esatta li trova la metà della ricerca che è brava con i nomi.

### Caldo e freddo, come un cervello

Un livello caldo ippocampale risponde in fretta; un livello freddo corticale conserva tutto. Un consolidamento guidato dalla salienza sposta ciò che conta dall'uno all'altro mentre non guardi.

### Riconsolidamento al richiamo

Ricordare qualcosa lo cambia: il richiamo rafforza una memoria e permette di correggerla, invece di lasciare un dato obsoleto da recuperare per sempre.

### Qualsiasi client, un solo protocollo

Claude Code e Desktop, Codex, Gemini CLI e Cursor si collegano tramite la CLI zekra. Claude.ai e ChatGPT si collegano al server remoto mcp.zekra.dev e accedono con OAuth, senza alcun binario locale.

### Ogni memoria è una nota

Ciò che un agente conserva è una nota che puoi leggere, etichettare, collegare e modificare nella console, e ogni nota è un nodo del grafo di entità del brain.

### Brain con ambito e un vault dei segreti

Ogni brain viene concesso per agente e per persona, con token limitati. Una credenziale incollata in una memoria viene spostata in un vault cifrato invece di essere salvata come testo.

## Trasforma ciò che sa il tuo team in deck, report e pagine, in arabo e in inglese

_PER IL TUO TEAM_

La memoria che i tuoi agenti costruiscono è anche quella del tuo team. Le presentazioni di Zekra partono da una nota, da una query di richiamo o da un intero brain e preparano la bozza di un deck, un report o una landing page pronti per il cliente, a partire da ciò che il brain contiene davvero.

### Da note e brain

Scegli le note, una query o un brain: la bozza nasce da quelle memorie, non da una pagina bianca.

### Deck, report o pagina

Una sola fonte, tre forme: slide da presentare, un report da inviare, una pagina da pubblicare.

### Arabo e inglese

L'arabo da destra a sinistra è impaginato come si deve, non specchiato a posteriori.

### PDF e Word

Esporta un deck o un report in PDF o come documento Word modificabile.

### Link di condivisione privati

Condividi con un cliente tramite link; il link è l'unica chiave e puoi revocarlo.

### Di proprietà del brain

Le presentazioni vivono insieme al brain da cui provengono, con le stesse concessioni di accesso.

## Inizia

1. Installa la CLI

   `curl -fsSL https://app.zekra.dev/install.sh | sh`

2. Accedi con un token dalla console

   `zekra auth login --token cbt_...`

3. Collega Zekra al tuo client

   `zekra mcp:install claude-code --brain my-project`

4. Oppure aggiungilo a Claude.ai o ChatGPT

   `https://mcp.zekra.dev`

## Perché Zekra?

Quattro modi in cui un agente può sapere qualcosa, dal più breve al più duraturo.

## Stato

Attivo. La console funziona su app.zekra.dev e il server MCP remoto su mcp.zekra.dev, su Postgres con VectorChord e BM25, con embedding e reranking tramite TEI: conservazione, richiamo, note e grafo di entità sono in uso ogni giorno.

## Dai una memoria ai tuoi agenti.

Apri la console per creare un brain, generare un token limitato e collegare Claude Code, Cursor, Claude.ai, ChatGPT o qualsiasi client MCP.

[Apri l'app](https://app.zekra.dev) · [Metti una stella su GitHub](https://github.com/fadymondy/zekra)
