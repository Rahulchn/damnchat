import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import '../app/static/avatar-catalog.js';

const catalog = globalThis.avatarCatalog;
const directory = new URL('../app/static/avatars/', import.meta.url);
test('picker and legacy IDs resolve to existing project illustrations only', () => {
  assert.equal(catalog.choices.length,8);
  assert.equal(new Set(catalog.choices).size,8);
  for (const [id,file] of Object.entries(catalog.files)) {
    assert.match(file,/^[a-z]+\.svg$/);
    assert.ok(existsSync(new URL(file,directory)),id);
    assert.ok(catalog.choices.includes(catalog.preferred(id)));
  }
  assert.equal(catalog.preferred('doge'),'luna');
  assert.equal(catalog.preferred(null),'orbit');
  assert.equal(catalog.preferred('__proto__'),'orbit');
  assert.equal(catalog.preferred('../../private'),'orbit');
});
test('static assets no longer ship unverified raster avatars or reference them', () => {
  assert.ok(readdirSync(directory).every(file => file.endsWith('.svg')));
  const html = readFileSync(new URL('../app/static/index.html',import.meta.url),'utf8');
  assert.doesNotMatch(html,/\/avatars\/[^"\s]+\.(?:png|jpg|webp)/);
  assert.ok(html.indexOf('/static/avatar-catalog.js') < html.indexOf('/static/app.js'));
});
