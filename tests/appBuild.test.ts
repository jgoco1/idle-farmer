// The builds for the shells and the Pages site (v3 phase 00, requirements 5 and 6). Builds the app
// (`vite build --mode app`, as `npm run build:app` does) into a temporary folder and scans it: relative
// URLs, no debug overlay, no e2e hooks, no service worker and nothing loaded from the network.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  listFiles,
  markdownToHtml,
  precacheList,
  privacyPage,
  serviceWorkerSource,
} from '../scripts/build/pwa';

/** URLs that are identifiers, not something fetched: the SVG namespace in createElementNS. */
const ALLOWED_URLS = [/^http:\/\/www\.w3\.org\/2000\/svg$/];

/** Text with block and line comments removed (so licence banners and notes do not count). */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1');
}

describe('the app build (dist-app)', () => {
  let out = '';
  let files: string[] = [];
  const read = (f: string): string => readFileSync(join(out, f), 'utf8');

  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'dist-app-'));
    // A separate process, exactly like `npm run build:app` (inside vitest NODE_ENV is "test", which would make a dev build).
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production' };
    delete env.VITE_E2E;
    execFileSync(
      'node_modules/.bin/vite',
      ['build', '--mode', 'app', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'],
      {
        env,
        stdio: 'pipe',
      },
    );
    files = listFiles(out);
  }, 120_000);
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it('loads everything through relative URLs', () => {
    const html = read('index.html');
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(3);
    for (const ref of refs) expect(ref).toMatch(/^\.\//);
    expect(html).not.toContain('/idle-farmer/');
    for (const f of files.filter((x) => x.endsWith('.js') || x.endsWith('.css')))
      expect(read(f), f).not.toContain('/idle-farmer/');
  });

  it('has no debug overlay, no e2e hooks and no service worker', () => {
    expect(files).not.toContain('sw.js');
    expect(files).not.toContain('privacy.html');
    expect(files.some((f) => /debug/i.test(f))).toBe(false);
    const js = files
      .filter((f) => f.endsWith('.js'))
      .map(read)
      .join('\n');
    for (const hook of ['__game', '__view', 'Debug overlay', 'Time warp', 'serviceWorker', 'sw.js'])
      expect(js, hook).not.toContain(hook);
  });

  it('fetches nothing from the network', () => {
    const text = files.filter((f) => /\.(js|css|html|webmanifest|svg)$/.test(f));
    expect(text.length).toBeGreaterThan(3);
    for (const f of text) {
      const urls = stripComments(read(f)).match(/https?:\/\/[^\s"'`)<>]+/g) ?? [];
      const remote = urls.filter((u) => !ALLOWED_URLS.some((re) => re.test(u)));
      expect(remote, f).toEqual([]);
    }
  });
});

describe('the Pages build helpers', () => {
  it('precache every built file but the worker and source maps', () => {
    expect(
      precacheList(['assets/a.js', 'assets/a.js.map', 'icon.svg', 'index.html', 'privacy.html', 'sw.js']),
    ).toEqual(['assets/a.js', 'icon.svg', './', 'privacy.html']);
  });

  it('fill the service worker template', () => {
    const template = readFileSync('scripts/build/sw.js', 'utf8');
    const sw = serviceWorkerSource(template, 'abc123', ['./', 'assets/a.js']);
    expect(sw).toContain('const VERSION = "abc123";');
    expect(sw).toContain('const FILES = ["./","assets/a.js"];');
    expect(sw).not.toContain("'dev'");
    expect(() => serviceWorkerSource('nothing here', 'v', [])).toThrow();
  });

  it('render the privacy policy', () => {
    expect(
      markdownToHtml('# Title\n\nSome **bold** text\nwrapped.\n\n- one\n- two <b>\n\n[a link](https://x.y)'),
    ).toBe(
      '<h1>Title</h1>\n<p>Some <strong>bold</strong> text wrapped.</p>\n<ul><li>one</li><li>two &lt;b&gt;</li></ul>\n<p><a href="https://x.y">a link</a></p>',
    );
    const page = privacyPage(readFileSync('docs/privacy.md', 'utf8'));
    expect(page).toContain('<title>Hearthfield Idle: Privacy Policy</title>');
    expect(page).toContain('This game collects no data.');
  });
});
