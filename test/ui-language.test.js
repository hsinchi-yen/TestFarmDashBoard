const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const NON_ENGLISH_SCRIPTS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function listInterfaceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listInterfaceFiles(fullPath);
    return /\.(?:html|js|css)$/.test(entry.name) ? [fullPath] : [];
  });
}

test('public interface contains no CJK text', () => {
  for (const filePath of listInterfaceFiles(PUBLIC_DIR)) {
    const source = fs.readFileSync(filePath, 'utf8');
    assert.doesNotMatch(source, NON_ENGLISH_SCRIPTS, path.relative(PUBLIC_DIR, filePath));
  }
});

test('all public HTML documents declare English', () => {
  for (const fileName of ['index.html', 'config.html']) {
    const source = fs.readFileSync(path.join(PUBLIC_DIR, fileName), 'utf8');
    assert.match(source, /<html lang="en">/);
  }
});
