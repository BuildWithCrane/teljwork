import test from 'node:test';
import assert from 'node:assert/strict';
import { __testables } from '../worker.js';

test('safeJson handles invalid payloads', () => {
  assert.deepEqual(__testables.safeJson('{"ok":true}'), { ok: true });
  assert.equal(__testables.safeJson('nope'), null);
});

test('enc safely URL-encodes strings', () => {
  assert.equal(__testables.enc('A B+C'), 'A%20B%2BC');
  assert.equal(__testables.enc('50% & café'), '50%25%20%26%20caf%C3%A9');
});

test('parseStorageCapBytes converts GB and rejects invalid limits', () => {
  assert.equal(__testables.parseStorageCapBytes({ storageCapGb: 1.5 }), 1610612736);
  assert.equal(__testables.parseStorageCapBytes({ storageCapBytes: 2048 }), 2048);
  assert.equal(__testables.parseStorageCapBytes({ storageCapUnlimited: true }), -1);
  assert.equal(__testables.parseStorageCapBytes({ storageCap: 'unlimited' }), -1);
  assert.equal(__testables.parseStorageCapBytes({ storageCapGb: -1 }), null);
  assert.equal(__testables.parseStorageCapBytes({}), null);
});

test('safeEqual compares values in a stable way', () => {
  assert.equal(__testables.safeEqual('secret', 'secret'), true);
  assert.equal(__testables.safeEqual('secret', 'secret2'), false);
  assert.equal(__testables.safeEqual('abc', 'abd'), false);
});

test('isPreviewableImageFile gates inline previews to images', () => {
  assert.equal(__testables.isPreviewableImageFile({ name: 'photo.jpg', type: 'image/jpeg' }), true);
  assert.equal(__testables.isPreviewableImageFile({ name: 'legacy.webp', type: '' }), true);
  assert.equal(__testables.isPreviewableImageFile({ name: 'camera-roll.png', type: 'application/octet-stream' }), true);
  assert.equal(__testables.isPreviewableImageFile({ name: 'doc.pdf', type: 'application/pdf' }), false);
  assert.equal(__testables.isPreviewableImageFile({ name: 'clip.mp4', type: 'video/mp4' }), false);
});
