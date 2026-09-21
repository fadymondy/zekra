// Token and Tokens are types: Node's type-stripping cannot infer that from a
// mixed import and fails at runtime with "does not provide an export named
// 'Token'", even though tsc accepts it.
import { marked } from 'marked';
import type { Token, Tokens } from 'marked';

export type MdToken = Token;

export function tokenize(markdown: string): MdToken[] {
  return marked.lexer(markdown) as MdToken[];
}

export function inlineToText(tokens: Token[] | undefined): string {
  if (!tokens) return '';
  return tokens.map(tokenToText).join('');
}

function tokenToText(token: Token): string {
  const t = token as Tokens.Generic;
  switch (t.type) {
    case 'text':
      return t.text ?? '';
    case 'escape':
      return t.text ?? '';
    case 'codespan':
      return t.text ?? '';
    case 'strong':
    case 'em':
    case 'del':
      return inlineToText(t.tokens as Token[] | undefined);
    case 'link':
      return `${inlineToText(t.tokens as Token[] | undefined)} (${t.href ?? ''})`.trim();
    case 'image':
      return t.title ?? t.text ?? '';
    case 'br':
      return '\n';
    default:
      if (Array.isArray((t as Tokens.Generic).tokens)) {
        return inlineToText((t as Tokens.Generic).tokens as Token[]);
      }
      return ((t as Tokens.Generic).text as string) ?? '';
  }
}
