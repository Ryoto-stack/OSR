/* test/css-lint.mjs — syntax-check the stylesheet and cross-check class usage
   between the CSS and the JS that renders it. */
import fs from 'node:fs';
import * as csstree from 'css-tree';

const css = fs.readFileSync('src/styles.css', 'utf8');
let fail = 0;

// 1. syntax
const ast = csstree.parse(css, { positions: true, onParseError(e) {
  fail++; console.log('  ✗ CSS parse error at line ' + e.line + ': ' + e.message);
} });
console.log('CSS parsed, ' + csstree.findAll(ast, n => n.type === 'Rule').length + ' rules');

// 2. at-rule sanity: every @media/@supports must be balanced and known
const badAt = [];
csstree.walk(ast, { visit: 'Atrule', enter(n) {
  if (!/^(media|supports|keyframes|page|font-face|import|charset)$/.test(n.name)) badAt.push(n.name);
} });
if (badAt.length) { fail++; console.log('  ✗ unknown at-rules: ' + badAt.join(', ')); }

// 3. classes referenced in JS/templates but never styled
const cssClasses = new Set();
csstree.walk(ast, { visit: 'Selector', enter(node) {
  csstree.walk(node, (n) => { if (n.type === 'ClassSelector') cssClasses.add(n.name); } );
} });
const jsFiles = ['src/js/app.js', 'src/js/ui.js', 'src/js/panels.js', 'src/js/io.js', 'src/data/seed.js', 'src/index.html'];
const used = new Map();
for (const f of jsFiles) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/class(?:Name)?="([^"]*)"/g)) {
    for (let raw of m[1].split(/\s+/)) {
      raw = raw.replace(/\$\{[^}]*\}/g, '').trim();
      if (raw && /^[a-z][\w-]*$/i.test(raw)) used.set(raw, f);
    }
  }
  for (const m of src.matchAll(/classList\.(?:add|toggle|remove)\('([\w-]+)'/g)) used.set(m[1], f);
  for (const m of src.matchAll(/'((?:btn|chip|card|prose|modal|scrim|toast|pane|stat|swatch|seg|varpill|filepill|dropzone|phrase|empty|table-wrap|status-pill)\b[^']*)'/g)) {
    for (const c of m[1].split(/\s+/)) if (/^[\w-]+$/.test(c)) used.set(c, f);
  }
}
const missing = [...used.keys()].filter((c) => !cssClasses.has(c)).sort();
const unusedCss = [...cssClasses].filter((c) => !used.has(c)).sort();

console.log('\nClass coverage: ' + (used.size - missing.length) + '/' + used.size + ' JS classes styled');
if (missing.length) { console.log('  ⚠ used but not styled (ok if intentional utility/JS-only):'); console.log('    ' + missing.join(', ')); }
if (unusedCss.length) { console.log('  · styled but not referenced from JS/HTML (check for leftovers):'); console.log('    ' + unusedCss.join(', ')); }

// 4. balance sanity
const braces = (css.match(/{/g) || []).length - (css.match(/}/g) || []).length;
if (braces !== 0) { fail++; console.log('  ✗ unbalanced braces: ' + braces); }
console.log('\n' + (fail ? 'CSS LINT FAILED (' + fail + ')' : 'CSS LINT OK · balanced braces, ' + cssClasses.size + ' classes'));
process.exit(fail ? 1 : 0);
