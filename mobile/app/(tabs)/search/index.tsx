import { ClassicSearchScreen } from "@/features/search/classic-search";
import { NativeSearchScreen } from "@/features/search/native-search";
import { isLiquidGlass } from "@/lib/platform";

// Semantic search. iOS 26+: the native Liquid Glass search (bottom search
// field, live results). Android and older iOS: the house-style screen.
export default function SearchRoute() {
  return isLiquidGlass() ? <NativeSearchScreen /> : <ClassicSearchScreen />;
}
