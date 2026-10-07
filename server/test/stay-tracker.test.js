import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { configureStateStore, getState, runAction } from '../src/core.js';
import { openDatabase } from '../src/db/index.js';

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'twogether-stays-'));
  const database = openDatabase(join(directory, 'test.sqlite'));
  configureStateStore(database.store);
  return { database, cleanup() { database.close(); rmSync(directory, { recursive:true, force:true }); } };
}
function action(database, name, payload, actor = 'Principessa') {
  return database.db.transaction(() => runAction(name, payload, actor))();
}

test('Italy plans can be saved with dates before the city is known', () => {
  const context = setup();
  try {
    const created = action(context.database, 'savePlan', {
      meta:{ location:'Italy', city:'', start:'2099-06-10', end:'2099-06-17' },
      budget:'',
    });
    assert.equal(created.ok, true);
    const plan = getState().plans.find((item) => item.id === created.planId);
    assert.equal(plan.meta.location, 'Italy');
    assert.equal(plan.meta.city, '');
  } finally { context.cleanup(); }
});

test('stay tracker snapshots are stored on the plan and keep price changes', () => {
  const context = setup();
  try {
    const created = action(context.database, 'savePlan', {
      meta:{ location:'Italy', city:'', start:'2099-06-10', end:'2099-06-17' },
      budget:'',
    });
    assert.equal(action(context.database, 'saveStayTrackerSnapshot', {
      planId:created.planId, area:'lake-garda',
      results:[{ accommodationId:'123', name:'Lake House', price:700, currency:'EUR', url:'https://booking.example/123', checkedAt:'2099-01-01T10:00:00.000Z' }],
    }).ok, true);
    assert.equal(action(context.database, 'saveStayTrackerSnapshot', {
      planId:created.planId, area:'lake-garda',
      results:[{ accommodationId:'123', name:'Lake House', price:650, currency:'EUR', url:'https://booking.example/123', checkedAt:'2099-01-02T10:00:00.000Z' }],
    }).ok, true);
    const plan = getState().plans.find((item) => item.id === created.planId);
    assert.equal(plan.stayTracker.area, 'lake-garda');
    assert.equal(plan.stayTracker.history.length, 2);
    assert.deepEqual(plan.stayTracker.history.map((item) => item.price), [700,650]);
  } finally { context.cleanup(); }
});
