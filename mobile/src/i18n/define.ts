// A feature's strings, EN + AR at full key parity: `ar` must carry exactly
// the keys `en` has, so a missing translation is a type error, not a blank.
export type FeatureDict<E extends Record<string, string>> = { en: E; ar: Record<keyof E, string> };

export function defineDict<const E extends Record<string, string>>(dict: FeatureDict<E>): FeatureDict<E> {
  return dict;
}

export type DictKey<D> = D extends FeatureDict<infer E> ? keyof E & string : never;
