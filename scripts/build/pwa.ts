// Build steps for the Pages build (v3 phase 00), run from vite.config.ts after the bundle is
// written: render docs/privacy.md to privacy.html, then write sw.js with the list of every built
// file to precache and a version hash of their contents. Never runs for the app build (`--mode app`).

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

/** Every file under `dir`, as POSIX paths relative to it, sorted. */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

/** The files the service worker precaches: everything but itself and source maps; `./` stands for index.html. */
export function precacheList(files: readonly string[]): string[] {
  return files
    .filter((f) => f !== 'sw.js' && !f.endsWith('.map'))
    .map((f) => (f === 'index.html' ? './' : f));
}

export function serviceWorkerSource(template: string, version: string, files: readonly string[]): string {
  const out = template
    .replace(/const VERSION = 'dev';[^\n]*/, `const VERSION = ${JSON.stringify(version)};`)
    .replace(/const FILES = \[\];[^\n]*/, `const FILES = ${JSON.stringify(files)};`);
  if (out === template) throw new Error('sw.js template placeholders not found');
  return out;
}

const escapeHtml = (t: string): string =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(t: string): string {
  return escapeHtml(t)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
}

/** A small Markdown subset (headings, paragraphs, bullet lists, bold, code, links) to HTML, enough for docs/privacy.md. */
export function markdownToHtml(md: string): string {
  const html: string[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flush = (): void => {
    if (para.length) html.push(`<p>${inline(para.join(' '))}</p>`);
    if (list.length) html.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`);
    para = [];
    list = [];
  };
  for (const line of md.split('\n')) {
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      html.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
    } else if (item) {
      if (para.length) flush();
      list.push(item[1]!);
    } else if (line.trim() === '') flush();
    else if (list.length && /^\s+/.test(line)) list[list.length - 1] += ` ${line.trim()}`;
    else {
      if (list.length) flush();
      para.push(line.trim());
    }
  }
  flush();
  return html.join('\n');
}

export function privacyPage(md: string): string {
  const title = /^#\s+(.*)$/m.exec(md)?.[1] ?? 'Privacy';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<style>
body { margin: 0 auto; max-width: 42rem; padding: 24px 16px; background: #fff4dc; color: #2b1d1a; font: 16px/1.5 system-ui, sans-serif; }
h1, h2 { color: #44692e; }
a { color: #7d5634; }
</style>
</head>
<body>
${markdownToHtml(md)}
</body>
</html>
`;
}

/** The Vite plugin: privacy.html and sw.js for the Pages build. */
export function pwaPlugin(): Plugin {
  let root = '';
  let outDir = '';
  let enabled = false;
  return {
    name: 'hearthfield-pwa',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      outDir = resolve(config.root, config.build.outDir);
      enabled = config.mode !== 'app';
    },
    closeBundle() {
      if (!enabled) return;
      writeFileSync(
        join(outDir, 'privacy.html'),
        privacyPage(readFileSync(join(root, 'docs/privacy.md'), 'utf8')),
      );
      const files = precacheList(listFiles(outDir));
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f === './' ? 'index.html' : f)));
      const template = readFileSync(join(root, 'scripts/build/sw.js'), 'utf8');
      writeFileSync(
        join(outDir, 'sw.js'),
        serviceWorkerSource(template, hash.digest('hex').slice(0, 16), files),
      );
    },
  };
}
