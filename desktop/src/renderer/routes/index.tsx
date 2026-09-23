import type { Route } from "../shell/router";
import { BrainRoute } from "./brain";
import { BrainsRoute } from "./brains";
import { NotificationsRoute } from "./notifications";
import { SearchRoute } from "./search";
import { SettingsRoute } from "./settings";

/** Route -> screen. Exhaustive: a new Route variant fails to compile here
 *  until it is rendered. */
export function RouteView({ route }: { route: Route }) {
  switch (route.name) {
    case "brains":
      return <BrainsRoute />;
    case "brain":
      return <BrainRoute route={route} />;
    case "search":
      return <SearchRoute key={route.ns ?? "all"} route={route} />;
    case "notifications":
      return <NotificationsRoute />;
    case "settings":
      return <SettingsRoute route={route} />;
    default: {
      const never: never = route;
      return never;
    }
  }
}
