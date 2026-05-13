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

test('payment helpers normalize currency and hash input', () => {
  assert.equal(__testables.normalizePaymentCurrency(' btc '), 'BTC');
  assert.equal(__testables.normalizePaymentCurrency('doge'), '');
  assert.equal(__testables.normalizeTransactionHash('  abc123  '), 'abc123');
});

test('resolveTierConfig uses defaults and validates unknown tiers', () => {
  const pro = __testables.resolveTierConfig({}, 'Pro');
  assert.equal(pro.name, 'pro');
  assert.equal(pro.priceEur, 1.99);
  assert.equal(pro.storageLimit, 250 * 1073741824);
  assert.equal(__testables.resolveTierConfig({}, 'unknown'), null);
});

test('resolveTierConfig supports PAYMENT_TIER_CONFIG overrides', () => {
  const env = {
    PAYMENT_TIER_CONFIG: JSON.stringify({
      gold: { priceEur: 7.5, storageLimit: 777 },
    }),
  };
  const gold = __testables.resolveTierConfig(env, 'gold');
  assert.deepEqual(gold, { name: 'gold', priceEur: 7.5, storageLimit: 777 });
});

test('BTC and LTC amount helpers sum outputs to configured wallet', () => {
  const btcWallet = 'bc1qy0rc5kq9wacgzau7f92wu8ch5ye0aet7c6urhc';
  const ltcWallet = 'ltc1q9casldmsejj9pxsqd5c0222htkq6xqvhvmqnhr';
  const btcAmount = __testables.getBtcReceivedAmount({
    vout: [
      { scriptpubkey_address: btcWallet, value: 120000 },
      { scriptpubkey_address: btcWallet, value: 30000 },
      { scriptpubkey_address: 'bc1qother', value: 50000 },
    ],
  }, btcWallet);
  assert.ok(Math.abs(btcAmount - 0.0015) < 1e-12);

  const ltcAmount = __testables.getLtcReceivedAmount({
    data: {
      hash123: {
        outputs: [
          { recipient: ltcWallet, value: 1000000 },
          { recipient: ltcWallet.toUpperCase(), value: 2000000 },
          { recipient: 'ltc1qother', value: 3000000 },
        ],
      },
    },
  }, 'hash123', ltcWallet);
  assert.ok(Math.abs(ltcAmount - 0.03) < 1e-12);
});
