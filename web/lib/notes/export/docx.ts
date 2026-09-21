import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { Token, Tokens } from 'marked';
import { tokenize } from '../../markdown/tokens.ts';
import type { MdToken } from '../../markdown/tokens.ts';

const HEADING_MAP: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

interface InlineStyle {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  font?: string;
  underline?: { type?: 'single' };
  color?: string;
}

export async function markdownToDocx(markdown: string): Promise<Buffer> {
  const tokens = tokenize(markdown);
  const children: (Paragraph | Table)[] = [];
  for (const token of tokens) {
    children.push(...renderBlock(token));
  }
  if (children.length === 0) {
    children.push(new Paragraph({ children: [new TextRun('')] }));
  }
  const doc = new Document({
    sections: [{ properties: {}, children }],
  });
  return Packer.toBuffer(doc);
}

function renderBlock(token: MdToken): (Paragraph | Table)[] {
  const t = token as Tokens.Generic;
  switch (t.type) {
    case 'heading': {
      const h = t as Tokens.Heading;
      return [
        new Paragraph({
          heading: HEADING_MAP[h.depth] ?? HeadingLevel.HEADING_1,
          children: inlineToRuns(h.tokens, {}),
        }),
      ];
    }
    case 'paragraph':
      return [
        new Paragraph({ children: inlineToRuns((t as Tokens.Paragraph).tokens, {}) }),
      ];
    case 'blockquote': {
      const inner = (((t as Tokens.Blockquote).tokens ?? []) as Token[]).flatMap(tok =>
        renderBlock(tok as MdToken),
      );
      // Mark each inner paragraph as quoted via italic + indent
      return inner.map(node => {
        if (node instanceof Paragraph) {
          return new Paragraph({
            indent: { left: 720 },
            children: [new TextRun({ text: extractText(node), italics: true, color: '666666' })],
          });
        }
        return node;
      });
    }
    case 'list':
      return renderList(t as Tokens.List, 0);
    case 'code': {
      const code = (t as Tokens.Code).text ?? '';
      return [
        new Paragraph({
          shading: { fill: 'F4F4F4', type: 'clear', color: 'auto' },
          children: [
            new TextRun({ text: code, font: 'Courier New', size: 20 }),
          ],
        }),
      ];
    }
    case 'table': {
      const tbl = t as Tokens.Table;
      const headerRow = new TableRow({
        children: tbl.header.map(
          c =>
            new TableCell({
              children: [
                new Paragraph({
                  children: inlineToRuns((c as Tokens.TableCell).tokens, { bold: true }),
                }),
              ],
              shading: { fill: 'EEEEEE', type: 'clear', color: 'auto' },
            }),
        ),
      });
      const bodyRows = tbl.rows.map(
        row =>
          new TableRow({
            children: row.map(
              c =>
                new TableCell({
                  children: [
                    new Paragraph({ children: inlineToRuns((c as Tokens.TableCell).tokens, {}) }),
                  ],
                }),
            ),
          }),
      );
      return [
        new Table({
          rows: [headerRow, ...bodyRows],
          width: { size: 100, type: WidthType.PERCENTAGE },
        }),
      ];
    }
    case 'hr':
      return [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '— — —', color: '999999' })],
        }),
      ];
    case 'space':
    case 'html':
      return [];
    default: {
      if ((t as Tokens.Generic).tokens) {
        return ((t as Tokens.Generic).tokens as Token[]).flatMap(tok =>
          renderBlock(tok as MdToken),
        );
      }
      const txt = ((t as Tokens.Generic).text as string) ?? '';
      return txt ? [new Paragraph({ children: [new TextRun(txt)] })] : [];
    }
  }
}

function renderList(list: Tokens.List, depth: number): Paragraph[] {
  const out: Paragraph[] = [];
  list.items.forEach((item, i) => {
    const start = typeof list.start === 'number' ? list.start : 1;
    const number = start + i;
    const bullet = list.ordered ? `${number}. ` : '• ';
    const item_ = item as Tokens.ListItem;
    const itemTokens = item_.tokens ?? [];
    const inlineRuns: TextRun[] = [];
    const childBlocks: Paragraph[] = [];
    for (const child of itemTokens) {
      const c = child as Tokens.Generic;
      if (c.type === 'text') {
        const fallback = [{ type: 'text', raw: c.text ?? '', text: c.text ?? '' }] as Token[];
        inlineRuns.push(...inlineToRuns(((c as Tokens.Text).tokens as Token[] | undefined) ?? fallback, {}));
      } else if (c.type === 'paragraph') {
        inlineRuns.push(...inlineToRuns((c as Tokens.Paragraph).tokens, {}));
      } else if (c.type === 'list') {
        childBlocks.push(...renderList(c as Tokens.List, depth + 1));
      } else {
        const blk = renderBlock(child as MdToken);
        for (const b of blk) {
          if (b instanceof Paragraph) childBlocks.push(b);
        }
      }
    }
    out.push(
      new Paragraph({
        indent: { left: 360 + depth * 360 },
        children: [new TextRun(bullet), ...inlineRuns],
      }),
    );
    out.push(...childBlocks);
  });
  return out;
}

function inlineToRuns(tokens: Token[] | undefined, base: InlineStyle): TextRun[] {
  if (!tokens) return [];
  const runs: TextRun[] = [];
  for (const token of tokens) {
    runs.push(...inlineTokenToRuns(token, base));
  }
  return runs;
}

function inlineTokenToRuns(token: Token, base: InlineStyle): TextRun[] {
  const t = token as Tokens.Generic;
  switch (t.type) {
    case 'text':
      if ((t as Tokens.Text).tokens) {
        return inlineToRuns((t as Tokens.Text).tokens, base);
      }
      return [new TextRun({ text: (t as Tokens.Text).text ?? '', ...base })];
    case 'escape':
      return [new TextRun({ text: (t as Tokens.Escape).text ?? '', ...base })];
    case 'codespan':
      return [
        new TextRun({
          text: (t as Tokens.Codespan).text ?? '',
          font: 'Courier New',
          ...base,
        }),
      ];
    case 'strong':
      return inlineToRuns((t as Tokens.Strong).tokens, { ...base, bold: true });
    case 'em':
      return inlineToRuns((t as Tokens.Em).tokens, { ...base, italics: true });
    case 'del':
      return inlineToRuns((t as Tokens.Del).tokens, { ...base, strike: true });
    case 'link': {
      const link = t as Tokens.Link;
      const inner = inlineToRuns(link.tokens, { ...base, color: '0066CC', underline: { type: 'single' } });
      return inner;
    }
    case 'image': {
      const img = t as Tokens.Image;
      return [new TextRun({ text: `[image: ${img.text || img.title || img.href || ''}]`, ...base, italics: true, color: '888888' })];
    }
    case 'br':
      return [new TextRun({ text: '\n', ...base })];
    default: {
      if ((t as Tokens.Generic).tokens) {
        return inlineToRuns((t as Tokens.Generic).tokens as Token[], base);
      }
      const txt = ((t as Tokens.Generic).text as string) ?? '';
      return txt ? [new TextRun({ text: txt, ...base })] : [];
    }
  }
}

function extractText(p: Paragraph): string {
  const opts = (p as unknown as { options?: { children?: unknown[] } }).options ?? {};
  const kids = (opts.children as unknown[] | undefined) ?? [];
  return kids
    .map(c => ((c as { options?: { text?: string } })?.options?.text) ?? '')
    .join('');
}
