import test from 'node:test';
import assert from 'node:assert/strict';
import { safePercent, getFileType, filterAndSortFiles, paginate, formatStorageAmount, isUnlimitedStorage } from '../dash/dashboard-utils.js';

test('safePercent handles invalid and bounded values', () => {
  assert.equal(safePercent(0, 0), 0);
  assert.equal(safePercent(50, 100), 50);
  assert.equal(safePercent(150, 100), 100);
  assert.equal(safePercent(-10, 100), 0);
});

test('getFileType categorizes common extensions', () => {
  assert.equal(getFileType('photo.JPG'), 'image');
  assert.equal(getFileType('doc.pdf'), 'pdf');
  assert.equal(getFileType('clip.mp4'), 'video');
  assert.equal(getFileType('song.mp3'), 'audio');
  assert.equal(getFileType('archive.zip'), 'archive');
  assert.equal(getFileType('unknown.bin'), 'other');
});

test('filterAndSortFiles filters by query/type and sorts by size', () => {
  const files = [
    { name: 'b.mp4', size: 300, uploaded_at: '2026-01-01T00:00:00Z' },
    { name: 'a.jpg', size: 100, uploaded_at: '2026-01-02T00:00:00Z' },
    { name: 'c.jpg', size: 200, uploaded_at: '2026-01-03T00:00:00Z' },
  ];

  const out = filterAndSortFiles(files, { query: '.jpg', type: 'image', sortBy: 'size_desc' });
  assert.equal(out.length, 2);
  assert.equal(out[0].name, 'c.jpg');
  assert.equal(out[1].name, 'a.jpg');
});

test('paginate returns stable page metadata', () => {
  const items = Array.from({ length: 25 }, (_, i) => i + 1);
  const p = paginate(items, 3, 10);
  assert.equal(p.page, 3);
  assert.equal(p.pages, 3);
  assert.deepEqual(p.items, [21, 22, 23, 24, 25]);
});

test('formatStorageAmount formats binary units and unlimited', () => {
  assert.equal(formatStorageAmount(1024 ** 4), '1.00 TB');
  assert.equal(formatStorageAmount(1024 ** 3), '1.00 GB');
  assert.equal(formatStorageAmount(1024 ** 2), '1.00 MB');
  assert.equal(formatStorageAmount(1024), '1.00 KB');
  assert.equal(formatStorageAmount(-1), 'Unlimited');
  assert.equal(isUnlimitedStorage(-1), true);
});
