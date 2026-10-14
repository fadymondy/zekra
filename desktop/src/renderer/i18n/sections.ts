// Catalogs for the self-contained string tables that live next to their UI (the Quick
// Capture panel, Settings ▸ Services) rather than in the shared dictionary, so the light
// capture window does not load the full catalogs. English and Arabic stay inline in those
// files; the other languages are JSON here, one object per section (scripts/i18n/merge.mjs).
import type { LocaleId } from "../../shared/ipc";

import es from "./sections/es.json";
import fr from "./sections/fr.json";
import de from "./sections/de.json";
import ptBR from "./sections/pt-BR.json";
import it from "./sections/it.json";
import ru from "./sections/ru.json";
import tr from "./sections/tr.json";
import zhHans from "./sections/zh-Hans.json";
import ja from "./sections/ja.json";
import ko from "./sections/ko.json";
import hi from "./sections/hi.json";
import id from "./sections/id.json";
import nl from "./sections/nl.json";
import pl from "./sections/pl.json";
import vi from "./sections/vi.json";
import uk from "./sections/uk.json";

type Catalog = Record<string, Record<string, string> | undefined>;
const CATALOGS: Partial<Record<LocaleId, Catalog>> = {
  "es": es as Catalog,
  "fr": fr as Catalog,
  "de": de as Catalog,
  "pt-BR": ptBR as Catalog,
  "it": it as Catalog,
  "ru": ru as Catalog,
  "tr": tr as Catalog,
  "zh-Hans": zhHans as Catalog,
  "ja": ja as Catalog,
  "ko": ko as Catalog,
  "hi": hi as Catalog,
  "id": id as Catalog,
  "nl": nl as Catalog,
  "pl": pl as Catalog,
  "vi": vi as Catalog,
  "uk": uk as Catalog,
};

/** `section` strings for `locale`: the inline English or Arabic table, or the JSON catalog
 *  merged over English so a missing key still reads. */
export function sectionStrings<K extends string>(locale: LocaleId, section: string, en: Record<K, string>, ar: Record<K, string>): Record<K, string> {
  if (locale === "en") return en;
  if (locale === "ar") return ar;
  const sec = CATALOGS[locale]?.[section];
  return sec ? { ...en, ...(sec as Partial<Record<K, string>>) } : en;
}
