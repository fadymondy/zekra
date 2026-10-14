// GENERATED list of dictionary areas — one lang/<area>.<locale>.json file per product area and
// language. Keys inside each file are flat and prefixed with the area ("brains.title"), so areas
// never collide. English and Arabic are bundled; the other languages load on demand (LOADERS)
// and fall back to English key by key.
import commonEn from "./common.en.json"
import commonAr from "./common.ar.json"
import shellEn from "./shell.en.json"
import shellAr from "./shell.ar.json"
import authEn from "./auth.en.json"
import authAr from "./auth.ar.json"
import accountEn from "./account.en.json"
import accountAr from "./account.ar.json"
import brainsEn from "./brains.en.json"
import brainsAr from "./brains.ar.json"
import overviewEn from "./overview.en.json"
import overviewAr from "./overview.ar.json"
import chatEn from "./chat.en.json"
import chatAr from "./chat.ar.json"
import searchEn from "./search.en.json"
import searchAr from "./search.ar.json"
import sourcesEn from "./sources.en.json"
import sourcesAr from "./sources.ar.json"
import sessionsEn from "./sessions.en.json"
import sessionsAr from "./sessions.ar.json"
import gapsEn from "./gaps.en.json"
import gapsAr from "./gaps.ar.json"
import activityEn from "./activity.en.json"
import activityAr from "./activity.ar.json"
import secretsEn from "./secrets.en.json"
import secretsAr from "./secrets.ar.json"
import permissionsEn from "./permissions.en.json"
import permissionsAr from "./permissions.ar.json"
import graphEn from "./graph.en.json"
import graphAr from "./graph.ar.json"
import adminEn from "./admin.en.json"
import adminAr from "./admin.ar.json"

import oauthEn from "./oauth.en.json"
import oauthAr from "./oauth.ar.json"
import brainSettingsEn from "./brainSettings.en.json"
import brainSettingsAr from "./brainSettings.ar.json"
import notesEn from "./notes.en.json"
import notesAr from "./notes.ar.json"
import appsEn from "./apps.en.json"
import appsAr from "./apps.ar.json"
import presentationsEn from "./presentations.en.json"
import presentationsAr from "./presentations.ar.json"
import notificationsEn from "./notifications.en.json"
import notificationsAr from "./notifications.ar.json"
import mediaEn from "./media.en.json"
import mediaAr from "./media.ar.json"

type Dict = Record<string, string>
export const EN: Dict = {
  ...oauthEn,
  ...brainSettingsEn,
  ...notesEn,
  ...appsEn,
  ...presentationsEn,
  ...notificationsEn,
  ...mediaEn,
  ...commonEn,
  ...shellEn,
  ...authEn,
  ...accountEn,
  ...brainsEn,
  ...overviewEn,
  ...chatEn,
  ...searchEn,
  ...sourcesEn,
  ...sessionsEn,
  ...gapsEn,
  ...activityEn,
  ...secretsEn,
  ...permissionsEn,
  ...graphEn,
  ...adminEn,
}
export const AR: Dict = {
  ...oauthAr,
  ...brainSettingsAr,
  ...notesAr,
  ...appsAr,
  ...presentationsAr,
  ...notificationsAr,
  ...mediaAr,
  ...commonAr,
  ...shellAr,
  ...authAr,
  ...accountAr,
  ...brainsAr,
  ...overviewAr,
  ...chatAr,
  ...searchAr,
  ...sourcesAr,
  ...sessionsAr,
  ...gapsAr,
  ...activityAr,
  ...secretsAr,
  ...permissionsAr,
  ...graphAr,
  ...adminAr,
}

type Module = { default: Dict }
const merge = (mods: Module[]): Dict => Object.assign({}, ...mods.map((m) => m.default))

/** The other languages, one chunk each, loaded when first used (lib/i18n-server.ts). */
export const LOADERS: Record<string, () => Promise<Dict>> = {
  "es": async () =>
    merge(
      await Promise.all([
        import("./common.es.json"),
        import("./shell.es.json"),
        import("./auth.es.json"),
        import("./account.es.json"),
        import("./brains.es.json"),
        import("./overview.es.json"),
        import("./chat.es.json"),
        import("./search.es.json"),
        import("./sources.es.json"),
        import("./sessions.es.json"),
        import("./gaps.es.json"),
        import("./activity.es.json"),
        import("./secrets.es.json"),
        import("./permissions.es.json"),
        import("./graph.es.json"),
        import("./admin.es.json"),
        import("./oauth.es.json"),
        import("./brainSettings.es.json"),
        import("./notes.es.json"),
        import("./apps.es.json"),
        import("./presentations.es.json"),
        import("./notifications.es.json"),
        import("./media.es.json"),
      ]),
    ),
  "fr": async () =>
    merge(
      await Promise.all([
        import("./common.fr.json"),
        import("./shell.fr.json"),
        import("./auth.fr.json"),
        import("./account.fr.json"),
        import("./brains.fr.json"),
        import("./overview.fr.json"),
        import("./chat.fr.json"),
        import("./search.fr.json"),
        import("./sources.fr.json"),
        import("./sessions.fr.json"),
        import("./gaps.fr.json"),
        import("./activity.fr.json"),
        import("./secrets.fr.json"),
        import("./permissions.fr.json"),
        import("./graph.fr.json"),
        import("./admin.fr.json"),
        import("./oauth.fr.json"),
        import("./brainSettings.fr.json"),
        import("./notes.fr.json"),
        import("./apps.fr.json"),
        import("./presentations.fr.json"),
        import("./notifications.fr.json"),
        import("./media.fr.json"),
      ]),
    ),
  "de": async () =>
    merge(
      await Promise.all([
        import("./common.de.json"),
        import("./shell.de.json"),
        import("./auth.de.json"),
        import("./account.de.json"),
        import("./brains.de.json"),
        import("./overview.de.json"),
        import("./chat.de.json"),
        import("./search.de.json"),
        import("./sources.de.json"),
        import("./sessions.de.json"),
        import("./gaps.de.json"),
        import("./activity.de.json"),
        import("./secrets.de.json"),
        import("./permissions.de.json"),
        import("./graph.de.json"),
        import("./admin.de.json"),
        import("./oauth.de.json"),
        import("./brainSettings.de.json"),
        import("./notes.de.json"),
        import("./apps.de.json"),
        import("./presentations.de.json"),
        import("./notifications.de.json"),
        import("./media.de.json"),
      ]),
    ),
  "pt-BR": async () =>
    merge(
      await Promise.all([
        import("./common.pt-BR.json"),
        import("./shell.pt-BR.json"),
        import("./auth.pt-BR.json"),
        import("./account.pt-BR.json"),
        import("./brains.pt-BR.json"),
        import("./overview.pt-BR.json"),
        import("./chat.pt-BR.json"),
        import("./search.pt-BR.json"),
        import("./sources.pt-BR.json"),
        import("./sessions.pt-BR.json"),
        import("./gaps.pt-BR.json"),
        import("./activity.pt-BR.json"),
        import("./secrets.pt-BR.json"),
        import("./permissions.pt-BR.json"),
        import("./graph.pt-BR.json"),
        import("./admin.pt-BR.json"),
        import("./oauth.pt-BR.json"),
        import("./brainSettings.pt-BR.json"),
        import("./notes.pt-BR.json"),
        import("./apps.pt-BR.json"),
        import("./presentations.pt-BR.json"),
        import("./notifications.pt-BR.json"),
        import("./media.pt-BR.json"),
      ]),
    ),
  "it": async () =>
    merge(
      await Promise.all([
        import("./common.it.json"),
        import("./shell.it.json"),
        import("./auth.it.json"),
        import("./account.it.json"),
        import("./brains.it.json"),
        import("./overview.it.json"),
        import("./chat.it.json"),
        import("./search.it.json"),
        import("./sources.it.json"),
        import("./sessions.it.json"),
        import("./gaps.it.json"),
        import("./activity.it.json"),
        import("./secrets.it.json"),
        import("./permissions.it.json"),
        import("./graph.it.json"),
        import("./admin.it.json"),
        import("./oauth.it.json"),
        import("./brainSettings.it.json"),
        import("./notes.it.json"),
        import("./apps.it.json"),
        import("./presentations.it.json"),
        import("./notifications.it.json"),
        import("./media.it.json"),
      ]),
    ),
  "ru": async () =>
    merge(
      await Promise.all([
        import("./common.ru.json"),
        import("./shell.ru.json"),
        import("./auth.ru.json"),
        import("./account.ru.json"),
        import("./brains.ru.json"),
        import("./overview.ru.json"),
        import("./chat.ru.json"),
        import("./search.ru.json"),
        import("./sources.ru.json"),
        import("./sessions.ru.json"),
        import("./gaps.ru.json"),
        import("./activity.ru.json"),
        import("./secrets.ru.json"),
        import("./permissions.ru.json"),
        import("./graph.ru.json"),
        import("./admin.ru.json"),
        import("./oauth.ru.json"),
        import("./brainSettings.ru.json"),
        import("./notes.ru.json"),
        import("./apps.ru.json"),
        import("./presentations.ru.json"),
        import("./notifications.ru.json"),
        import("./media.ru.json"),
      ]),
    ),
  "tr": async () =>
    merge(
      await Promise.all([
        import("./common.tr.json"),
        import("./shell.tr.json"),
        import("./auth.tr.json"),
        import("./account.tr.json"),
        import("./brains.tr.json"),
        import("./overview.tr.json"),
        import("./chat.tr.json"),
        import("./search.tr.json"),
        import("./sources.tr.json"),
        import("./sessions.tr.json"),
        import("./gaps.tr.json"),
        import("./activity.tr.json"),
        import("./secrets.tr.json"),
        import("./permissions.tr.json"),
        import("./graph.tr.json"),
        import("./admin.tr.json"),
        import("./oauth.tr.json"),
        import("./brainSettings.tr.json"),
        import("./notes.tr.json"),
        import("./apps.tr.json"),
        import("./presentations.tr.json"),
        import("./notifications.tr.json"),
        import("./media.tr.json"),
      ]),
    ),
  "zh-Hans": async () =>
    merge(
      await Promise.all([
        import("./common.zh-Hans.json"),
        import("./shell.zh-Hans.json"),
        import("./auth.zh-Hans.json"),
        import("./account.zh-Hans.json"),
        import("./brains.zh-Hans.json"),
        import("./overview.zh-Hans.json"),
        import("./chat.zh-Hans.json"),
        import("./search.zh-Hans.json"),
        import("./sources.zh-Hans.json"),
        import("./sessions.zh-Hans.json"),
        import("./gaps.zh-Hans.json"),
        import("./activity.zh-Hans.json"),
        import("./secrets.zh-Hans.json"),
        import("./permissions.zh-Hans.json"),
        import("./graph.zh-Hans.json"),
        import("./admin.zh-Hans.json"),
        import("./oauth.zh-Hans.json"),
        import("./brainSettings.zh-Hans.json"),
        import("./notes.zh-Hans.json"),
        import("./apps.zh-Hans.json"),
        import("./presentations.zh-Hans.json"),
        import("./notifications.zh-Hans.json"),
        import("./media.zh-Hans.json"),
      ]),
    ),
  "ja": async () =>
    merge(
      await Promise.all([
        import("./common.ja.json"),
        import("./shell.ja.json"),
        import("./auth.ja.json"),
        import("./account.ja.json"),
        import("./brains.ja.json"),
        import("./overview.ja.json"),
        import("./chat.ja.json"),
        import("./search.ja.json"),
        import("./sources.ja.json"),
        import("./sessions.ja.json"),
        import("./gaps.ja.json"),
        import("./activity.ja.json"),
        import("./secrets.ja.json"),
        import("./permissions.ja.json"),
        import("./graph.ja.json"),
        import("./admin.ja.json"),
        import("./oauth.ja.json"),
        import("./brainSettings.ja.json"),
        import("./notes.ja.json"),
        import("./apps.ja.json"),
        import("./presentations.ja.json"),
        import("./notifications.ja.json"),
        import("./media.ja.json"),
      ]),
    ),
  "ko": async () =>
    merge(
      await Promise.all([
        import("./common.ko.json"),
        import("./shell.ko.json"),
        import("./auth.ko.json"),
        import("./account.ko.json"),
        import("./brains.ko.json"),
        import("./overview.ko.json"),
        import("./chat.ko.json"),
        import("./search.ko.json"),
        import("./sources.ko.json"),
        import("./sessions.ko.json"),
        import("./gaps.ko.json"),
        import("./activity.ko.json"),
        import("./secrets.ko.json"),
        import("./permissions.ko.json"),
        import("./graph.ko.json"),
        import("./admin.ko.json"),
        import("./oauth.ko.json"),
        import("./brainSettings.ko.json"),
        import("./notes.ko.json"),
        import("./apps.ko.json"),
        import("./presentations.ko.json"),
        import("./notifications.ko.json"),
        import("./media.ko.json"),
      ]),
    ),
  "hi": async () =>
    merge(
      await Promise.all([
        import("./common.hi.json"),
        import("./shell.hi.json"),
        import("./auth.hi.json"),
        import("./account.hi.json"),
        import("./brains.hi.json"),
        import("./overview.hi.json"),
        import("./chat.hi.json"),
        import("./search.hi.json"),
        import("./sources.hi.json"),
        import("./sessions.hi.json"),
        import("./gaps.hi.json"),
        import("./activity.hi.json"),
        import("./secrets.hi.json"),
        import("./permissions.hi.json"),
        import("./graph.hi.json"),
        import("./admin.hi.json"),
        import("./oauth.hi.json"),
        import("./brainSettings.hi.json"),
        import("./notes.hi.json"),
        import("./apps.hi.json"),
        import("./presentations.hi.json"),
        import("./notifications.hi.json"),
        import("./media.hi.json"),
      ]),
    ),
  "id": async () =>
    merge(
      await Promise.all([
        import("./common.id.json"),
        import("./shell.id.json"),
        import("./auth.id.json"),
        import("./account.id.json"),
        import("./brains.id.json"),
        import("./overview.id.json"),
        import("./chat.id.json"),
        import("./search.id.json"),
        import("./sources.id.json"),
        import("./sessions.id.json"),
        import("./gaps.id.json"),
        import("./activity.id.json"),
        import("./secrets.id.json"),
        import("./permissions.id.json"),
        import("./graph.id.json"),
        import("./admin.id.json"),
        import("./oauth.id.json"),
        import("./brainSettings.id.json"),
        import("./notes.id.json"),
        import("./apps.id.json"),
        import("./presentations.id.json"),
        import("./notifications.id.json"),
        import("./media.id.json"),
      ]),
    ),
  "nl": async () =>
    merge(
      await Promise.all([
        import("./common.nl.json"),
        import("./shell.nl.json"),
        import("./auth.nl.json"),
        import("./account.nl.json"),
        import("./brains.nl.json"),
        import("./overview.nl.json"),
        import("./chat.nl.json"),
        import("./search.nl.json"),
        import("./sources.nl.json"),
        import("./sessions.nl.json"),
        import("./gaps.nl.json"),
        import("./activity.nl.json"),
        import("./secrets.nl.json"),
        import("./permissions.nl.json"),
        import("./graph.nl.json"),
        import("./admin.nl.json"),
        import("./oauth.nl.json"),
        import("./brainSettings.nl.json"),
        import("./notes.nl.json"),
        import("./apps.nl.json"),
        import("./presentations.nl.json"),
        import("./notifications.nl.json"),
        import("./media.nl.json"),
      ]),
    ),
  "pl": async () =>
    merge(
      await Promise.all([
        import("./common.pl.json"),
        import("./shell.pl.json"),
        import("./auth.pl.json"),
        import("./account.pl.json"),
        import("./brains.pl.json"),
        import("./overview.pl.json"),
        import("./chat.pl.json"),
        import("./search.pl.json"),
        import("./sources.pl.json"),
        import("./sessions.pl.json"),
        import("./gaps.pl.json"),
        import("./activity.pl.json"),
        import("./secrets.pl.json"),
        import("./permissions.pl.json"),
        import("./graph.pl.json"),
        import("./admin.pl.json"),
        import("./oauth.pl.json"),
        import("./brainSettings.pl.json"),
        import("./notes.pl.json"),
        import("./apps.pl.json"),
        import("./presentations.pl.json"),
        import("./notifications.pl.json"),
        import("./media.pl.json"),
      ]),
    ),
  "vi": async () =>
    merge(
      await Promise.all([
        import("./common.vi.json"),
        import("./shell.vi.json"),
        import("./auth.vi.json"),
        import("./account.vi.json"),
        import("./brains.vi.json"),
        import("./overview.vi.json"),
        import("./chat.vi.json"),
        import("./search.vi.json"),
        import("./sources.vi.json"),
        import("./sessions.vi.json"),
        import("./gaps.vi.json"),
        import("./activity.vi.json"),
        import("./secrets.vi.json"),
        import("./permissions.vi.json"),
        import("./graph.vi.json"),
        import("./admin.vi.json"),
        import("./oauth.vi.json"),
        import("./brainSettings.vi.json"),
        import("./notes.vi.json"),
        import("./apps.vi.json"),
        import("./presentations.vi.json"),
        import("./notifications.vi.json"),
        import("./media.vi.json"),
      ]),
    ),
  "uk": async () =>
    merge(
      await Promise.all([
        import("./common.uk.json"),
        import("./shell.uk.json"),
        import("./auth.uk.json"),
        import("./account.uk.json"),
        import("./brains.uk.json"),
        import("./overview.uk.json"),
        import("./chat.uk.json"),
        import("./search.uk.json"),
        import("./sources.uk.json"),
        import("./sessions.uk.json"),
        import("./gaps.uk.json"),
        import("./activity.uk.json"),
        import("./secrets.uk.json"),
        import("./permissions.uk.json"),
        import("./graph.uk.json"),
        import("./admin.uk.json"),
        import("./oauth.uk.json"),
        import("./brainSettings.uk.json"),
        import("./notes.uk.json"),
        import("./apps.uk.json"),
        import("./presentations.uk.json"),
        import("./notifications.uk.json"),
        import("./media.uk.json"),
      ]),
    ),
}
