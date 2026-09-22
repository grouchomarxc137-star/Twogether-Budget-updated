import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { configureStateStore, getState, runAction } from '../src/core.js';
import { openDatabase } from '../src/db/index.js';
import { deriveTrip } from '../../shared/trips-model.js';

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'twogether-lifecycle-'));
  const database = openDatabase(join(directory, 'test.sqlite'));
  configureStateStore(database.store);
  const act = (name, payload, actor = 'Principessa') => database.db.transaction(() => runAction(name, payload, actor))();
  const snapshot = () => JSON.stringify(database.db.prepare('SELECT key, json FROM app_state ORDER BY key').all())
    + JSON.stringify(database.db.prepare('SELECT id, json FROM trip_ledger ORDER BY id').all());
  return { act, snapshot, cleanup() { database.close(); rmSync(directory, { recursive: true, force: true }); } };
}

const trip = () => getState().tripLedger.find((t) => t.id === 'trip-1');
const events = () => trip().lifecycle.map((e) => `${e.event}:${e.by}`);

function newTrip(act) {
  const r = act('tripCreate', { trip: { id: 'trip-1', city: 'Amsterdam', start: '2026-09-20', end: '2026-09-27' }, budget: '900' });
  assert.equal(r.ok, true, r.error);
  // One shared cost Principessa paid, so Principe owes her €50.
  const e = act('tripExpenseSave', { tripId: 'trip-1', expense: { id: 'e1', amount: 10000, category: 'eating-out', date: '2026-09-21' } });
  assert.equal(e.ok, true, e.error);
  return trip();
}

// ---------------------------------------------------------------- transitions

test('close sets closedAt/closedBy, bumps the revision once and appends one event', () => {
  const ctx = setup();
  try {
    const before = newTrip(ctx.act);
    const r = ctx.act('tripClose', { tripId: 'trip-1', rev: before.rev }, 'Principe');
    assert.equal(r.ok, true, r.error);
    assert.equal(r.duplicate, undefined);
    const t = trip();
    assert.ok(t.closedAt);
    assert.equal(t.closedBy, 'Principe');
    assert.equal(t.rev, before.rev + 1);
    assert.deepEqual(events(), ['created:Principessa', 'closed:Principe']);
    assert.equal(deriveTrip(t, { today: '2026-09-22' }).group, 'past');
  } finally { ctx.cleanup(); }
});

test('reopen clears the current close but keeps the history; reclose appends again', () => {
  const ctx = setup();
  try {
    newTrip(ctx.act);
    ctx.act('tripClose', { tripId: 'trip-1', rev: trip().rev });
    const closedRev = trip().rev;
    const r = ctx.act('tripReopen', { tripId: 'trip-1', rev: closedRev }, 'Principe');
    assert.equal(r.ok, true, r.error);
    assert.equal(trip().closedAt, '');
    assert.equal(trip().closedBy, '');
    assert.equal(trip().rev, closedRev + 1);
    assert.equal(ctx.act('tripClose', { tripId: 'trip-1', rev: trip().rev }, 'Principe').ok, true);
    assert.deepEqual(events(), ['created:Principessa', 'closed:Principessa', 'reopened:Principe', 'closed:Principe']);
    assert.equal(trip().closedBy, 'Principe');
  } finally { ctx.cleanup(); }
});

test('close and reopen need a revision and an existing trip', () => {
  const ctx = setup();
  try {
    newTrip(ctx.act);
    const before = ctx.snapshot();
    assert.equal(ctx.act('tripClose', { tripId: 'trip-1' }).ok, false);
    assert.equal(ctx.act('tripClose', { tripId: 'trip-1', rev: 'x' }).ok, false);
    assert.equal(ctx.act('tripClose', { tripId: 'nope', rev: 1 }).code, 'NOT_FOUND');
    assert.equal(ctx.act('tripReopen', { tripId: 'trip-1' }).ok, false);
    assert.equal(ctx.snapshot(), before);
  } finally { ctx.cleanup(); }
});

// Dates far from the real clock, so these do not depend on when tests run.
function tripWithDates(act, id, start, end) {
  const r = act('tripCreate', { trip: { id, city: 'Somewhere', start, end } });
  assert.equal(r.ok, true, r.error);
  return r.trip;
}
const tripById = (id) => getState().tripLedger.find((t) => t.id === id);

test('the server refuses to close a trip that has not started, and nothing changes', () => {
  const ctx = setup();
  try {
    const upcoming = tripWithDates(ctx.act, 'future', '2099-06-01', '2099-06-10');
    const before = ctx.snapshot();
    const r = ctx.act('tripClose', { tripId: 'future', rev: upcoming.rev }, 'Principe');
    assert.equal(r.ok, false);
    assert.equal(r.code, 'TRIP_NOT_STARTED');
    assert.equal(ctx.snapshot(), before, 'storage unchanged');
    const t = tripById('future');
    assert.equal(t.closedAt, '');
    assert.equal(t.rev, upcoming.rev);
    assert.deepEqual(t.lifecycle.map((e) => e.event), ['created']);
  } finally { ctx.cleanup(); }
});

test('ongoing and ended-but-open trips can both be closed', () => {
  const ctx = setup();
  try {
    const today = new Date().toISOString().slice(0, 10);
    const ongoing = tripWithDates(ctx.act, 'ongoing', '2000-01-01', '2099-12-31');
    const ended = tripWithDates(ctx.act, 'ended', '2000-01-01', '2000-01-05');
    assert.ok(today > '2000-01-05' && today < '2099-12-31');
    assert.equal(ctx.act('tripClose', { tripId: 'ongoing', rev: ongoing.rev }).ok, true);
    assert.equal(ctx.act('tripClose', { tripId: 'ended', rev: ended.rev }).ok, true);
    assert.ok(tripById('ongoing').closedAt);
    assert.ok(tripById('ended').closedAt);
  } finally { ctx.cleanup(); }
});

// ---------------------------------------------------------------- duplicate intent vs stale

test('both phones press Close on the same revision: one close, one event, both succeed', () => {
  const ctx = setup();
  try {
    const rev = newTrip(ctx.act).rev;
    const first = ctx.act('tripClose', { tripId: 'trip-1', rev }, 'Principessa');
    assert.equal(first.ok, true);
    const after = ctx.snapshot();
    const second = ctx.act('tripClose', { tripId: 'trip-1', rev }, 'Principe');
    assert.equal(second.ok, true, second.error);
    assert.equal(second.duplicate, true);
    assert.equal(second.trip.closedBy, 'Principessa');
    assert.equal(ctx.snapshot(), after, 'the duplicate changes nothing in storage');
    assert.equal(trip().rev, rev + 1);
    assert.deepEqual(events(), ['created:Principessa', 'closed:Principessa']);
    // A plain retry of the same request is also a no-op.
    assert.equal(ctx.act('tripClose', { tripId: 'trip-1', rev }, 'Principessa').duplicate, true);
    assert.equal(ctx.snapshot(), after);
  } finally { ctx.cleanup(); }
});

test('both phones press Reopen on the same revision: one reopen, one event', () => {
  const ctx = setup();
  try {
    newTrip(ctx.act);
    ctx.act('tripClose', { tripId: 'trip-1', rev: trip().rev });
    const rev = trip().rev;
    assert.equal(ctx.act('tripReopen', { tripId: 'trip-1', rev }, 'Principe').ok, true);
    const after = ctx.snapshot();
    const second = ctx.act('tripReopen', { tripId: 'trip-1', rev }, 'Principessa');
    assert.equal(second.ok, true, second.error);
    assert.equal(second.duplicate, true);
    assert.equal(ctx.snapshot(), after);
    assert.deepEqual(events(), ['created:Principessa', 'closed:Principessa', 'reopened:Principe']);
  } finally { ctx.cleanup(); }
});

test('a stale Close fails when the trip changed for another reason and is still open', () => {
  const ctx = setup();
  try {
    const rev = newTrip(ctx.act).rev;
    assert.equal(ctx.act('tripSetBudget', { tripId: 'trip-1', rev, amount: '800' }, 'Principe').ok, true);
    const before = ctx.snapshot();
    const r = ctx.act('tripClose', { tripId: 'trip-1', rev }, 'Principessa');
    assert.equal(r.ok, false);
    assert.equal(r.code, 'STALE');
    assert.equal(ctx.snapshot(), before);
    assert.equal(trip().closedAt, '');
  } finally { ctx.cleanup(); }
});

test('a Close based on a version from before a close+reopen fails as stale', () => {
  const ctx = setup();
  try {
    const rev = newTrip(ctx.act).rev;
    ctx.act('tripClose', { tripId: 'trip-1', rev }, 'Principessa');
    ctx.act('tripReopen', { tripId: 'trip-1', rev: rev + 1 }, 'Principe');
    // The trip is open again; an old Close must not silently re-close it.
    assert.equal(ctx.act('tripClose', { tripId: 'trip-1', rev }, 'Principessa').code, 'STALE');
    assert.equal(trip().closedAt, '');
  } finally { ctx.cleanup(); }
});

test('a stale Reopen fails when the trip is still closed', () => {
  const ctx = setup();
  try {
    newTrip(ctx.act);
    const openRev = trip().rev;
    ctx.act('tripClose', { tripId: 'trip-1', rev: openRev });
    // Based on the version before the close: the trip is closed, so this is
    // not a duplicate of anything and must fail.
    assert.equal(ctx.act('tripReopen', { tripId: 'trip-1', rev: openRev }, 'Principe').code, 'STALE');
    assert.ok(trip().closedAt);
  } finally { ctx.cleanup(); }
});

// ---------------------------------------------------------------- closed-trip restrictions

test('a closed trip rejects trip, budget and expense changes, and storage is untouched', () => {
  const ctx = setup();
  try {
    newTrip(ctx.act);
    ctx.act('tripClose', { tripId: 'trip-1', rev: trip().rev });
    const rev = trip().rev;
    const before = ctx.snapshot();
    const attempts = [
      ['tripUpdate', { tripId: 'trip-1', rev, city: 'Rome', start: '2026-09-20', end: '2026-09-27' }],
      ['tripSetBudget', { tripId: 'trip-1', rev, amount: '100' }],
      ['tripExpenseSave', { tripId: 'trip-1', expense: { id: 'e2', amount: 500, category: 'other' } }],
      ['tripExpenseSave', { tripId: 'trip-1', expense: { id: 'e1', rev: 1, amount: 500, category: 'other' } }],
      ['tripExpenseDelete', { tripId: 'trip-1', expenseId: 'e1', rev: 1 }],
    ];
    for (const [action, payload] of attempts) {
      const r = ctx.act(action, payload, 'Principe');
      assert.equal(r.ok, false, action);
      assert.equal(r.code, 'TRIP_CLOSED', action);
    }
    assert.equal(ctx.snapshot(), before);
  } finally { ctx.cleanup(); }
});

test('an expense deleted before the close cannot be restored while closed', () => {
  const ctx = setup();
  try {
    newTrip(ctx.act);
    const del = ctx.act('tripExpenseDelete', { tripId: 'trip-1', expenseId: 'e1', rev: 1 });
    ctx.act('tripClose', { tripId: 'trip-1', rev: trip().rev });
    assert.equal(ctx.act('tripExpenseRestore', { tripId: 'trip-1', expenseId: 'e1', rev: del.expense.rev }).code, 'TRIP_CLOSED');
    ctx.act('tripReopen', { tripId: 'trip-1', rev: trip().rev });
    assert.equal(ctx.act('tripExpenseRestore', { tripId: 'trip-1', expenseId: 'e1', rev: del.expense.rev }).ok, true);
  } finally { ctx.cleanup(); }
});

test('repayments stay available on a closed trip and settle the balance', () => {
  const ctx = setup();
  try {
    newTrip(ctx.act);
    ctx.act('tripClose', { tripId: 'trip-1', rev: trip().rev });
    const closedRev = trip().rev;
    assert.equal(deriveTrip(trip()).owed, 5000);
    const s = ctx.act('tripSettlementSave', { tripId: 'trip-1', settlement: { id: 's1', from: 'Principe', to: 'Principessa', amount: 5000, allocationMode: 'auto' } }, 'Principe');
    assert.equal(s.ok, true, s.error);
    assert.equal(deriveTrip(trip()).net, 0);
    const del = ctx.act('tripSettlementDelete', { tripId: 'trip-1', settlementId: 's1', rev: s.settlement.rev }, 'Principe');
    assert.equal(del.ok, true, del.error);
    assert.equal(ctx.act('tripSettlementRestore', { tripId: 'trip-1', settlementId: 's1', rev: del.settlement.rev }).ok, true);
    // Still closed, and repayments do not change the trip revision.
    assert.ok(trip().closedAt);
    assert.equal(trip().rev, closedRev);
    // So a Reopen based on the closed version still works.
    assert.equal(ctx.act('tripReopen', { tripId: 'trip-1', rev: closedRev }).ok, true);
  } finally { ctx.cleanup(); }
});

test('reopening allows expenses and edits again', () => {
  const ctx = setup();
  try {
    newTrip(ctx.act);
    ctx.act('tripClose', { tripId: 'trip-1', rev: trip().rev });
    ctx.act('tripReopen', { tripId: 'trip-1', rev: trip().rev });
    assert.equal(ctx.act('tripExpenseSave', { tripId: 'trip-1', expense: { id: 'e2', amount: 500, category: 'other' } }).ok, true);
    assert.equal(ctx.act('tripUpdate', { tripId: 'trip-1', rev: trip().rev, city: 'Rome', start: '2026-09-20', end: '2026-09-27' }).ok, true);
    assert.equal(trip().place.city, 'Rome');
  } finally { ctx.cleanup(); }
});
