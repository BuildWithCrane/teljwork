import test from 'node:test';
import assert from 'node:assert/strict';
import { __testables } from '../worker.js';

test('buildReferralMilestones marks reached milestones', () => {
  const rows = __testables.buildReferralMilestones(4);
  assert.equal(rows.find((r) => r.required_referrals === 1)?.reached, true);
  assert.equal(rows.find((r) => r.required_referrals === 3)?.reached, true);
  assert.equal(rows.find((r) => r.required_referrals === 5)?.reached, false);
});

test('safeJson handles invalid payloads', () => {
  assert.deepEqual(__testables.safeJson('{"ok":true}'), { ok: true });
  assert.equal(__testables.safeJson('nope'), null);
});

test('enc safely URL-encodes strings', () => {
  assert.equal(__testables.enc('A B+C'), 'A%20B%2BC');
});
