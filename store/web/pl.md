<!-- Machine-assisted translation (2026-10-14), awaiting native-speaker review. Terms: lang/glossary.md -->

---
locale: pl
title: "Zekra — Pamięć długoterminowa dla agentów AI przez MCP"
description: "Pamięć dla agentów AI. Długoterminowe przywoływanie i graf encji, do których każdy agent sięga przez MCP — czego nauczyła się jedna sesja, następna już wie."
source: web/content/site/landing.en.json
---

# Zekra

_PAMIĘĆ DLA AGENTÓW AI · PRZEZ MCP_

Pamięć dla agentów AI. Długoterminowe przywoływanie i graf encji, do których każdy agent sięga przez MCP — czego nauczyła się jedna sesja, następna już wie.

[Otwórz aplikację](https://app.zekra.dev) · [Czytaj dokumentację](@docs)

- Zdalny MCP pod mcp.zekra.dev
- Logowanie OAuth dla Claude.ai i ChatGPT
- Postgres · VectorChord · BM25
- Notatki wspólne dla Ciebie i Twoich agentów
- Jedno CLI dla Claude Code, Codex, Gemini, Cursor
- Konsola pod app.zekra.dev

## Funkcje

### Hybrydowe przywoływanie, nie tylko wektory

Podobieństwo wektorowe i BM25 połączone rangą wzajemną, a potem ponownie uszeregowane. Nazwę albo dokładną frazę znajduje ta połowa wyszukiwania, która jest dobra w nazwach.

### Gorąca i zimna warstwa, jak w mózgu

Gorąca warstwa hipokampalna odpowiada szybko, zimna warstwa korowa przechowuje wszystko. Konsolidacja sterowana istotnością przenosi to, co ważne, między nimi, gdy nie patrzysz.

### Rekonsolidacja przy przywoływaniu

Przypominanie zmienia wspomnienie — przywołanie je wzmacnia i pozwala poprawić, zamiast zostawiać nieaktualny fakt do wyszukiwania w nieskończoność.

### Dowolny klient, jeden protokół

Claude Code i Desktop, Codex, Gemini CLI oraz Cursor łączą się przez CLI zekra. Claude.ai i ChatGPT łączą się ze zdalnym serwerem pod mcp.zekra.dev i logują przez OAuth — bez lokalnego programu.

### Każde wspomnienie to notatka

To, co zapamięta agent, jest notatką, którą możesz czytać, tagować, łączyć i edytować w konsoli — a każda notatka jest węzłem w grafie encji mózgu.

### Mózgi z ograniczonym dostępem i sejf na sekrety

Każdy mózg jest udostępniany osobno agentom i osobom, z tokenami o ograniczonym zakresie. Dane uwierzytelniające wklejone do wspomnienia trafiają do zaszyfrowanego sejfu zamiast być przechowywane jako tekst.

## Zamień wiedzę swojego zespołu w prezentacje, raporty i strony — po arabsku i angielsku

_DLA TWOJEGO ZESPOŁU_

Pamięć, którą budują Twoi agenci, jest też pamięcią zespołu. Prezentacje Zekra zaczynają od notatki, zapytania lub całego mózgu i tworzą gotowy dla klienta zestaw slajdów, raport lub stronę docelową na podstawie tego, co mózg naprawdę zawiera.

### Z notatek i mózgów

Wybierz notatki, zapytanie lub mózg; szkic powstaje z tych wspomnień, a nie z pustej kartki.

### Prezentacja, raport lub strona

Jedno źródło, trzy formy: slajdy do pokazania, raport do wysłania, strona do opublikowania.

### Arabski i angielski

Arabski pisany od prawej do lewej jest składany poprawnie, a nie odbijany jako dodatek na końcu.

### PDF i Word

Eksportuj prezentację lub raport jako PDF albo edytowalny dokument Word.

### Prywatne linki do udostępniania

Udostępnij klientowi link; link jest jedynym kluczem i możesz go odwołać.

### Należą do mózgu

Prezentacje żyją razem z mózgiem, z którego powstały, i podlegają tym samym uprawnieniom dostępu.

## Zacznij

1. Zainstaluj CLI

   `curl -fsSL https://app.zekra.dev/install.sh | sh`

2. Zaloguj się tokenem z konsoli

   `zekra auth login --token cbt_...`

3. Podłącz Zekra do swojego klienta

   `zekra mcp:install claude-code --brain my-project`

4. Albo dodaj ją do Claude.ai lub ChatGPT

   `https://mcp.zekra.dev`

## Dlaczego Zekra?

Cztery sposoby, w jakie agent może coś wiedzieć, od najkrócej do najdłużej trwającego.

## Status

Działa. Konsola działa pod app.zekra.dev, a zdalny serwer MCP pod mcp.zekra.dev, na Postgresie z VectorChord i BM25, a osadzanie i ponowne szeregowanie przez TEI — zapamiętywanie, przywoływanie, notatki i graf encji są używane codziennie.

## Daj swoim agentom pamięć.

Otwórz konsolę, aby utworzyć mózg, wygenerować token o ograniczonym zakresie i połączyć Claude Code, Cursor, Claude.ai, ChatGPT lub dowolnego klienta MCP.

[Otwórz aplikację](https://app.zekra.dev) · [Daj gwiazdkę na GitHubie](https://github.com/fadymondy/zekra)
