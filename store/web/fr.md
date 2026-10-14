<!-- Machine-assisted translation (2026-10-14), awaiting native-speaker review. Terms: lang/glossary.md -->

---
locale: fr
title: "Zekra — Mémoire longue durée pour agents IA via MCP"
description: "Un organe de mémoire pour les agents IA. Rappel à long terme et graphe d’entités accessibles à n’importe quel agent via MCP : ce qu’une session apprend, la suivante le sait déjà."
source: web/content/site/landing.en.json
---

# Zekra

_LA MÉMOIRE DES AGENTS IA · VIA MCP_

Un organe de mémoire pour les agents IA. Rappel à long terme et graphe d’entités accessibles à n’importe quel agent via MCP : ce qu’une session apprend, la suivante le sait déjà.

[Ouvrir l’app](https://app.zekra.dev) · [Lire la documentation](@docs)

- MCP distant sur mcp.zekra.dev
- Connexion OAuth pour Claude.ai et ChatGPT
- Postgres · VectorChord · BM25
- Des notes partagées entre vous et vos agents
- Une seule CLI pour Claude Code, Codex, Gemini, Cursor
- Console sur app.zekra.dev

## Fonctionnalités

### Rappel hybride, pas seulement vectoriel

Similarité vectorielle et BM25 fusionnées par rang réciproque, puis reclassées. Un nom ou une expression exacte est trouvé par la moitié de la recherche qui excelle sur les noms.

### Chaud et froid, comme un cerveau

Un niveau chaud de type hippocampe répond vite ; un niveau froid de type cortex garde tout. Une consolidation filtrée par saillance déplace l’essentiel de l’un à l’autre pendant que vous êtes ailleurs.

### Reconsolidation au rappel

Se souvenir d’une chose la transforme : le rappel renforce un souvenir et permet de le corriger, au lieu de laisser un fait périmé être retrouvé indéfiniment.

### N’importe quel client, un seul protocole

Claude Code et Desktop, Codex, Gemini CLI et Cursor se connectent via la CLI zekra. Claude.ai et ChatGPT se connectent au serveur distant mcp.zekra.dev et s’authentifient avec OAuth, sans binaire local.

### Chaque souvenir est une note

Ce qu’un agent retient est une note que vous pouvez lire, étiqueter, relier et modifier dans la console, et chaque note est un nœud du graphe d’entités du cerveau.

### Cerveaux cloisonnés et coffre de secrets

Chaque cerveau est accordé par agent et par personne, avec des jetons limités. Un identifiant collé dans un souvenir est déplacé dans un coffre chiffré au lieu d’être stocké en clair.

## Transformez ce que votre équipe sait en présentations, rapports et pages — en arabe et en français

_POUR VOTRE ÉQUIPE_

La mémoire que construisent vos agents est aussi celle de votre équipe. Les présentations Zekra partent d’une note, d’une requête de rappel ou d’un cerveau entier et rédigent un diaporama, un rapport ou une page d’atterrissage prêts pour vos clients, à partir de ce que le cerveau contient vraiment.

### À partir de notes et de cerveaux

Choisissez des notes, une requête ou un cerveau : le brouillon est construit à partir de ces souvenirs, pas d’une page blanche.

### Diaporama, rapport ou page

Une source, trois formes : des diapositives à présenter, un rapport à envoyer, une page à publier.

### Arabe et français

L’arabe, écrit de droite à gauche, est mis en page correctement, pas simplement inversé après coup.

### PDF et Word

Exportez un diaporama ou un rapport en PDF ou en document Word modifiable.

### Liens de partage privés

Partagez avec un client par lien ; le lien est la seule clé, et vous pouvez le révoquer.

### Appartient au cerveau

Les présentations vivent avec le cerveau dont elles viennent, sous les mêmes autorisations d’accès.

## Démarrer

1. Installer la CLI

   `curl -fsSL https://app.zekra.dev/install.sh | sh`

2. Se connecter avec un jeton de la console

   `zekra auth login --token cbt_...`

3. Brancher Zekra à votre client

   `zekra mcp:install claude-code --brain my-project`

4. Ou l’ajouter à Claude.ai ou ChatGPT

   `https://mcp.zekra.dev`

## Pourquoi Zekra ?

Quatre façons pour un agent de savoir quelque chose, de la plus éphémère à la plus durable.

## Statut

En production. La console tourne sur app.zekra.dev et le serveur MCP distant sur mcp.zekra.dev, avec Postgres, VectorChord et BM25, et des embeddings et un reclassement via TEI : retain, recall, les notes et le graphe d’entités sont utilisés tous les jours.

## Donnez une mémoire à vos agents.

Ouvrez la console pour créer un cerveau, générer un jeton limité et connecter Claude Code, Cursor, Claude.ai, ChatGPT ou n’importe quel client MCP.

[Ouvrir l’app](https://app.zekra.dev) · [Mettre une étoile sur GitHub](https://github.com/fadymondy/zekra)
