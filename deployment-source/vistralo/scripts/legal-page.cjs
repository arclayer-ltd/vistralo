'use strict';
// Turns a legal notice in docs/legal/ into a static, public page (for example /privacy).
// It understands only what those files use: "#" and "##" headings, paragraphs, "- " lists,
// **bold**, [text](https://...) links and bare https:// addresses. HTML comments are dropped.
// Anything else (a table, raw HTML, a leftover {{FIELD}}) fails the build rather than reaching
// the page half-rendered.

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(text) {
  const links = [];
  let out = escape(text).replace(/\[([^\]]+)\]\(((?:https:\/\/|mailto:)[^)\s]+)\)/g, (_, label, href) => {
    links.push(`<a href="${href}">${label}</a>`);
    return `\u0000${links.length - 1}\u0000`;
  });
  out = out.replace(/https:\/\/[^\s<]+[^\s<.,;:)]/g, (href) => `<a href="${href}">${href}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => links[Number(i)]);
  return out;
}

/** Markdown body to HTML. Returns { title, html }; throws on anything it does not understand. */
function render(markdown) {
  const source = markdown.replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n/g, '\n');
  const problems = [];
  if (/\{\{[^}]*\}\}/.test(source)) problems.push('an unfilled {{FIELD}} placeholder');
  if (/^\s*\|/m.test(source)) problems.push('a table');
  if (/<[a-z/][^>]*>/i.test(source)) problems.push('raw HTML');
  if (/`/.test(source)) problems.push('code formatting (backticks)');
  if (/^#{3,}\s/m.test(source)) problems.push('a heading below level 2');
  if (problems.length) throw Error(`The legal page cannot be published: it contains ${problems.join(', ')}.`);
  let title = '';
  const html = [];
  for (const block of source.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)) {
    const lines = block.split('\n');
    if (/^# /.test(block)) {
      title = block.slice(2).trim();
      html.push(`<h1>${inline(title)}</h1>`);
    } else if (/^## /.test(block)) {
      const text = block.slice(3).trim();
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      html.push(`<h2 id="${id}">${inline(text)}</h2>`);
    } else if (lines.every((line) => /^- /.test(line))) {
      html.push(`<ul>${lines.map((line) => `<li>${inline(line.slice(2).trim())}</li>`).join('')}</ul>`);
    } else if (lines.some((line) => /^(#|- )/.test(line))) {
      throw Error(`The legal page cannot be published: a heading or list is not separated from the text around it: "${lines[0].slice(0, 60)}"`);
    } else {
      html.push(`<p>${inline(lines.join(' '))}</p>`);
    }
  }
  if (!title) throw Error('The legal page cannot be published: it has no "# " title.');
  return { title, html: html.join('\n') };
}

/** A whole page: no scripts, indexable, readable on a phone. */
function page({ markdown, path, description }) {
  const { title, html } = render(markdown);
  const canonical = `https://app.vistralo.com${path}`;
  return `<!doctype html>
<html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="index,follow"><meta name="color-scheme" content="light"><title>${escape(title)}</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="${canonical}"><link rel="icon" href="/assets/brand/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/legal.css"></head><body>
<header class="legal-bar"><a class="legal-brand" href="https://vistralo.com/"><svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M4 4H24L20 8H8V20L4 24Z M28 8V28H8L12 24H24V12Z"/></svg>vistralo</a><a class="legal-app" href="/">Open Vistralo</a></header>
<main class="legal-main">
${html}
</main>
<footer class="legal-foot"><p>Questions? Write to <a href="mailto:hello@arclayer.co">hello@arclayer.co</a>.</p></footer>
</body></html>
`;
}

module.exports = { render, page };
