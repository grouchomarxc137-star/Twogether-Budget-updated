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


test('stay search preferences and favourites persist and can be repriced for a later trip', () => {
  const context = setup();
  try {
    const first = action(context.database, 'savePlan', {
      meta:{ location:'Italy', city:'Desenzano del Garda', start:'2099-06-10', end:'2099-06-17' }, budget:'',
    });
    const second = action(context.database, 'savePlan', {
      meta:{ location:'Italy', city:'Lonato del Garda', start:'2099-09-03', end:'2099-09-08' }, budget:'',
    });
    assert.equal(action(context.database, 'saveStaySearchPreferences', {
      planId:first.planId, area:'lake-garda',
      preferences:{ maxTotal:900, parking:true, washingMachine:true, entirePlace:true, bedrooms:1 },
    }).ok, true);
    const saved = action(context.database, 'saveStayFavorite', {
      planId:first.planId, price:700, checkedAt:'2099-01-01T10:00:00.000Z',
      favorite:{
        source:'airbnb', url:'https://www.airbnb.com/rooms/12345?check_in=2099-06-10',
        name:'Casa sul Garda', city:'Desenzano del Garda', area:'lake-garda',
      },
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.favorite.history.length, 1);
    assert.equal(saved.favorite.history[0].start, '2099-06-10');

    const repriced = action(context.database, 'updateStayFavoritePrice', {
      ownerPlanId:saved.ownerPlanId, favoriteId:saved.favorite.id, contextPlanId:second.planId,
      price:625, checkedAt:'2099-02-01T10:00:00.000Z',
    });
    assert.equal(repriced.ok, true);

    const owner = getState().plans.find((plan) => plan.id === saved.ownerPlanId);
    const favorite = owner.stayTracker.saved.find((item) => item.id === saved.favorite.id);
    assert.equal(owner.stayTracker.preferences.parking, true);
    assert.equal(owner.stayTracker.preferences.washingMachine, true);
    assert.deepEqual(favorite.history.map((item) => item.price), [700,625]);
    assert.equal(favorite.history[1].start, '2099-09-03');
    assert.equal(favorite.url, 'https://www.airbnb.com/rooms/12345?check_in=2099-06-10');
  } finally { context.cleanup(); }
});


test('selecting a saved stay logs an editable shared accommodation expense and blocks duplicates', () => {
  const context = setup();
  try {
    const trip = action(context.database, 'savePlan', {
      meta:{ location:'Italy', city:'Lonato del Garda', start:'2099-10-10', end:'2099-10-13' }, budget:'',
    });
    const saved = action(context.database, 'saveStayFavorite', {
      planId:trip.planId, price:540, checkedAt:'2099-03-01T10:00:00.000Z',
      favorite:{source:'airbnb',url:'https://www.airbnb.it/rooms/12345',name:'Casa Bella',image:'https://example.com/photo.jpg',note:'Nice balcony'},
    });
    const selected = action(context.database, 'selectStayForTrip', {
      planId:trip.planId, ownerPlanId:saved.ownerPlanId, favoriteId:saved.favorite.id,
    });
    assert.equal(selected.ok, true);
    const plan = getState().plans.find((item) => item.id === trip.planId);
    assert.equal(plan.sharedExpenses.accom.total, 540);
    assert.equal(plan.sharedExpenses.accom.accommodation.useJar, false);
    assert.equal(plan.sharedExpenses.accom.accommodation.paymentType, 'shared');
    assert.equal(plan.stayTracker.selected.favoriteId, saved.favorite.id);

    const duplicate = action(context.database, 'selectStayForTrip', {
      planId:trip.planId, ownerPlanId:saved.ownerPlanId, favoriteId:saved.favorite.id,
    });
    assert.equal(duplicate.ok, false);
    assert.match(duplicate.error, /already has an accommodation expense/i);
  } finally { context.cleanup(); }
});


test('saved stay notes can be edited and removing the stay preserves any logged accommodation expense', () => {
  const context = setup();
  try {
    const trip = action(context.database, 'savePlan', {
      meta:{ location:'Italy', city:'Lonato del Garda', start:'2099-11-01', end:'2099-11-04' }, budget:'',
    });
    const saved = action(context.database, 'saveStayFavorite', {
      planId:trip.planId, price:480, checkedAt:'2099-04-01T10:00:00.000Z',
      favorite:{source:'airbnb',url:'https://www.airbnb.com/rooms/777',name:'Little Lake House',note:''},
    });
    const edited = action(context.database, 'updateStayFavoriteDetails', {
      ownerPlanId:saved.ownerPlanId, favoriteId:saved.favorite.id, note:'Quiet terrace · check parking',
    });
    assert.equal(edited.ok, true);
    assert.equal(edited.favorite.note, 'Quiet terrace · check parking');

    const selected = action(context.database, 'selectStayForTrip', {
      planId:trip.planId, ownerPlanId:saved.ownerPlanId, favoriteId:saved.favorite.id,
    });
    assert.equal(selected.ok, true);

    const removed = action(context.database, 'deleteStayFavorite', {
      ownerPlanId:saved.ownerPlanId, favoriteId:saved.favorite.id,
    });
    assert.equal(removed.ok, true);

    const plan = getState().plans.find((item) => item.id === trip.planId);
    assert.equal(plan.stayTracker.saved.length, 0);
    assert.equal(plan.stayTracker.selected.favoriteId, '');
    assert.equal(plan.sharedExpenses.accom.total, 480);
    assert.equal(plan.sharedExpenses.accom.accommodation.paymentType, 'shared');
  } finally { context.cleanup(); }
});


test('unselecting a stay removes its accommodation expense and restores Shared Jar usage', () => {
  const context = setup();
  try {
    const trip = action(context.database, 'savePlan', {
      meta:{ location:'Italy', city:'Lonato del Garda', start:'2099-12-01', end:'2099-12-05' }, budget:'',
    });
    const saved = action(context.database, 'saveStayFavorite', {
      planId:trip.planId, price:500, checkedAt:'2099-05-01T10:00:00.000Z',
      favorite:{source:'airbnb',url:'https://www.airbnb.com/rooms/888',name:'Lake Nest',note:''},
    });
    assert.equal(action(context.database, 'selectStayForTrip', {
      planId:trip.planId, ownerPlanId:saved.ownerPlanId, favoriteId:saved.favorite.id,
    }).ok, true);

    const edited = action(context.database, 'saveAccommodationExpense', {
      planId:trip.planId, total:600, useJar:true, paymentType:'shared', paidUpfront:false,
    });
    assert.equal(edited.ok, true);
    assert.equal(edited.sharedExpense.total, 600);
    assert.equal(edited.sharedExpense.accommodation.useJar, true);
    assert.equal(edited.sharedJar.balance, 750);

    const removed = action(context.database, 'unselectStayForTrip', { planId:trip.planId });
    assert.equal(removed.ok, true);

    const plan = getState().plans.find((item) => item.id === trip.planId);
    assert.equal(plan.stayTracker.selected.favoriteId, '');
    assert.equal(plan.sharedExpenses.accom.total, '');
    assert.equal(plan.sharedExpenses.accom.accommodation.paymentType, '');
    assert.equal(getState().sharedJar.balance, 870);
  } finally { context.cleanup(); }
});
