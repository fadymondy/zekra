import { Fragment, type ReactNode } from "react";

import type { TKey, TVars } from "../../lib/i18n";

/*
Machine strings (secret names, kinds, namespaces, hints) inside translated
sentences: rendered as isolated LTR mono runs, so "OPENAI_API_KEY" reads the
same in the Arabic UI and never reorders the sentence around it.
*/

export function Ltr({ children, mono = true }: { children: ReactNode; mono?: boolean }) {
  return (
    <bdi dir="ltr" className={mono ? "font-mono" : undefined}>
      {children}
    </bdi>
  );
}

const MARK = "\u0000";

/** t(key) with `{name}` replaced by an isolated LTR run of `value`. */
export function tLtr(t: (key: TKey, vars?: TVars) => string, key: TKey, name: string, value: string, vars: TVars = {}): ReactNode {
  const parts = t(key, { ...vars, [name]: MARK }).split(MARK);
  return parts.map((part, i) => (
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 ? <Ltr>{value}</Ltr> : null}
    </Fragment>
  ));
}
