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

test('isPreviewableMediaFile gates inline previews to images and videos', () => {
  assert.equal(__testables.isPreviewableMediaFile({ name: 'photo.jpg', type: 'image/jpeg' }), true);
  assert.equal(__testables.isPreviewableMediaFile({ name: 'legacy.webp', type: '' }), true);
  assert.equal(__testables.isPreviewableMediaFile({ name: 'camera-roll.png', type: 'application/octet-stream' }), true);
  assert.equal(__testables.isPreviewableMediaFile({ name: 'clip.mp4', type: 'video/mp4' }), true);
  assert.equal(__testables.isPreviewableMediaFile({ name: 'recording.webm', type: '' }), true);
  assert.equal(__testables.isPreviewableMediaFile({ name: 'doc.pdf', type: 'application/pdf' }), false);
});

test('guessPreviewContentType resolves media types from extensions', () => {
  assert.equal(__testables.guessPreviewContentType('photo.JPG'), 'image/jpeg');
  assert.equal(__testables.guessPreviewContentType('clip.mp4'), 'video/mp4');
  assert.equal(__testables.guessPreviewContentType('movie.mkv'), 'video/x-matroska');
  assert.equal(__testables.guessPreviewContentType('doc.pdf'), '');
});

test('isPreviewContentType allows only image and video mime types', () => {
  assert.equal(__testables.isPreviewContentType('image/png'), true);
  assert.equal(__testables.isPreviewContentType('video/webm'), true);
  assert.equal(__testables.isPreviewContentType('application/octet-stream'), false);
  assert.equal(__testables.isPreviewContentType('application/pdf'), false);
});
