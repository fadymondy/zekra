import { Check } from "lucide-react-native";
import { View } from "react-native";

import { ListItem } from "@/components/kit";
import { AppText } from "@/components/ui";
import { LANGUAGES, useI18n, type Locale } from "@/lib/i18n";
import { fonts, usePalette } from "@/theme";

/** The language switcher: a list of every shipped language (never a
 *  two-way toggle — more languages are coming), the current one checked. */
export function LanguageList() {
  const p = usePalette();
  const { locale, setLocale } = useI18n();
  return (
    <View accessibilityRole="radiogroup">
      {LANGUAGES.map((lang, i) => {
        const on = lang.code === locale;
        return (
          <ListItem
            key={lang.code}
            last={i === LANGUAGES.length - 1}
            padV={12}
            onPress={() => setLocale(lang.code as Locale)}
            trailing={on ? <Check size={18} color={p.gold} strokeWidth={2} /> : undefined}
          >
            <AppText
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              style={{
                // Each name in its own script and direction, whatever the UI language.
                fontFamily: lang.rtl ? "Lusail-Medium" : on ? fonts.medium : fonts.regular,
                fontSize: 16,
                color: on ? p.ink : p.body,
                writingDirection: lang.rtl ? "rtl" : "ltr",
                alignSelf: "flex-start",
              }}
            >
              {lang.name}
            </AppText>
            {lang.english !== lang.name ? (
              <AppText variant="meta" style={{ writingDirection: "ltr", alignSelf: "flex-start" }}>{lang.english}</AppText>
            ) : null}
          </ListItem>
        );
      })}
    </View>
  );
}
