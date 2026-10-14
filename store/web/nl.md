<!-- Machine-assisted translation (2026-10-14), awaiting native-speaker review. Terms: lang/glossary.md -->

---
locale: nl
title: "Zekra — Langetermijngeheugen voor AI-agents via MCP"
description: "Een geheugenorgaan voor AI-agents. Langetermijngeheugen en een entiteitsgraaf die elke agent via MCP bereikt, zodat wat de ene sessie leert, de volgende al weet."
source: web/content/site/landing.en.json
---

# Zekra

_GEHEUGEN VOOR AI-AGENTS · VIA MCP_

Een geheugenorgaan voor AI-agents. Langetermijngeheugen en een entiteitsgraaf die elke agent via MCP bereikt, zodat wat de ene sessie leert, de volgende al weet.

[Open de app](https://app.zekra.dev) · [Lees de documentatie](@docs)

- Remote MCP op mcp.zekra.dev
- Inloggen met OAuth voor Claude.ai en ChatGPT
- Postgres · VectorChord · BM25
- Notities die jij en je agents delen
- Eén CLI voor Claude Code, Codex, Gemini en Cursor
- Console op app.zekra.dev

## Functies

### Hybride ophalen, niet alleen vectoren

Vectorgelijkenis en BM25 worden samengevoegd met reciprocal rank en daarna opnieuw gerangschikt. Een naam of een exacte zin vindt de helft van de zoekactie die goed is in namen.

### Warm en koud, zoals een brein

Een hippocampale warme laag antwoordt snel; een corticale koude laag bewaart alles. Consolidatie op basis van belang verplaatst wat telt tussen beide, terwijl jij niet kijkt.

### Herconsolidatie bij ophalen

Iets onthouden verandert het. Ophalen versterkt een herinnering en laat haar corrigeren, in plaats van een verouderd feit eeuwig terug te geven.

### Elke client, één protocol

Claude Code en Desktop, Codex, Gemini CLI en Cursor koppelen via de zekra CLI. Claude.ai en ChatGPT koppelen met de remote server op mcp.zekra.dev en loggen in met OAuth, zonder lokaal programma.

### Elke herinnering is een notitie

Wat een agent onthoudt, is een notitie die je in de console kunt lezen, taggen, koppelen en bewerken. Elke notitie is ook een knooppunt in de entiteitsgraaf van het brein.

### Afgebakende breinen en een kluis voor geheimen

Elk brein wordt per agent en per persoon toegekend, met tokens met een beperkt bereik. Een inloggegeven dat je in een herinnering plakt, gaat naar een versleutelde kluis in plaats van als tekst te worden opgeslagen.

## Maak van wat je team weet presentaties, rapporten en pagina's, in het Arabisch en Engels

_VOOR JE TEAM_

Het geheugen dat je agents opbouwen is ook dat van je team. Zekra-presentaties beginnen bij een notitie, een zoekopdracht of een heel brein en schetsen een presentatie, rapport of landingspagina voor klanten op basis van wat het brein echt bevat.

### Van notities en breinen

Kies notities, een zoekopdracht of een brein. Het concept is gebouwd op die herinneringen, niet op een lege pagina.

### Presentatie, rapport of pagina

Eén bron, drie vormen: slides om te presenteren, een rapport om te versturen, een pagina om te publiceren.

### Arabisch en Engels

Arabisch van rechts naar links wordt goed opgemaakt en niet achteraf gespiegeld.

### PDF en Word

Exporteer een presentatie of rapport als PDF of als bewerkbaar Word-document.

### Privé deellinks

Deel met een klant via een link. De link is de enige sleutel en je kunt hem intrekken.

### Eigendom van het brein

Presentaties horen bij het brein waaruit ze komen, onder dezelfde toegangsrechten.

## Aan de slag

1. Installeer de CLI

   `curl -fsSL https://app.zekra.dev/install.sh | sh`

2. Log in met een token uit de console

   `zekra auth login --token cbt_...`

3. Koppel Zekra aan je client

   `zekra mcp:install claude-code --brain my-project`

4. Of voeg het toe aan Claude.ai of ChatGPT

   `https://mcp.zekra.dev`

## Waarom Zekra?

Vier manieren waarop een agent iets kan weten, van de kortste tot de langste levensduur.

## Status

Live. De console draait op app.zekra.dev en de remote MCP-server op mcp.zekra.dev, op Postgres met VectorChord en BM25, met embedding en reranking via TEI. Onthouden, ophalen, notities en de entiteitsgraaf worden dagelijks gebruikt.

## Geef je agents een geheugen.

Open de console om een brein te maken, een token met beperkt bereik uit te geven en Claude Code, Cursor, Claude.ai, ChatGPT of een andere MCP-client te koppelen.

[Open de app](https://app.zekra.dev) · [Geef een ster op GitHub](https://github.com/fadymondy/zekra)
