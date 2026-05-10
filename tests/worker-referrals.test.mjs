import test from 'node:test';
import assert from 'node:assert/strict';
import { __testables } from '../worker.js';

test('safeJson handles invalid payloads', () => {
  assert.deepEqual(__testables.safeJson('{"ok":true}'), { ok: true });
  assert.equal(__testables.safeJson('nope'), null);
});

test('enc safely URL-encodes strings', () => {
  assert.equal(__testables.enc('A B+C'), 'A%20B%2BC');
});
