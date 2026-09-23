import type { Route } from "../shell/router";
import { BrainRoute } from "./brain";
import { BrainsRoute } from "./brains";
import { SearchRoute } from "./search";

/** Route -> screen. Exhaustive: a new Route variant fails to compile here
 *  until it is rendered. (Settings is its own window, the notification
 *  center the bell's popover — neither is a route.) */
export function RouteView({ route }: { route: Route }) {
  switch (route.name) {
    case "brains":
      return <BrainsRoute />;
    case "brain":
      return <BrainRoute route={route} />;
    case "search":
      return <SearchRoute key={route.ns ?? "all"} route={route} />;
    default: {
      const never: never = route;
      return never;
    }
  }
}
