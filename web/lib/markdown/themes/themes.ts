export type ThemeKind = 'light' | 'dark';

export interface ThemePalette {
  bg: string;
  fg: string;
  fgMuted: string;
  border: string;
  link: string;
  linkHover: string;
  codeBg: string;
  inlineCodeBg: string;
  tableStripe: string;
  accent: string;
}

export interface ThemeDefinition {
  id: string;
  label: string;
  kind: ThemeKind;
  palette: ThemePalette;
}

export const THEMES: ThemeDefinition[] = [
  {
    id: 'github-light',
    label: 'GitHub Light',
    kind: 'light',
    palette: {
      bg: '#ffffff', fg: '#1f2328', fgMuted: '#656d76', border: '#d0d7de',
      link: '#0969da', linkHover: '#0550ae', codeBg: '#f6f8fa',
      inlineCodeBg: 'rgba(175,184,193,0.2)', tableStripe: '#f6f8fa', accent: '#0969da',
    },
  },
  {
    id: 'github-dark',
    label: 'GitHub Dark',
    kind: 'dark',
    palette: {
      bg: '#0d1117', fg: '#e6edf3', fgMuted: '#7d8590', border: '#30363d',
      link: '#2f81f7', linkHover: '#58a6ff', codeBg: '#161b22',
      inlineCodeBg: 'rgba(110,118,129,0.4)', tableStripe: '#161b22', accent: '#2f81f7',
    },
  },
  {
    id: 'dracula',
    label: 'Dracula',
    kind: 'dark',
    palette: {
      bg: '#282a36', fg: '#f8f8f2', fgMuted: '#6272a4', border: '#44475a',
      link: '#8be9fd', linkHover: '#bd93f9', codeBg: '#21222c',
      inlineCodeBg: '#44475a', tableStripe: '#2f3243', accent: '#bd93f9',
    },
  },
  {
    id: 'one-dark',
    label: 'Atom One Dark',
    kind: 'dark',
    palette: {
      bg: '#282c34', fg: '#abb2bf', fgMuted: '#7f848e', border: '#3e4451',
      link: '#61afef', linkHover: '#56b6c2', codeBg: '#21252b',
      inlineCodeBg: '#3e4451', tableStripe: '#2c313c', accent: '#c678dd',
    },
  },
  {
    id: 'one-light',
    label: 'Atom One Light',
    kind: 'light',
    palette: {
      bg: '#fafafa', fg: '#383a42', fgMuted: '#a0a1a7', border: '#e5e5e6',
      link: '#4078f2', linkHover: '#0184bb', codeBg: '#f0f0f1',
      inlineCodeBg: '#e5e5e6', tableStripe: '#f5f5f6', accent: '#a626a4',
    },
  },
  {
    id: 'monokai',
    label: 'Monokai',
    kind: 'dark',
    palette: {
      bg: '#272822', fg: '#f8f8f2', fgMuted: '#75715e', border: '#3e3d32',
      link: '#66d9ef', linkHover: '#a6e22e', codeBg: '#1e1f1c',
      inlineCodeBg: '#3e3d32', tableStripe: '#2d2e26', accent: '#f92672',
    },
  },
  {
    id: 'solarized-light',
    label: 'Solarized Light',
    kind: 'light',
    palette: {
      bg: '#fdf6e3', fg: '#586e75', fgMuted: '#93a1a1', border: '#eee8d5',
      link: '#268bd2', linkHover: '#2aa198', codeBg: '#eee8d5',
      inlineCodeBg: '#eee8d5', tableStripe: '#f5efdc', accent: '#cb4b16',
    },
  },
  {
    id: 'solarized-dark',
    label: 'Solarized Dark',
    kind: 'dark',
    palette: {
      bg: '#002b36', fg: '#839496', fgMuted: '#586e75', border: '#073642',
      link: '#268bd2', linkHover: '#2aa198', codeBg: '#073642',
      inlineCodeBg: '#073642', tableStripe: '#02303c', accent: '#b58900',
    },
  },
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    kind: 'dark',
    palette: {
      bg: '#1a1b26', fg: '#a9b1d6', fgMuted: '#565f89', border: '#292e42',
      link: '#7aa2f7', linkHover: '#bb9af7', codeBg: '#16161e',
      inlineCodeBg: '#292e42', tableStripe: '#1f2335', accent: '#bb9af7',
    },
  },
  {
    id: 'tokyo-night-light',
    label: 'Tokyo Night Light',
    kind: 'light',
    palette: {
      bg: '#d5d6db', fg: '#343b58', fgMuted: '#6c6e75', border: '#a8aecb',
      link: '#34548a', linkHover: '#5a4a78', codeBg: '#cbccd1',
      inlineCodeBg: '#cbccd1', tableStripe: '#cdced3', accent: '#5a4a78',
    },
  },
  {
    id: 'ayu-light',
    label: 'Ayu Light',
    kind: 'light',
    palette: {
      bg: '#fafafa', fg: '#5c6166', fgMuted: '#828c99', border: '#e7eaed',
      link: '#399ee6', linkHover: '#86b300', codeBg: '#f3f3f3',
      inlineCodeBg: '#e7eaed', tableStripe: '#f1f1f1', accent: '#fa8d3e',
    },
  },
  {
    id: 'ayu-mirage',
    label: 'Ayu Mirage',
    kind: 'dark',
    palette: {
      bg: '#1f2430', fg: '#cbccc6', fgMuted: '#707a8c', border: '#34455a',
      link: '#73d0ff', linkHover: '#bae67e', codeBg: '#191e2a',
      inlineCodeBg: '#34455a', tableStripe: '#242936', accent: '#ffcc66',
    },
  },
  {
    id: 'ayu-dark',
    label: 'Ayu Dark',
    kind: 'dark',
    palette: {
      bg: '#0a0e14', fg: '#b3b1ad', fgMuted: '#5c6773', border: '#11151c',
      link: '#39bae6', linkHover: '#aad94c', codeBg: '#0d1017',
      inlineCodeBg: '#11151c', tableStripe: '#0e131c', accent: '#f29668',
    },
  },
  {
    id: 'gruvbox-light',
    label: 'Gruvbox Light',
    kind: 'light',
    palette: {
      bg: '#fbf1c7', fg: '#3c3836', fgMuted: '#7c6f64', border: '#ebdbb2',
      link: '#076678', linkHover: '#9d0006', codeBg: '#f2e5bc',
      inlineCodeBg: '#ebdbb2', tableStripe: '#f5e9c4', accent: '#d65d0e',
    },
  },
  {
    id: 'gruvbox-dark',
    label: 'Gruvbox Dark',
    kind: 'dark',
    palette: {
      bg: '#282828', fg: '#ebdbb2', fgMuted: '#928374', border: '#3c3836',
      link: '#83a598', linkHover: '#fabd2f', codeBg: '#1d2021',
      inlineCodeBg: '#3c3836', tableStripe: '#2c2c2c', accent: '#fe8019',
    },
  },
  {
    id: 'nord',
    label: 'Nord',
    kind: 'dark',
    palette: {
      bg: '#2e3440', fg: '#d8dee9', fgMuted: '#7b88a1', border: '#3b4252',
      link: '#88c0d0', linkHover: '#81a1c1', codeBg: '#3b4252',
      inlineCodeBg: '#434c5e', tableStripe: '#353c4a', accent: '#a3be8c',
    },
  },
  {
    id: 'nord-light',
    label: 'Nord Light',
    kind: 'light',
    palette: {
      bg: '#eceff4', fg: '#2e3440', fgMuted: '#4c566a', border: '#d8dee9',
      link: '#5e81ac', linkHover: '#81a1c1', codeBg: '#e5e9f0',
      inlineCodeBg: '#d8dee9', tableStripe: '#e8ebf2', accent: '#bf616a',
    },
  },
  {
    id: 'palenight',
    label: 'Palenight',
    kind: 'dark',
    palette: {
      bg: '#292d3e', fg: '#a6accd', fgMuted: '#676e95', border: '#34394e',
      link: '#82aaff', linkHover: '#c792ea', codeBg: '#222533',
      inlineCodeBg: '#34394e', tableStripe: '#2d3142', accent: '#c792ea',
    },
  },
  {
    id: 'material-dark',
    label: 'Material Dark',
    kind: 'dark',
    palette: {
      bg: '#263238', fg: '#eeffff', fgMuted: '#b2ccd6', border: '#37474f',
      link: '#82aaff', linkHover: '#c3e88d', codeBg: '#1e272c',
      inlineCodeBg: '#37474f', tableStripe: '#2a363c', accent: '#ffcb6b',
    },
  },
  {
    id: 'material-light',
    label: 'Material Light',
    kind: 'light',
    palette: {
      bg: '#fafafa', fg: '#90a4ae', fgMuted: '#b0bec5', border: '#cfd8dc',
      link: '#39adb5', linkHover: '#7c4dff', codeBg: '#eceff1',
      inlineCodeBg: '#cfd8dc', tableStripe: '#f3f5f6', accent: '#f76d47',
    },
  },
  {
    id: 'night-owl',
    label: 'Night Owl',
    kind: 'dark',
    palette: {
      bg: '#011627', fg: '#d6deeb', fgMuted: '#5f7e97', border: '#1d3b53',
      link: '#82aaff', linkHover: '#7fdbca', codeBg: '#01111d',
      inlineCodeBg: '#1d3b53', tableStripe: '#0a1b29', accent: '#c792ea',
    },
  },
  {
    id: 'cobalt2',
    label: 'Cobalt 2',
    kind: 'dark',
    palette: {
      bg: '#193549', fg: '#ffffff', fgMuted: '#aaaaaa', border: '#234e6e',
      link: '#ffc600', linkHover: '#ff9d00', codeBg: '#122738',
      inlineCodeBg: '#234e6e', tableStripe: '#163c54', accent: '#ff628c',
    },
  },
  {
    id: 'oceanic-next',
    label: 'Oceanic Next',
    kind: 'dark',
    palette: {
      bg: '#1b2b34', fg: '#cdd3de', fgMuted: '#65737e', border: '#343d46',
      link: '#6699cc', linkHover: '#5fb3b3', codeBg: '#16242d',
      inlineCodeBg: '#343d46', tableStripe: '#1f303a', accent: '#fac863',
    },
  },
  {
    id: 'snazzy',
    label: 'Hyper Snazzy',
    kind: 'dark',
    palette: {
      bg: '#1d1f21', fg: '#eff0eb', fgMuted: '#a0a4a8', border: '#34373c',
      link: '#57c7ff', linkHover: '#9aedfe', codeBg: '#161718',
      inlineCodeBg: '#34373c', tableStripe: '#222426', accent: '#ff5c57',
    },
  },
  {
    id: 'rose-pine',
    label: 'Rosé Pine',
    kind: 'dark',
    palette: {
      bg: '#191724', fg: '#e0def4', fgMuted: '#908caa', border: '#26233a',
      link: '#9ccfd8', linkHover: '#c4a7e7', codeBg: '#1f1d2e',
      inlineCodeBg: '#26233a', tableStripe: '#21202e', accent: '#eb6f92',
    },
  },
];

export const THEME_IDS = THEMES.map(t => t.id);

export function findTheme(id: string): ThemeDefinition | undefined {
  return THEMES.find(t => t.id === id);
}

/**
 * The element that carries a note's content (preview, shared reader, viewer). Reading themes
 * apply here and only here, so the app chrome around the note stays on the grid.
 */
export const READING_SCOPE = '.mid-reading';

/**
 * A named theme as a CSS rule scoped to the reading area. It overrides the same --mid-* names the
 * chrome uses (packages/ui-tokens/src/tokens.css), so content stylesheets need no second
 * vocabulary; the override just stops at the edge of `scope`.
 */
export function readingThemeCss(theme: ThemeDefinition, scope: string = READING_SCOPE): string {
  const p = theme.palette;
  return `${scope} { color-scheme: ${theme.kind}; ${[
    `--mid-bg: ${p.bg};`,
    `--mid-fg: ${p.fg};`,
    `--mid-fg-muted: ${p.fgMuted};`,
    `--mid-fg-subtle: ${p.fgMuted};`,
    `--mid-border: ${p.border};`,
    `--mid-border-strong: ${p.border};`,
    `--mid-link: ${p.link};`,
    `--mid-link-hover: ${p.linkHover};`,
    `--mid-code-bg: ${p.codeBg};`,
    `--mid-inline-code-bg: ${p.inlineCodeBg};`,
    `--mid-table-stripe: ${p.tableStripe};`,
    `--mid-accent: ${p.accent};`,
    `--mid-surface: ${p.codeBg};`,
  ].join(' ')} }`;
}

export function paletteToCss(palette: ThemePalette): string {
  return [
    `--bg: ${palette.bg};`,
    `--fg: ${palette.fg};`,
    `--fg-muted: ${palette.fgMuted};`,
    `--border: ${palette.border};`,
    `--link: ${palette.link};`,
    `--link-hover: ${palette.linkHover};`,
    `--code-bg: ${palette.codeBg};`,
    `--inline-code-bg: ${palette.inlineCodeBg};`,
    `--table-stripe: ${palette.tableStripe};`,
    `--accent: ${palette.accent};`,
  ].join(' ');
}
