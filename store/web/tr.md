<!-- Machine-assisted translation (2026-10-14), awaiting native-speaker review. Terms: lang/glossary.md -->

---
locale: tr
title: "Zekra — MCP üzerinden yapay zekâ ajanları için uzun süreli hafıza"
description: "Yapay zekâ ajanları için bir hafıza organı. Her ajanın MCP üzerinden eriştiği uzun süreli hatırlama ve varlık grafı; böylece bir oturumda öğrenilen şeyi bir sonraki oturum zaten bilir."
source: web/content/site/landing.en.json
---

# Zekra

_YAPAY ZEKÂ AJANLARI İÇİN HAFIZA · MCP ÜZERİNDEN_

Yapay zekâ ajanları için bir hafıza organı. Her ajanın MCP üzerinden eriştiği uzun süreli hatırlama ve varlık grafı; böylece bir oturumda öğrenilen şeyi bir sonraki oturum zaten bilir.

[Uygulamayı aç](https://app.zekra.dev) · [Dokümanları oku](@docs)

- mcp.zekra.dev adresinde uzak MCP
- Claude.ai ve ChatGPT için OAuth ile giriş
- Postgres · VectorChord · BM25
- Sizin ve ajanlarınızın paylaştığı notlar
- Claude Code, Codex, Gemini, Cursor için tek CLI
- app.zekra.dev adresinde konsol

## Özellikler

### Hibrit hatırlama, sadece vektör değil

Vektör benzerliği ve BM25, karşılıklı sıra birleştirmesiyle harmanlanır, ardından yeniden sıralanır. Bir ad veya tam bir ifade, aramanın adlarda iyi olan yarısı tarafından bulunur.

### Beyin gibi sıcak ve soğuk

Hipokampus benzeri sıcak katman hızlı yanıt verir; korteks benzeri soğuk katman her şeyi saklar. Önem eşikli pekiştirme, önemli olanı siz bakmazken iki katman arasında taşır.

### Hatırlarken yeniden pekiştirme

Bir şeyi hatırlamak onu değiştirir: hatırlama bir hafızayı güçlendirir ve düzeltilmesine izin verir, eskimiş bir bilgiyi sonsuza dek geri getirmez.

### Her istemci, tek protokol

Claude Code ve Desktop, Codex, Gemini CLI ve Cursor zekra CLI ile bağlanır. Claude.ai ve ChatGPT, mcp.zekra.dev adresindeki uzak sunucuya bağlanır ve OAuth ile giriş yapar; yerel ikili dosya gerekmez.

### Her hafıza bir not

Bir ajanın sakladığı şey, konsolda okuyabileceğiniz, etiketleyebileceğiniz, bağlayabileceğiniz ve düzenleyebileceğiniz bir nottur. Her not da beynin varlık grafında bir düğümdür.

### Kapsamlı beyinler ve gizli bilgi kasası

Her beyin, kapsamlı belirteçlerle ajan ve kişi bazında yetkilendirilir. Hafızaya yapıştırılan bir kimlik bilgisi metin olarak saklanmaz, şifreli bir kasaya taşınır.

## Ekibinizin bildiklerini sunuma, rapora ve sayfaya dönüştürün: Arapça ve İngilizce

_EKİBİNİZ İÇİN_

Ajanlarınızın oluşturduğu hafıza aynı zamanda ekibinizindir. Zekra sunumları bir nottan, bir hatırlama sorgusundan veya bir beynin tamamından başlar ve beynin gerçekte bildiklerinden müşteriye hazır bir sunum, rapor veya açılış sayfası taslağı çıkarır.

### Notlardan ve beyinlerden

Notları, bir sorguyu veya bir beyni seçin; taslak boş sayfadan değil, bu hafızalardan oluşturulur.

### Sunum, rapor veya sayfa

Tek kaynak, üç biçim: sunulacak slaytlar, gönderilecek bir rapor, yayımlanacak bir sayfa.

### Arapça ve İngilizce

Sağdan sola yazılan Arapça sonradan akla gelmiş bir yansıtma olarak değil, doğru biçimde yerleştirilir.

### PDF ve Word

Sunumu veya raporu PDF ya da düzenlenebilir Word belgesi olarak dışa aktarın.

### Özel paylaşım bağlantıları

Müşteriyle bağlantı üzerinden paylaşın; anahtar yalnızca bağlantıdır ve istediğiniz zaman iptal edebilirsiniz.

### Beyne ait

Sunumlar geldikleri beyinle birlikte, aynı erişim yetkileri altında durur.

## Başlayın

1. CLI'yi kurun

   `curl -fsSL https://app.zekra.dev/install.sh | sh`

2. Konsoldan aldığınız belirteçle giriş yapın

   `zekra auth login --token cbt_...`

3. Zekra'yı istemcinize bağlayın

   `zekra mcp:install claude-code --brain my-project`

4. Ya da Claude.ai veya ChatGPT'ye ekleyin

   `https://mcp.zekra.dev`

## Neden Zekra?

Bir ajanın bir şeyi bilmesinin dört yolu, en kısa ömürlüden en uzun ömrülüye.

## Durum

Yayında. Konsol app.zekra.dev adresinde, uzak MCP sunucusu mcp.zekra.dev adresinde çalışıyor; Postgres üzerinde VectorChord ve BM25, gömme ve yeniden sıralama ise TEI ile yapılıyor. Kaydetme, hatırlama, notlar ve varlık grafı günlük kullanımda.

## Ajanlarınıza bir hafıza verin.

Konsolu açın, bir beyin oluşturun, kapsamlı bir belirteç üretin ve Claude Code, Cursor, Claude.ai, ChatGPT veya herhangi bir MCP istemcisini bağlayın.

[Uygulamayı aç](https://app.zekra.dev) · [GitHub'da yıldızla](https://github.com/fadymondy/zekra)
