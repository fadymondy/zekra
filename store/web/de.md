<!-- Machine-assisted translation (2026-10-14), awaiting native-speaker review. Terms: lang/glossary.md -->

---
locale: de
title: "Zekra: Langzeitgedächtnis für KI-Agenten über MCP"
description: "Ein Gedächtnisorgan für KI-Agenten. Langzeit-Abruf und ein Entitätsgraph, den jeder Agent über MCP erreicht: Was eine Session lernt, weiß die nächste schon."
source: web/content/site/landing.en.json
---

# Zekra

_GEDÄCHTNIS FÜR KI-AGENTEN · ÜBER MCP_

Ein Gedächtnisorgan für KI-Agenten. Langzeit-Abruf und ein Entitätsgraph, den jeder Agent über MCP erreicht: Was eine Session lernt, weiß die nächste schon.

[App öffnen](https://app.zekra.dev) · [Doku lesen](@docs)

- Remote-MCP unter mcp.zekra.dev
- OAuth-Anmeldung für Claude.ai und ChatGPT
- Postgres · VectorChord · BM25
- Notizen, die du und deine Agenten teilen
- Eine CLI für Claude Code, Codex, Gemini, Cursor
- Konsole unter app.zekra.dev

## Funktionen

### Hybrider Abruf, nicht nur Vektoren

Vektorähnlichkeit und BM25, per Reciprocal Rank fusioniert und neu gerankt. Einen Namen oder eine exakte Wendung findet die Hälfte der Suche, die gut mit Namen umgehen kann.

### Heiß und kalt, wie ein Gehirn

Eine hippocampale heiße Ebene antwortet schnell; eine kortikale kalte Ebene bewahrt alles. Eine nach Relevanz gesteuerte Konsolidierung verschiebt Wichtiges zwischen ihnen, während du nicht hinsiehst.

### Rekonsolidierung beim Abruf

Erinnern verändert eine Erinnerung: Der Abruf stärkt sie und lässt sie korrigieren, statt einen veralteten Fakt für immer abzurufen.

### Jeder Client, ein Protokoll

Claude Code und Desktop, Codex, Gemini CLI und Cursor verbinden sich über die zekra-CLI. Claude.ai und ChatGPT verbinden sich mit dem Remote-Server unter mcp.zekra.dev und melden sich per OAuth an, ohne lokale Binärdatei.

### Jede Erinnerung ist eine Notiz

Was ein Agent speichert, ist eine Notiz, die du in der Konsole lesen, taggen, verknüpfen und bearbeiten kannst. Jede Notiz ist ein Knoten im Entitätsgraph des Brains.

### Eingeschränkte Brains und ein Secret-Vault

Jedes Brain wird pro Agent und pro Person freigegeben, mit eingeschränkten Tokens. Ein Zugangsdatum, das in eine Erinnerung eingefügt wird, wandert in einen verschlüsselten Vault, statt als Text gespeichert zu werden.

## Aus dem Wissen deines Teams Decks, Berichte und Seiten machen, auf Arabisch und Englisch

_FÜR DEIN TEAM_

Die Erinnerung, die deine Agenten aufbauen, gehört auch deinem Team. Zekra-Präsentationen starten mit einer Notiz, einer Abfrage oder einem ganzen Brain und entwerfen daraus ein kundenfertiges Deck, einen Bericht oder eine Landingpage, aus dem, was das Brain wirklich enthält.

### Aus Notizen und Brains

Wähle Notizen, eine Abfrage oder ein Brain; der Entwurf entsteht aus diesen Erinnerungen, nicht auf einer leeren Seite.

### Deck, Bericht oder Seite

Eine Quelle, drei Formen: Folien zum Präsentieren, ein Bericht zum Versenden, eine Seite zum Veröffentlichen.

### Arabisch und Englisch

Arabisch von rechts nach links wird sauber gesetzt, nicht nachträglich gespiegelt.

### PDF und Word

Exportiere ein Deck oder einen Bericht als PDF oder als bearbeitbares Word-Dokument.

### Private Freigabelinks

Teile mit einem Kunden per Link; der Link ist der einzige Schlüssel, und du kannst ihn widerrufen.

### Im Besitz des Brains

Präsentationen gehören zu dem Brain, aus dem sie stammen, mit denselben Zugriffsrechten.

## Loslegen

1. CLI installieren

   `curl -fsSL https://app.zekra.dev/install.sh | sh`

2. Mit einem Token aus der Konsole anmelden

   `zekra auth login --token cbt_...`

3. Zekra in deinen Client einbinden

   `zekra mcp:install claude-code --brain my-project`

4. Oder zu Claude.ai oder ChatGPT hinzufügen

   `https://mcp.zekra.dev`

## Warum Zekra?

Vier Wege, wie ein Agent etwas wissen kann, vom kurzlebigsten zum langlebigsten.

## Status

Live. Die Konsole läuft unter app.zekra.dev und der Remote-MCP-Server unter mcp.zekra.dev, auf Postgres mit VectorChord und BM25, Embedding und Reranking über TEI. Speichern, Abruf, Notizen und der Entitätsgraph sind im täglichen Einsatz.

## Gib deinen Agenten ein Gedächtnis.

Öffne die Konsole, um ein Brain zu erstellen, ein eingeschränktes Token auszustellen und Claude Code, Cursor, Claude.ai, ChatGPT oder einen beliebigen MCP-Client zu verbinden.

[App öffnen](https://app.zekra.dev) · [Auf GitHub merken](https://github.com/fadymondy/zekra)
