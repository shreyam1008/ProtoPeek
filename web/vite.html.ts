// Normalize before Vite removes module script tags. Normalizing only the output
// leaves a different blank line when the source uses CRLF instead of LF.
export const normalizeHTMLInput = {
  name: 'normalize-html-input',
  transformIndexHtml: {
    order: 'pre' as const,
    handler: (html: string) => html.replace(/\r\n?/g, '\n'),
  },
};
