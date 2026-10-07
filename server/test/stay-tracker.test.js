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


test('stay favourites live in the shared library and can be repriced for a later trip', () => {
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
    assert.equal(saved.ownerPlanId, '');
    assert.equal(saved.favorite.history.length, 1);
    assert.equal(saved.favorite.history[0].start, '2099-06-10');

    const repriced = action(context.database, 'updateStayFavoritePrice', {
      favoriteId:saved.favorite.id, contextPlanId:second.planId,
      price:625, checkedAt:'2099-02-01T10:00:00.000Z',
    });
    assert.equal(repriced.ok, true);

    const state = getState();
    const firstPlan = state.plans.find((plan) => plan.id === first.planId);
    const favorite = state.stayFavorites.find((item) => item.id === saved.favorite.id);
    assert.equal(firstPlan.stayTracker.preferences.parking, true);
    assert.equal(firstPlan.stayTracker.preferences.washingMachine, true);
    assert.deepEqual(favorite.history.map((item) => item.price), [700,625]);
    assert.equal(favorite.history[1].start, '2099-09-03');
    assert.equal(favorite.url, 'https://www.airbnb.com/rooms/12345?check_in=2099-06-10');
  } finally { context.cleanup(); }
});


test('selecting a saved stay logs a normal editable trip expense and blocks duplicates', () => {
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
    assert.ok(plan.stayTracker.selected.expenseId);
    assert.equal(plan.stayTracker.selected.favoriteId, saved.favorite.id);
    assert.equal(plan.expenseEntries.length, 1);
    const expense = plan.expenseEntries[0];
    assert.equal(expense.id, plan.stayTracker.selected.expenseId);
    assert.equal(expense.category, 'accommodation');
    assert.equal(expense.amount, 540);
    assert.equal(expense.paidBy, 'both');
    assert.equal(expense.split, 'shared');
    assert.equal(expense.useJar, false);
    assert.equal(expense.note, 'Casa Bella');
    assert.equal(plan.sharedExpenses.accom.total, '');

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

    const state = getState();
    const plan = state.plans.find((item) => item.id === trip.planId);
    assert.equal(state.stayFavorites.length, 0);
    assert.equal(plan.stayTracker.selected.favoriteId, '');
    assert.equal(plan.expenseEntries.length, 1);
    assert.equal(plan.expenseEntries[0].category, 'accommodation');
    assert.equal(plan.expenseEntries[0].amount, 480);
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
    const selected = action(context.database, 'selectStayForTrip', {
      planId:trip.planId, ownerPlanId:saved.ownerPlanId, favoriteId:saved.favorite.id,
    });
    assert.equal(selected.ok, true);

    const edited = action(context.database, 'saveTripExpense', {
      planId:trip.planId,
      expense:{
        id:selected.expense.id,
        category:'accommodation',
        amount:600,
        paidBy:'Principessa',
        split:'shared',
        forActor:'',
        date:'2099-05-01',
        note:'Lake Nest',
        uncertain:false,
        useJar:true,
      },
    });
    assert.equal(edited.ok, true);
    assert.equal(edited.expense.amount, 600);
    assert.equal(edited.expense.useJar, true);
    assert.equal(edited.sharedJar.balance, 750);

    const removed = action(context.database, 'unselectStayForTrip', { planId:trip.planId });
    assert.equal(removed.ok, true);

    const plan = getState().plans.find((item) => item.id === trip.planId);
    assert.equal(plan.stayTracker.selected.favoriteId, '');
    assert.equal(plan.expenseEntries.length, 0);
    assert.equal(getState().sharedJar.balance, 870);
  } finally { context.cleanup(); }
});


test('manually deleting the selected accommodation expense clears the stay selection link', () => {
  const context = setup();
  try {
    const trip = action(context.database, 'savePlan', {
      meta:{ location:'Italy', city:'Peschiera del Garda', start:'2099-12-10', end:'2099-12-12' }, budget:'',
    });
    const saved = action(context.database, 'saveStayFavorite', {
      planId:trip.planId, price:350, checkedAt:'2099-05-02T10:00:00.000Z',
      favorite:{source:'airbnb',url:'https://www.airbnb.com/rooms/999',name:'Garden Stay',note:''},
    });
    const selected = action(context.database, 'selectStayForTrip', {
      planId:trip.planId, ownerPlanId:saved.ownerPlanId, favoriteId:saved.favorite.id,
    });
    assert.equal(selected.ok, true);

    const deleted = action(context.database, 'deleteTripExpense', {
      planId:trip.planId, expenseId:selected.expense.id,
    });
    assert.equal(deleted.ok, true);

    const plan = getState().plans.find((item) => item.id === trip.planId);
    assert.equal(plan.expenseEntries.length, 0);
    assert.equal(plan.stayTracker.selected.favoriteId, '');
    assert.equal(plan.stayTracker.selected.expenseId, '');
  } finally { context.cleanup(); }
});


test('a stay can be saved to Our Stays with no trip at all', () => {
  const context = setup();
  try {
    const saved = action(context.database, 'saveStayFavorite', {
      planId:'',
      price:'',
      checkedAt:'2099-06-01T10:00:00.000Z',
      favorite:{source:'airbnb',url:'https://www.airbnb.com/rooms/123456',name:'Future Favourite',note:'Try this one sometime'},
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.ownerPlanId, '');
    const state = getState();
    assert.equal(state.plans.length, 0);
    assert.equal(state.stayFavorites.length, 1);
    assert.equal(state.stayFavorites[0].name, 'Future Favourite');
    assert.equal(state.stayFavorites[0].history.length, 0);
  } finally { context.cleanup(); }
});

test('deleting an unselected trip never deletes its saved favourite', () => {
  const context = setup();
  try {
    const trip = action(context.database, 'savePlan', {
      meta:{ location:'Italy', city:'Desenzano del Garda', start:'2099-08-01', end:'2099-08-03' }, budget:'',
    });
    const saved = action(context.database, 'saveStayFavorite', {
      planId:trip.planId, price:420, checkedAt:'2099-06-01T10:00:00.000Z',
      favorite:{source:'airbnb',url:'https://www.airbnb.com/rooms/654321',name:'Permanent Favourite',note:''},
    });
    assert.equal(saved.ok, true);
    assert.equal(action(context.database, 'deleteCurrentTrip', {kind:'plan',id:trip.planId}).ok, true);
    const state = getState();
    assert.equal(state.plans.length, 0);
    assert.equal(state.stayFavorites.length, 1);
    assert.equal(state.stayFavorites[0].id, saved.favorite.id);
  } finally { context.cleanup(); }
});

test('deleting a trip with a selected stay removes trip finances but keeps the favourite', () => {
  const context = setup();
  try {
    const trip = action(context.database, 'savePlan', {
      meta:{ location:'Italy', city:'Lonato del Garda', start:'2099-08-10', end:'2099-08-13' }, budget:'',
    });
    const saved = action(context.database, 'saveStayFavorite', {
      planId:trip.planId, price:510, checkedAt:'2099-06-02T10:00:00.000Z',
      favorite:{source:'airbnb',url:'https://www.airbnb.com/rooms/7654321',name:'Favourite With Trip',note:''},
    });
    const selected = action(context.database, 'selectStayForTrip', {
      planId:trip.planId, ownerPlanId:'', favoriteId:saved.favorite.id,
    });
    assert.equal(selected.ok, true);
    assert.equal(getState().plans[0].expenseEntries.length, 1);

    assert.equal(action(context.database, 'deleteCurrentTrip', {kind:'plan',id:trip.planId}).ok, true);
    const state = getState();
    assert.equal(state.plans.length, 0);
    assert.equal(state.stayFavorites.length, 1);
    assert.equal(state.stayFavorites[0].id, saved.favorite.id);
    assert.equal(state.sharedJar.transactions.filter((item) => item.planId === trip.planId).length, 0);
  } finally { context.cleanup(); }
});


test('unavailable is trip-specific and a later price check makes the stay available again', () => {
  const context = setup();
  try {
    const trip = action(context.database, 'savePlan', {
      meta:{ location:'Italy', city:'Lonato del Garda', start:'2099-10-20', end:'2099-10-23' }, budget:'',
    });
    const saved = action(context.database, 'saveStayFavorite', {
      planId:trip.planId, price:620, checkedAt:'2099-07-01T10:00:00.000Z',
      favorite:{source:'airbnb',url:'https://www.airbnb.com/rooms/424242',name:'Olive House',note:''},
    });
    assert.equal(saved.ok, true);

    const unavailable = action(context.database, 'markStayFavoriteUnavailable', {
      favoriteId:saved.favorite.id, contextPlanId:trip.planId, checkedAt:'2099-07-02T10:00:00.000Z',
    });
    assert.equal(unavailable.ok, true);
    assert.equal(unavailable.favorite.history.at(-1).status, 'unavailable');
    assert.equal(unavailable.favorite.history.at(-1).start, '2099-10-20');

    const blocked = action(context.database, 'selectStayForTrip', {
      planId:trip.planId, ownerPlanId:'', favoriteId:saved.favorite.id,
    });
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /unavailable/i);

    const repriced = action(context.database, 'updateStayFavoritePrice', {
      favoriteId:saved.favorite.id, contextPlanId:trip.planId,
      price:590, checkedAt:'2099-07-03T10:00:00.000Z',
    });
    assert.equal(repriced.ok, true);
    assert.equal(repriced.favorite.history.at(-1).status, 'available');
    assert.equal(repriced.favorite.history.at(-1).price, 590);

    const selected = action(context.database, 'selectStayForTrip', {
      planId:trip.planId, ownerPlanId:'', favoriteId:saved.favorite.id,
    });
    assert.equal(selected.ok, true);
    assert.equal(selected.expense.amount, 590);
  } finally { context.cleanup(); }
});
