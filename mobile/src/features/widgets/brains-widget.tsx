import type { WidgetProps } from "./widgets-core";

// Non-iOS stand-in for brains-widget.ios.tsx (Metro picks the .ios file on
// iOS). Android widgets live in android-widgets.tsx; expo-widgets' iOS widget
// only exists on iOS, and @expo/ui/swift-ui must not load elsewhere.

export const IOS_WIDGET_NAME = "ZekraBrains";

export function updateIosWidget(_entries: { date: Date; props: WidgetProps }[]): void {}
