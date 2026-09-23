import { NativeTabs } from "expo-router/unstable-native-tabs";

import { useI18n } from "@/lib/i18n";
import { fonts, useTheme } from "@/theme";

/**
 * The iOS 26+ tab bar (MH-360): the system UITabBarController with Liquid
 * Glass, via expo-router's native tabs — laid out like Apple Health: the main
 * group Brains · Account, and Search as the system search tab
 * (`role="search"`), which iOS draws as the separate round glass button at the
 * trailing edge. Selecting it shows the Search stack, whose native search
 * controller (headerSearchBarOptions in src/features/search/native-search.tsx)
 * iOS hosts as the Liquid Glass field at the bottom.
 *
 * Brains and Account are route groups with their own stacks, so the bar stays
 * on screen inside every internal page.
 * Older iOS / Android keep the house bar, ordered Brains · Search · Account.
 *
 * The bar follows the app's own theme and language: `colorScheme` pins the
 * glass to the chosen light/dark, and `direction` is a UIKit layout-direction
 * trait (not a transform — nothing is flipped), so the bar is RTL for Arabic
 * even before I18nManager's forceRTL takes effect on the next launch. Gold is
 * the selection colour, as in the house tab bar.
 */
export function LiquidGlassTabs() {
  const { t, isRtl } = useI18n();
  const { scheme, palette: p } = useTheme();
  return (
    <NativeTabs
      tintColor={p.gold}
      minimizeBehavior="onScrollDown"
      labelStyle={{ default: { fontFamily: fonts.regular }, selected: { fontFamily: fonts.medium } }}
      unstable_nativeProps={{ colorScheme: scheme, direction: isRtl ? "rtl" : "ltr" }}
    >
      <NativeTabs.Trigger name="(brains)" accessibilityLabel={t("nav.brains")}>
        <NativeTabs.Trigger.Icon sf={{ default: "brain", selected: "brain.fill" }} />
        <NativeTabs.Trigger.Label>{t("nav.brains")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(account)" accessibilityLabel={t("nav.account")}>
        <NativeTabs.Trigger.Icon sf={{ default: "person.crop.circle", selected: "person.crop.circle.fill" }} />
        <NativeTabs.Trigger.Label>{t("nav.account")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      {/* The system search item (UITabBarSystemItemSearch), pinned by iOS to
          the trailing edge as its own glass button. react-native-screens puts
          the explicit title/icon over the system ones, so the label follows
          the app language rather than the device's. */}
      <NativeTabs.Trigger name="search" role="search" accessibilityLabel={t("nav.search")}>
        <NativeTabs.Trigger.Icon sf="magnifyingglass" />
        <NativeTabs.Trigger.Label>{t("nav.search")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
