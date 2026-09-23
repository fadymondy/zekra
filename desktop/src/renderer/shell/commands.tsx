import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";

import { COMMANDS, type CommandEvent, type CommandName } from "../../shared/ipc";
import { bridge } from "../lib/bridge";
import { HandlerStack, type StackHandler } from "./handler-stack";

/*
The renderer half of the command bus.

Menu items, the tray, keyboard shortcuts and in-app buttons all issue a
`CommandName` (src/shared/ipc.ts COMMANDS). Main delivers menu/tray commands on
IPC `zekra:command`; this provider subscribes ONCE and dispatches.

Handlers form a STACK per command: the most recently mounted handler wins, and
when it unmounts the previous one is active again. The shell registers
app-wide fallbacks (shell/base-commands.tsx — e.g. "spotlight" opens the
Search route) and a screen that owns a better behaviour registers its own
while mounted (the note workspace takes "spotlight", "save", "new-note").

    useCommand("save", () => save());               // in any component
    const { run } = useCommands(); run("spotlight"); // issue one in-app
    const { defer } = useCommands(); defer("new-note"); // run when a handler mounts

A handler may return `false` to pass the command down the stack.
*/

export type CommandHandler = StackHandler<CommandEvent>;

type CommandsValue = {
  register: (name: CommandName, fn: CommandHandler) => () => void;
  /** Dispatch a command from the renderer. */
  run: (name: CommandName, source?: CommandEvent["source"]) => void;
  /** Hand `name` to the next handler that registers within 3 s. */
  defer: (name: CommandName, source?: CommandEvent["source"]) => void;
};

const CommandsContext = createContext<CommandsValue | null>(null);

export function CommandProvider({ children }: { children: ReactNode }) {
  const stack = useRef(new HandlerStack<CommandName, CommandEvent>()).current;

  useEffect(
    () =>
      bridge().onCommand((e) => {
        if (!stack.dispatch(e.name, e) && process.env.NODE_ENV !== "production") {
          console.debug("[zekra] unhandled command", e.name);
        }
      }),
    [stack],
  );

  const value = useMemo<CommandsValue>(
    () => ({
      register: (name, fn) => stack.register(name, fn),
      run: (name, source = "renderer") => {
        stack.dispatch(name, { name, source });
      },
      defer: (name, source = "renderer") => stack.defer(name, { name, source }, 3000),
    }),
    [stack],
  );

  return <CommandsContext.Provider value={value}>{children}</CommandsContext.Provider>;
}

export function useCommands(): CommandsValue {
  const v = useContext(CommandsContext);
  if (!v) throw new Error("useCommands outside <CommandProvider>");
  return v;
}

/**
 * Handle `name` while this component is mounted (and `enabled`). The latest
 * `fn` is always called, so it may close over fresh state without deps.
 */
export function useCommand(name: CommandName, fn: CommandHandler, enabled = true): void {
  const { register } = useCommands();
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    if (!enabled) return;
    return register(name, (e) => latest.current(e));
  }, [name, register, enabled]);
}

/** Issue a command from inside the renderer (buttons, shortcuts). */
export function useRunCommand(): CommandsValue["run"] {
  return useCommands().run;
}

export { COMMANDS };
export type { CommandName };
