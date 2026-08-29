import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_STATUS_IDS,
  adjustTotal,
  applyClear,
  applyToggle,
  buildStatusParams,
  chunkIds,
  collectPendingIds,
  emptyStatus,
  mergeStatus,
  normalizeCourseId,
  readSavedTotal,
  readStatusIds,
} from './bookmarkStatus.js';

const ids = (...values) => new Set(values);

// -- id normalisation --------------------------------------------------------

test('a plain id is trimmed and kept', () => {
  assert.equal(normalizeCourseId('  abc123  '), 'abc123');
});

test('a populated row is read through _id, then id', () => {
  assert.equal(normalizeCourseId({ _id: 'abc' }), 'abc');
  assert.equal(normalizeCourseId({ id: 'def' }), 'def');
  assert.equal(normalizeCourseId({ _id: { id: 'nested' } }), 'nested');
});

test('an ObjectId-like object is read through its toString', () => {
  const objectId = { toString: () => '507f1f77bcf86cd799439011' };

  assert.equal(normalizeCourseId(objectId), '507f1f77bcf86cd799439011');
});

test('anything without a usable id comes back empty rather than as "undefined"', () => {
  assert.equal(normalizeCourseId(null), '');
  assert.equal(normalizeCourseId(undefined), '');
  assert.equal(normalizeCourseId({}), '');
  assert.equal(normalizeCourseId('   '), '');
});

// -- deciding what to ask ----------------------------------------------------

test('an id nobody has asked about yet is pending', () => {
  assert.deepEqual(collectPendingIds(['a', 'b']), ['a', 'b']);
});

test('an id whose answer is already known is not asked about again', () => {
  assert.deepEqual(
    collectPendingIds(['a', 'b'], { resolved: ids('a') }),
    ['b'],
  );
});

// The bug this whole module exists for: "we know it is not saved" and "we have
// never asked" have to be different states. Only the first suppresses a lookup.
test('an id known to be unsaved is resolved, so it is not re-requested', () => {
  const state = mergeStatus(emptyStatus(), {
    requested: ['a', 'b'],
    saved: ['a'],
  });

  assert.equal(state.saved.has('b'), false);
  assert.equal(state.resolved.has('b'), true);
  assert.deepEqual(collectPendingIds(['b'], { resolved: state.resolved }), []);
});

test('an id already in flight is not requested twice', () => {
  assert.deepEqual(
    collectPendingIds(['a', 'b'], { inFlight: ids('b') }),
    ['a'],
  );
});

test('repeats within one call collapse, and order is kept', () => {
  assert.deepEqual(collectPendingIds(['b', 'a', 'b', 'a']), ['b', 'a']);
});

test('unusable entries are dropped instead of being asked about', () => {
  assert.deepEqual(collectPendingIds(['a', null, {}, '  ', 'b']), ['a', 'b']);
});

test('a non-array request list is not an error', () => {
  assert.deepEqual(collectPendingIds(undefined), []);
  assert.deepEqual(collectPendingIds('a'), []);
});

// -- batching ----------------------------------------------------------------

test('a list within the cap is one batch', () => {
  assert.deepEqual(chunkIds(['a', 'b', 'c']), [['a', 'b', 'c']]);
});

// The endpoint rejects more than a hundred ids outright, so the tail of a long
// list would silently render as unsaved if it were sent in one request.
test('a list over the cap is split rather than sent whole', () => {
  const many = Array.from({ length: MAX_STATUS_IDS + 5 }, (_, i) => `id-${i}`);
  const batches = chunkIds(many);

  assert.equal(batches.length, 2);
  assert.equal(batches[0].length, MAX_STATUS_IDS);
  assert.equal(batches[1].length, 5);
  assert.equal(batches.flat().length, many.length);
});

test('an empty list produces no batches at all', () => {
  assert.deepEqual(chunkIds([]), []);
  assert.deepEqual(chunkIds(undefined), []);
});

// -- the request -------------------------------------------------------------

test('the query joins the ids the way the endpoint parses them', () => {
  assert.deepEqual(buildStatusParams(['a', 'b']), { courseIds: 'a,b' });
});

test('there is no request to make for an empty or unusable list', () => {
  assert.equal(buildStatusParams([]), null);
  assert.equal(buildStatusParams(['', null]), null);
  assert.equal(buildStatusParams(undefined), null);
});

// -- the reply ---------------------------------------------------------------

test('the saved ids are read out of the response body', () => {
  assert.deepEqual(readStatusIds({ data: ['a', 'b'], count: 2 }), ['a', 'b']);
});

test('a failed or malformed body reads as no saved ids, not as a crash', () => {
  assert.deepEqual(readStatusIds(undefined), []);
  assert.deepEqual(readStatusIds({ success: false }), []);
  assert.deepEqual(readStatusIds({ data: 'a,b' }), []);
});

test('the total comes from the pagination block the server already sends', () => {
  assert.equal(readSavedTotal({ pagination: { totalItems: 137 } }), 137);
});

test('a missing total is null, so the previous count is kept rather than zeroed', () => {
  assert.equal(readSavedTotal({}), null);
  assert.equal(readSavedTotal({ pagination: { totalItems: 'many' } }), null);
  assert.equal(readSavedTotal({ pagination: { totalItems: -3 } }), null);
});

// -- folding answers in ------------------------------------------------------

test('ids the server returned are saved and resolved', () => {
  const state = mergeStatus(emptyStatus(), {
    requested: ['a', 'b'],
    saved: ['a'],
  });

  assert.deepEqual([...state.saved], ['a']);
  assert.deepEqual([...state.resolved].sort(), ['a', 'b']);
});

test('an id that was saved and is no longer returned stops being saved', () => {
  const first = mergeStatus(emptyStatus(), { requested: ['a'], saved: ['a'] });
  const second = mergeStatus(first, { requested: ['a'], saved: [] });

  assert.equal(second.saved.has('a'), false);
  assert.equal(second.resolved.has('a'), true);
});

test('answers accumulate across batches instead of replacing each other', () => {
  const first = mergeStatus(emptyStatus(), { requested: ['a'], saved: ['a'] });
  const second = mergeStatus(first, { requested: ['b'], saved: ['b'] });

  assert.deepEqual([...second.saved].sort(), ['a', 'b']);
});

test('merging returns a new state rather than mutating the old one', () => {
  const before = mergeStatus(emptyStatus(), { requested: ['a'], saved: ['a'] });
  const after = mergeStatus(before, { requested: ['b'], saved: ['b'] });

  assert.equal(before.saved.has('b'), false);
  assert.notEqual(before.saved, after.saved);
});

// -- local changes -----------------------------------------------------------

test('toggling on marks the course saved and answered', () => {
  const state = applyToggle(emptyStatus(), 'a', true);

  assert.equal(state.saved.has('a'), true);
  assert.equal(state.resolved.has('a'), true);
});

// The old provider could not do this: an id outside the first page of the
// wishlist was indistinguishable from an unsaved one, so the remove never fired.
test('toggling off removes the course but keeps the answer', () => {
  const saved = mergeStatus(emptyStatus(), { requested: ['a'], saved: ['a'] });
  const state = applyToggle(saved, 'a', false);

  assert.equal(state.saved.has('a'), false);
  assert.equal(state.resolved.has('a'), true);
});

test('an unusable id leaves the state exactly as it was', () => {
  const state = emptyStatus();

  assert.equal(applyToggle(state, '', true), state);
  assert.equal(applyToggle(state, null, true), state);
});

test('clearing empties the saved set and keeps every answer', () => {
  const saved = mergeStatus(emptyStatus(), {
    requested: ['a', 'b'],
    saved: ['a', 'b'],
  });
  const state = applyClear(saved);

  assert.equal(state.saved.size, 0);
  assert.deepEqual([...state.resolved].sort(), ['a', 'b']);
  assert.deepEqual(collectPendingIds(['a'], { resolved: state.resolved }), []);
});

// -- the count ---------------------------------------------------------------

test('the total moves with a save and a removal', () => {
  assert.equal(adjustTotal(12, 1), 13);
  assert.equal(adjustTotal(12, -1), 11);
});

test('the total never goes negative', () => {
  assert.equal(adjustTotal(0, -1), 0);
  assert.equal(adjustTotal(-5, -1), 0);
});

test('an unusable total is treated as zero rather than as NaN', () => {
  assert.equal(adjustTotal(undefined, 1), 1);
  assert.equal(adjustTotal('twelve', 1), 1);
  assert.equal(adjustTotal(12, undefined), 12);
});
