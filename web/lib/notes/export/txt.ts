import type { Token, Tokens } from 'marked';
import { inlineToText, tokenize } from '../../markdown/tokens.ts';
import type { MdToken } from '../../markdown/tokens.ts';

export function markdownToTxt(markdown: string): string {
  const out: string[] = [];
  const tokens = tokenize(markdown);
  for (const token of tokens) {
    out.push(...renderBlock(token, 0));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function renderBlock(token: MdToken, indent: number): string[] {
  const t = token as Tokens.Generic;
  const pad = '  '.repeat(indent);
  switch (t.type) {
    case 'heading': {
      const h = t as Tokens.Heading;
      const prefix = '#'.repeat(h.depth) + ' ';
      return [pad + prefix + inlineToText(h.tokens), ''];
    }
    case 'paragraph':
      return [pad + inlineToText((t as Tokens.Paragraph).tokens), ''];
    case 'blockquote': {
      const inner = (((t as Tokens.Blockquote).tokens ?? []) as Token[]).flatMap(tok =>
        renderBlock(tok as MdToken, indent),
      );
      return inner.map(line => (line ? `${pad}> ${line}` : pad + '>')).concat('');
    }
    case 'list': {
      const list = t as Tokens.List;
      const lines: string[] = [];
      list.items.forEach((item, i) => {
        const start = typeof list.start === 'number' ? list.start : 1;
        const bullet = list.ordered ? `${start + i}.` : '-';
        const itemLines = (((item as Tokens.ListItem).tokens ?? []) as Token[]).flatMap(tok =>
          renderBlock(tok as MdToken, indent + 1),
        );
        const first = itemLines.shift() ?? '';
        const stripped = first.replace(new RegExp(`^${'  '.repeat(indent + 1)}`), '');
        lines.push(`${pad}${bullet} ${stripped}`.trimEnd());
        for (const rest of itemLines) {
          if (rest) lines.push(rest);
        }
      });
      lines.push('');
      return lines;
    }
    case 'code': {
      const code = (t as Tokens.Code).text ?? '';
      const lang = (t as Tokens.Code).lang ?? '';
      const banner = lang ? `${pad}--- ${lang} ---` : `${pad}---`;
      const lines = code.split('\n').map(l => `${pad}${l}`);
      return [banner, ...lines, `${pad}---`, ''];
    }
    case 'table': {
      const tbl = t as Tokens.Table;
      const headers = tbl.header.map(h => inlineToText((h as Tokens.TableCell).tokens) || (h as Tokens.TableCell).text || '');
      const widths = headers.map(h => h.length);
      const rows = tbl.rows.map(row =>
        row.map((cell, i) => {
          const text = inlineToText((cell as Tokens.TableCell).tokens) || (cell as Tokens.TableCell).text || '';
          if (text.length > widths[i]) widths[i] = text.length;
          return text;
        }),
      );
      const fmt = (cells: string[]) =>
        '| ' + cells.map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |';
      const sep = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';
      return [pad + fmt(headers), pad + sep, ...rows.map(r => pad + fmt(r)), ''];
    }
    case 'hr':
      return [pad + '---', ''];
    case 'space':
      return [];
    case 'html':
      return [pad + ((t as { text?: string }).text ?? ''), ''];
    default: {
      if ((t as Tokens.Generic).tokens) {
        return ((t as Tokens.Generic).tokens as Token[]).flatMap(tok =>
          renderBlock(tok as MdToken, indent),
        );
      }
      const txt = ((t as Tokens.Generic).text as string) ?? '';
      return txt ? [pad + txt, ''] : [];
    }
  }
}
