import type { DictKey } from "@/i18n/define";

import brains from "./brains";
import editor from "./editor";
import kit from "./kit";
import nav from "./nav";
import notes from "./notes";
import notify from "./notify";
import presentations from "./presentations";
import push from "./push";
import settings from "./settings";
import vault from "./vault";
import widgets from "./widgets";

// Each feature owns one dictionary file; they are merged over the base
// dictionary in src/lib/i18n.tsx.
export const FEATURE_DICTS = [kit, brains, notes, editor, presentations, vault, push, settings, nav, widgets, notify];

export type FeatureKey =
  | DictKey<typeof kit>
  | DictKey<typeof nav>
  | DictKey<typeof brains>
  | DictKey<typeof notes>
  | DictKey<typeof editor>
  | DictKey<typeof presentations>
  | DictKey<typeof vault>
  | DictKey<typeof push>
  | DictKey<typeof settings>
  | DictKey<typeof widgets>
  | DictKey<typeof notify>;
