<!-- Machine-assisted translation (2026-10-14), awaiting native-speaker review. Terms: lang/glossary.md -->

---
locale: id
title: "Zekra — Memori jangka panjang untuk agen AI lewat MCP"
description: "Organ memori untuk agen AI. Recall jangka panjang dan graf entitas yang bisa dijangkau agen mana pun lewat MCP — sehingga apa yang dipelajari satu sesi, sudah diketahui sesi berikutnya."
source: web/content/site/landing.en.json
---

# Zekra

_MEMORI UNTUK AGEN AI · LEWAT MCP_

Organ memori untuk agen AI. Recall jangka panjang dan graf entitas yang bisa dijangkau agen mana pun lewat MCP — sehingga apa yang dipelajari satu sesi, sudah diketahui sesi berikutnya.

[Buka aplikasi](https://app.zekra.dev) · [Baca dokumentasi](@docs)

- MCP jarak jauh di mcp.zekra.dev
- Masuk dengan OAuth untuk Claude.ai dan ChatGPT
- Postgres · VectorChord · BM25
- Catatan yang dibagikan antara Anda dan agen Anda
- Satu CLI untuk Claude Code, Codex, Gemini, Cursor
- Konsol di app.zekra.dev

## Fitur

### Recall hibrida, bukan sekadar vektor

Kemiripan vektor dan BM25 digabungkan dengan reciprocal rank, lalu diberi peringkat ulang. Nama atau frasa persis ditemukan oleh separuh pencarian yang jago soal nama.

### Panas dan dingin, seperti otak

Tier panas ala hipokampus menjawab dengan cepat; tier dingin ala korteks menyimpan semuanya. Konsolidasi berbasis salience memindahkan hal yang penting di antara keduanya saat Anda tidak melihat.

### Rekonsolidasi saat recall

Mengingat sesuatu mengubahnya — recall memperkuat memori dan memungkinkannya dikoreksi, bukan membiarkan fakta usang terus diambil selamanya.

### Klien apa pun, satu protokol

Claude Code dan Desktop, Codex, Gemini CLI, dan Cursor terhubung lewat CLI zekra. Claude.ai dan ChatGPT terhubung ke server jarak jauh di mcp.zekra.dev dan masuk dengan OAuth — tanpa biner lokal.

### Setiap memori adalah catatan

Apa yang disimpan agen adalah catatan yang bisa Anda baca, beri tag, tautkan, dan ubah di konsol — dan setiap catatan adalah simpul dalam graf entitas brain.

### Brain terbatas dan brankas rahasia

Setiap brain diberi akses per agen dan per orang, dengan token terbatas. Kredensial yang ditempel ke dalam memori dipindahkan ke brankas terenkripsi, bukan disimpan sebagai teks.

## Ubah pengetahuan tim Anda menjadi deck, laporan, dan halaman — dalam bahasa Arab dan Inggris

_UNTUK TIM ANDA_

Memori yang dibangun agen Anda juga milik tim Anda. Presentasi Zekra dimulai dari sebuah catatan, kueri recall, atau seluruh brain, lalu menyusun deck, laporan, atau landing page yang siap untuk pelanggan dari apa yang benar-benar ada di brain.

### Dari catatan dan brain

Pilih catatan, kueri, atau brain; draf dibuat dari memori tersebut, bukan dari halaman kosong.

### Deck, laporan, atau halaman

Satu sumber, tiga bentuk: slide untuk dipresentasikan, laporan untuk dikirim, halaman untuk dipublikasikan.

### Arab dan Inggris

Teks Arab dari kanan ke kiri ditata dengan benar, bukan sekadar dicerminkan.

### PDF dan Word

Ekspor deck atau laporan sebagai PDF atau dokumen Word yang bisa diedit.

### Tautan berbagi privat

Bagikan ke pelanggan lewat tautan; tautan itulah satu-satunya kunci, dan Anda bisa mencabutnya.

### Dimiliki oleh brain

Presentasi tersimpan bersama brain asalnya, dengan hak akses yang sama.

## Mulai

1. Instal CLI

   `curl -fsSL https://app.zekra.dev/install.sh | sh`

2. Masuk dengan token dari konsol

   `zekra auth login --token cbt_...`

3. Hubungkan Zekra ke klien Anda

   `zekra mcp:install claude-code --brain my-project`

4. Atau tambahkan ke Claude.ai atau ChatGPT

   `https://mcp.zekra.dev`

## Mengapa Zekra?

Empat cara agen bisa mengetahui sesuatu, dari yang paling singkat hingga paling lama.

## Status

Aktif. Konsol berjalan di app.zekra.dev dan server MCP jarak jauh di mcp.zekra.dev, di atas Postgres dengan VectorChord dan BM25, embedding dan reranking lewat TEI — retain, recall, catatan, dan graf entitas digunakan setiap hari.

## Beri agen Anda sebuah memori.

Buka konsol untuk membuat brain, buat token terbatas, dan hubungkan Claude Code, Cursor, Claude.ai, ChatGPT, atau klien MCP apa pun.

[Buka aplikasi](https://app.zekra.dev) · [Beri bintang di GitHub](https://github.com/fadymondy/zekra)
