// Strips comments out of the HTML pages: HTML comments, and the comments
// inside inline <style> and <script> blocks. Run it after editing a page.
//
//   node _build/clean-html.mjs page.html [more.html ...]
import fs from 'node:fs';

function stripJs(src) {
  let out = '', i = 0, prev = '';
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2; continue;
    }
    if (c === '"' || c === "'") {
      const q = c; out += c; i++;
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + src[i + 1]; i += 2; continue; }
        out += src[i];
        if (src[i] === q) { i++; break; }
        i++;
      }
      prev = q; continue;
    }
    if (c === '`') {
      out += c; i++;
      let depth = 0;
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + src[i + 1]; i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') { depth++; out += '${'; i += 2; continue; }
        if (src[i] === '}' && depth > 0) { depth--; out += '}'; i++; continue; }
        out += src[i];
        if (src[i] === '`' && depth === 0) { i++; break; }
        i++;
      }
      prev = '`'; continue;
    }
    if (c === '/' && /[=(,:[!&|?{};+\-*%~^<>]/.test(prev)) {
      out += c; i++;
      let cls = false;
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + src[i + 1]; i += 2; continue; }
        if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false;
        out += src[i];
        if (src[i] === '/' && !cls) { i++; break; }
        i++;
      }
      while (i < n && /[a-z]/.test(src[i])) { out += src[i]; i++; }
      prev = '/'; continue;
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

function stripCss(src) {
  let out = '', i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2; continue;
    }
    if (c === '"' || c === "'") {
      const q = c; out += c; i++;
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + src[i + 1]; i += 2; continue; }
        out += src[i];
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

// Collapses runs of blank lines left behind by a removed comment.
const tidy = s => s.replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n');

for (const file of process.argv.slice(2)) {
  let s = fs.readFileSync(file, 'utf8');
  const before = s.length;

  // Standalone scripts that are served as-is rather than built out of _js/.
  // A leading /*! banner is the one comment worth keeping: it is the name and
  // the docs link on a file other people are going to paste into their page.
  if (/\.js$/i.test(file)) {
    let banner = '';
    const m = s.match(/^\s*\/\*![\s\S]*?\*\/\n?/);
    if (m) { banner = m[0]; s = s.slice(m[0].length); }
    // A stripped comment leaves its indentation behind on an otherwise empty
    // line, so blank the whitespace first and only then collapse the runs.
    s = stripJs(s).replace(/^[ \t]+$/gm, '');
    s = banner + tidy(s).replace(/^\n+/, '');
    fs.writeFileSync(file, s);
    console.log(file + ': ' + before + ' -> ' + s.length);
    continue;
  }

  s = s.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi,
    (_m, attrs, body) => '<style' + attrs + '>' + tidy(stripCss(body)) + '</style>');

  // Only inline scripts have a body to strip; src= tags match nothing here.
  s = s.replace(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi,
    (_m, attrs, body) => '<script' + attrs + '>' + tidy(stripJs(body)) + '</script>');

  // HTML comments last, so the ones above already went with their block.
  s = s.replace(/<!--(?!\[if)[\s\S]*?-->/g, '');
  s = s.replace(/^[ \t]+$/gm, '');
  s = tidy(s);

  fs.writeFileSync(file, s);
  console.log(file + '  ' + before + ' -> ' + s.length);
}
