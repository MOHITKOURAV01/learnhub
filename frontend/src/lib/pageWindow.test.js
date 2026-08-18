import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPageWindow } from './catalogQuery.js';

// The component itself needs a DOM to render, but the part that decides which
// page numbers to show is plain arithmetic and worth pinning down: an off-by-one
// here means an unreachable page, which is the bug this whole change is about.

test('a short catalogue lists every page', () => {
  assert.deepEqual(buildPageWindow(1, 1), [1]);
  assert.deepEqual(buildPageWindow(3, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(buildPageWindow(4, 7), [1, 2, 3, 4, 5, 6, 7]);
});

test('a long catalogue keeps the first, last and current pages reachable', () => {
  assert.deepEqual(buildPageWindow(5, 20), [1, 'gap', 4, 5, 6, 'gap', 20]);
});

test('there is no gap where the pages are already adjacent', () => {
  assert.deepEqual(buildPageWindow(2, 20), [1, 2, 3, 'gap', 20]);
  assert.deepEqual(buildPageWindow(19, 20), [1, 'gap', 18, 19, 20]);
});

test('the first and last pages do not duplicate themselves', () => {
  assert.deepEqual(buildPageWindow(1, 20), [1, 2, 'gap', 20]);
  assert.deepEqual(buildPageWindow(20, 20), [1, 'gap', 19, 20]);
});

test('every entry is either a page number or a gap', () => {
  for (let total = 1; total <= 25; total += 1) {
    for (let page = 1; page <= total; page += 1) {
      const window = buildPageWindow(page, total);

      assert.ok(window.includes(page), `page ${page} of ${total} is not reachable`);
      assert.ok(window.includes(1), `page 1 is missing at ${page}/${total}`);
      assert.ok(window.includes(total), `last page is missing at ${page}/${total}`);

      for (const entry of window) {
        assert.ok(
          entry === 'gap' || (Number.isInteger(entry) && entry >= 1 && entry <= total),
          `unexpected entry ${entry} at ${page}/${total}`,
        );
      }
    }
  }
});
