/**
 * Per-theme highlight.js token colour mapping.
 *
 * Each of the 25 bundled themes gets a coherent code-highlight palette
 * tuned against its chrome. We derive the colours from the existing
 * palette by default (link → keyword, accent → string, fgMuted → comment,
 * etc.) and let curated themes override individual buckets.
 */

import type { ThemeDefinition, ThemePalette } from './themes.ts';

export interface HljsTokens {
  /** keywords (`if`, `return`, `class`, `def`) */
  keyword: string;
  /** built-ins (`console`, `len`, `True`) */
  builtIn: string;
  /** strings ("hello", template literals) */
  string: string;
  /** numeric literals */
  number: string;
  /** comments — usually muted */
  comment: string;
  /** function / method names at definition + call sites */
  fn: string;
  /** types / classes (capitalised tokens, type annotations) */
  type: string;
  /** identifiers and properties */
  variable: string;
  /** operators, punctuation */
  operator: string;
  /** params inside function signatures */
  params: string;
  /** preprocessor / meta directives (#include, @decorator) */
  meta: string;
  /** regex literals */
  regex: string;
  /** color marker for `<title>` and `<doctag>` */
  title: string;
  /** color marker for `<tag>` (HTML elements) + `<name>` */
  tag: string;
  /** color marker for `<attribute>` */
  attribute: string;
}

/**
 * Map a chrome palette into a code-highlight palette using sensible
 * defaults that stay readable against the background. Themes that need
 * sharper choices override individual buckets via THEME_HLJS below.
 */
export function deriveHljsTokens(palette: ThemePalette): HljsTokens {
  return {
    keyword: palette.link,
    builtIn: palette.accent,
    string: palette.linkHover,
    number: palette.accent,
    comment: palette.fgMuted,
    fn: palette.link,
    type: palette.accent,
    variable: palette.fg,
    operator: palette.fgMuted,
    params: palette.fg,
    meta: palette.linkHover,
    regex: palette.accent,
    title: palette.link,
    tag: palette.link,
    attribute: palette.accent,
  };
}

/**
 * Curated overrides for themes whose community-known token palette would
 * land far from the derived defaults. Anything not listed here uses the
 * derived palette unchanged.
 */
const THEME_HLJS: Record<string, Partial<HljsTokens>> = {
  'github-light': {
    keyword: '#cf222e',
    builtIn: '#0550ae',
    string: '#0a3069',
    number: '#0550ae',
    comment: '#6e7781',
    fn: '#8250df',
    type: '#953800',
    variable: '#1f2328',
    operator: '#cf222e',
    params: '#1f2328',
    meta: '#0550ae',
    regex: '#116329',
    title: '#8250df',
    tag: '#116329',
    attribute: '#0550ae',
  },
  'github-dark': {
    keyword: '#ff7b72',
    builtIn: '#79c0ff',
    string: '#a5d6ff',
    number: '#79c0ff',
    comment: '#8b949e',
    fn: '#d2a8ff',
    type: '#ffa657',
    variable: '#e6edf3',
    operator: '#ff7b72',
    params: '#e6edf3',
    meta: '#79c0ff',
    regex: '#7ee787',
    title: '#d2a8ff',
    tag: '#7ee787',
    attribute: '#79c0ff',
  },
  dracula: {
    keyword: '#ff79c6',
    builtIn: '#8be9fd',
    string: '#f1fa8c',
    number: '#bd93f9',
    comment: '#6272a4',
    fn: '#50fa7b',
    type: '#8be9fd',
    variable: '#f8f8f2',
    operator: '#ff79c6',
    params: '#ffb86c',
    meta: '#bd93f9',
    regex: '#f1fa8c',
    title: '#50fa7b',
    tag: '#ff79c6',
    attribute: '#50fa7b',
  },
  'one-dark': {
    keyword: '#c678dd',
    builtIn: '#56b6c2',
    string: '#98c379',
    number: '#d19a66',
    comment: '#5c6370',
    fn: '#61afef',
    type: '#e5c07b',
    variable: '#abb2bf',
    operator: '#56b6c2',
    params: '#abb2bf',
    meta: '#56b6c2',
    regex: '#98c379',
    title: '#61afef',
    tag: '#e06c75',
    attribute: '#d19a66',
  },
  'one-light': {
    keyword: '#a626a4',
    builtIn: '#0184bb',
    string: '#50a14f',
    number: '#986801',
    comment: '#a0a1a7',
    fn: '#4078f2',
    type: '#c18401',
    variable: '#383a42',
    operator: '#0184bb',
    params: '#383a42',
    meta: '#0184bb',
    regex: '#50a14f',
    title: '#4078f2',
    tag: '#e45649',
    attribute: '#986801',
  },
  monokai: {
    keyword: '#f92672',
    builtIn: '#66d9ef',
    string: '#e6db74',
    number: '#ae81ff',
    comment: '#75715e',
    fn: '#a6e22e',
    type: '#66d9ef',
    variable: '#f8f8f2',
    operator: '#f92672',
    params: '#fd971f',
    meta: '#75715e',
    regex: '#e6db74',
    title: '#a6e22e',
    tag: '#f92672',
    attribute: '#a6e22e',
  },
  'solarized-light': {
    keyword: '#859900',
    builtIn: '#268bd2',
    string: '#2aa198',
    number: '#d33682',
    comment: '#93a1a1',
    fn: '#268bd2',
    type: '#b58900',
    variable: '#586e75',
    operator: '#859900',
    params: '#cb4b16',
    meta: '#cb4b16',
    regex: '#2aa198',
    title: '#268bd2',
    tag: '#268bd2',
    attribute: '#b58900',
  },
  'solarized-dark': {
    keyword: '#859900',
    builtIn: '#268bd2',
    string: '#2aa198',
    number: '#d33682',
    comment: '#586e75',
    fn: '#268bd2',
    type: '#b58900',
    variable: '#839496',
    operator: '#859900',
    params: '#cb4b16',
    meta: '#cb4b16',
    regex: '#2aa198',
    title: '#268bd2',
    tag: '#268bd2',
    attribute: '#b58900',
  },
  'tokyo-night': {
    keyword: '#bb9af7',
    builtIn: '#7dcfff',
    string: '#9ece6a',
    number: '#ff9e64',
    comment: '#565f89',
    fn: '#7aa2f7',
    type: '#7dcfff',
    variable: '#a9b1d6',
    operator: '#bb9af7',
    params: '#e0af68',
    meta: '#7dcfff',
    regex: '#9ece6a',
    title: '#7aa2f7',
    tag: '#f7768e',
    attribute: '#e0af68',
  },
  nord: {
    keyword: '#81a1c1',
    builtIn: '#88c0d0',
    string: '#a3be8c',
    number: '#b48ead',
    comment: '#616e88',
    fn: '#88c0d0',
    type: '#8fbcbb',
    variable: '#d8dee9',
    operator: '#81a1c1',
    params: '#d08770',
    meta: '#5e81ac',
    regex: '#ebcb8b',
    title: '#88c0d0',
    tag: '#81a1c1',
    attribute: '#8fbcbb',
  },
  'gruvbox-dark': {
    keyword: '#fb4934',
    builtIn: '#83a598',
    string: '#b8bb26',
    number: '#d3869b',
    comment: '#928374',
    fn: '#fabd2f',
    type: '#fabd2f',
    variable: '#ebdbb2',
    operator: '#fe8019',
    params: '#fe8019',
    meta: '#fb4934',
    regex: '#b8bb26',
    title: '#fabd2f',
    tag: '#fb4934',
    attribute: '#fabd2f',
  },
  'gruvbox-light': {
    keyword: '#9d0006',
    builtIn: '#076678',
    string: '#79740e',
    number: '#8f3f71',
    comment: '#7c6f64',
    fn: '#b57614',
    type: '#b57614',
    variable: '#3c3836',
    operator: '#af3a03',
    params: '#af3a03',
    meta: '#9d0006',
    regex: '#79740e',
    title: '#b57614',
    tag: '#9d0006',
    attribute: '#b57614',
  },
  'rose-pine': {
    keyword: '#c4a7e7',
    builtIn: '#9ccfd8',
    string: '#f6c177',
    number: '#eb6f92',
    comment: '#6e6a86',
    fn: '#ebbcba',
    type: '#9ccfd8',
    variable: '#e0def4',
    operator: '#eb6f92',
    params: '#f6c177',
    meta: '#31748f',
    regex: '#f6c177',
    title: '#ebbcba',
    tag: '#eb6f92',
    attribute: '#f6c177',
  },
  cobalt2: {
    keyword: '#ff9d00',
    builtIn: '#ffc600',
    string: '#a5ff90',
    number: '#ff628c',
    comment: '#0088ff',
    fn: '#ffc600',
    type: '#80ffbb',
    variable: '#ffffff',
    operator: '#ff9d00',
    params: '#ff628c',
    meta: '#ffc600',
    regex: '#a5ff90',
    title: '#ffc600',
    tag: '#9effff',
    attribute: '#ff9d00',
  },
};

export function hljsTokensFor(theme: ThemeDefinition): HljsTokens {
  const derived = deriveHljsTokens(theme.palette);
  const overrides = THEME_HLJS[theme.id] ?? {};
  return { ...derived, ...overrides };
}

/**
 * Emit the highlight.js CSS rules for a theme. Designed to be appended
 * after the bundled hljs base stylesheet so it overrides the generic
 * one-dark / github-light bundled defaults.
 */
export function hljsCssFor(theme: ThemeDefinition): string {
  const t = hljsTokensFor(theme);
  return [
    `.hljs { color: ${theme.palette.fg}; background: transparent; }`,
    `.hljs-keyword, .hljs-selector-tag, .hljs-literal { color: ${t.keyword}; }`,
    `.hljs-built_in, .hljs-builtin-name { color: ${t.builtIn}; }`,
    `.hljs-string, .hljs-symbol, .hljs-bullet { color: ${t.string}; }`,
    `.hljs-number, .hljs-link { color: ${t.number}; }`,
    `.hljs-comment, .hljs-quote { color: ${t.comment}; font-style: italic; }`,
    `.hljs-function, .hljs-title.function_, .hljs-title.invoke__ { color: ${t.fn}; }`,
    `.hljs-class .hljs-title, .hljs-title.class_, .hljs-type { color: ${t.type}; }`,
    `.hljs-variable, .hljs-template-variable, .hljs-property { color: ${t.variable}; }`,
    `.hljs-operator, .hljs-punctuation { color: ${t.operator}; }`,
    `.hljs-params { color: ${t.params}; }`,
    `.hljs-meta, .hljs-meta-keyword, .hljs-doctag { color: ${t.meta}; }`,
    `.hljs-regexp { color: ${t.regex}; }`,
    `.hljs-title, .hljs-section { color: ${t.title}; }`,
    `.hljs-tag, .hljs-name, .hljs-selector-id, .hljs-selector-class { color: ${t.tag}; }`,
    `.hljs-attr, .hljs-attribute { color: ${t.attribute}; }`,
    `.hljs-emphasis { font-style: italic; }`,
    `.hljs-strong { font-weight: 600; }`,
  ].join('\n');
}
