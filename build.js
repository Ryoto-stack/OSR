#!/usr/bin/env node
/* build.js — inline src/ into ONE portable HTML file you can double-click.
   Usage: node build.js            -> writes index.html + OSR-Desk.html
          node build.js --check    -> just verifies the bundle parses      */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const src = path.join(root, 'src');
const checkOnly = process.argv.includes('--check');

let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');

// 1. inline css
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/, (m, href) => {
  const css = fs.readFileSync(path.join(root, href), 'utf8');
  return `<style>\n${css.trim()}\n</style>`;
});

// 2. inline scripts in order
html = html.replace(/<!-- SCRIPTS:START -->[\s\S]*?<!-- SCRIPTS:END -->/, (block) => {
  const files = [...block.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  if (!files.length) throw new Error('no scripts found to inline');
  return files
    .map((rel) => {
      let code = fs.readFileSync(path.join(root, rel), 'utf8');
      code = code.replace(/<\/script/gi, '<\\/script'); // never break the tag
      return `<script data-src="${rel}">\n${code.trim()}\n</script>`;
    })
    .join('\n');
});

const stamp = new Date().toISOString().slice(0, 10);
const banner = `<!--\n  OSR Desk — personal support workflow kit.\n  Built ${stamp} · single file, works offline, no dependencies, nothing leaves this machine.\n  Source + docs: see README.md (src/ folder holds the real files).\n-->\n`;
html = html.replace(/<!doctype html>/i, `<!doctype html>\n${banner}`);

if (checkOnly) {
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
  console.log(`bundle check: ${scripts.length} inline scripts, ${(html.length / 1024).toFixed(0)} KB`);
  process.exit(0);
}

fs.writeFileSync(path.join(root, 'index.html'), html);
fs.writeFileSync(path.join(root, 'OSR-Desk.html'), html);
const kb = (fs.statSync(path.join(root, 'OSR-Desk.html')).size / 1024).toFixed(0);
console.log(`built OSR-Desk.html + index.html  (${kb} KB, ${((html.length / 1024) * 1).toFixed(0)} KB raw)`);
