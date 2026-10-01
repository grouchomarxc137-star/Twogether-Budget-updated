import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { configureStateStore, getState, runAction } from '../src/core.js';
import { openDatabase } from '../src/db/index.js';
import { buildPushItems } from '../src/push.js';

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'twogether-db-'));
  const database = openDatabase(join(directory, 'test.sqlite'));
  configureStateStore(database.store);
  return {
    database,
    cleanup() {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function action(database, name, payload, actor = 'Principessa') {
  return database.db.transaction(() => runAction(name, payload, actor))();
}

test('starts with a complete empty state stored in SQLite tables', () => {
  const context = setup();
  try {
    const state = getState();
    assert.equal(state.version, 18);
    assert.deepEqual(state.trips, []);
    assert.deepEqual(state.plans, []);
    assert.equal(state.sharedJar.balance, 870);
    assert.deepEqual(
      context.database.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => row.name),
      ['app_state', 'finance_months', 'finance_profiles', 'game_profiles', 'plans', 'trips'],
    );
  } finally {
    context.cleanup();
  }
});

test('recurrent trip checklist updates upcoming trips while preserving custom items and checkmarks', () => {
  const context = setup();
  try {
    const savedDefaults = action(context.database, 'saveTripPrepDefaults', {
      prep: {
        packing: [{ id:'packing-passport', text:'Passport', done:false }],
        reminders: [{ id:'reminder-checkin', text:'Check in online', done:false }],
      },
    });
    assert.equal(savedDefaults.ok, true);

    const upcoming = action(context.database, 'savePlan', {
      meta: { location:'Italy', city:'Lonato', start:'2099-10-10', end:'2099-10-12' },
      budget: '',
    });
    let upcomingPlan = getState().plans.find((item) => item.id === upcoming.planId);
    const passport = upcomingPlan.prep.packing.find((item) => item.recurrentId === 'packing-passport');
    passport.done = true;
    upcomingPlan.prep.packing.push({ id:'custom-camera', text:'Film camera', done:true });
    assert.equal(action(context.database, 'saveTripPrep', { planId:upcoming.planId, prep:upcomingPlan.prep }).ok, true);

    const past = action(context.database, 'savePlan', {
      meta: { location:'Italy', city:'Rome', start:'2000-01-01', end:'2000-01-03' },
      budget: '',
    });
    const pastBefore = getState().plans.find((item) => item.id === past.planId).prep.packing.map((item) => item.text);

    const updatedDefaults = action(context.database, 'saveTripPrepDefaults', {
      prep: {
        packing: [
          { id:'packing-passport', text:'Passport & ID', done:false },
          { id:'packing-chargers', text:'Chargers', done:false },
        ],
        reminders: [],
      },
    });
    assert.equal(updatedDefaults.ok, true);
    assert.ok(updatedDefaults.updatedPlans >= 1);

    upcomingPlan = getState().plans.find((item) => item.id === upcoming.planId);
    const updatedPassport = upcomingPlan.prep.packing.find((item) => item.recurrentId === 'packing-passport');
    const chargers = upcomingPlan.prep.packing.find((item) => item.recurrentId === 'packing-chargers');
    const custom = upcomingPlan.prep.packing.find((item) => item.id === 'custom-camera');
    assert.equal(updatedPassport.text, 'Passport & ID');
    assert.equal(updatedPassport.done, true);
    assert.equal(chargers.text, 'Chargers');
    assert.equal(chargers.done, false);
    assert.equal(custom.text, 'Film camera');
    assert.equal(custom.done, true);
    assert.deepEqual(upcomingPlan.prep.reminders, []);

    const pastAfter = getState().plans.find((item) => item.id === past.planId).prep.packing.map((item) => item.text);
    assert.deepEqual(pastAfter, pastBefore);

    const future = action(context.database, 'savePlan', {
      meta: { location:'Italy', city:'Verona', start:'2099-11-01', end:'2099-11-03' },
      budget: '',
    });
    const futurePlan = getState().plans.find((item) => item.id === future.planId);
    assert.deepEqual(futurePlan.prep.packing.map((item) => item.text), ['Passport & ID', 'Chargers']);
    assert.deepEqual(futurePlan.prep.reminders, []);
  } finally {
    context.cleanup();
  }
});

test('adding a trip checklist item promotes it once without duplicating the current trip row', () => {
  const context = setup();
  try {
    action(context.database, 'saveTripPrepDefaults', { prep:{ packing:[], reminders:[] } });
    const created = action(context.database, 'savePlan', {
      meta: { location:'Italy', city:'Lonato', start:'2099-12-01', end:'2099-12-03' },
      budget: '',
    });
    let plan = getState().plans.find((item) => item.id === created.planId);
    plan.prep.packing.push({ id:'trip-socks', text:'Socks', done:false, addedBy:'Principessa' });

    const saved = action(context.database, 'saveTripPrep', { planId:created.planId, prep:plan.prep });
    assert.equal(saved.ok, true);
    assert.equal(saved.prep.packing.filter((item) => item.text === 'Socks').length, 1);

    const defaults = getState().tripPrepDefaults.packing.filter((item) => item.text === 'Socks');
    assert.equal(defaults.length, 1);
    const savedSocks = saved.prep.packing.find((item) => item.text === 'Socks');
    assert.equal(savedSocks.recurrentId, defaults[0].id);
  } finally {
    context.cleanup();
  }
});

test('shared and personal checklist layers persist without changing legacy shared items', () => {
  const context = setup();
  try {
    action(context.database, 'saveTripPrepDefaults', { prep:{ packing:[], reminders:[] } });
    const created = action(context.database, 'savePlan', {
      meta:{ location:'Italy', city:'Lonato', start:'2099-12-10', end:'2099-12-12' },
      budget:'',
    });
    let plan=getState().plans.find((item)=>item.id===created.planId);
    plan.prep.packing.push({
      id:'shared-socks',text:'Socks',done:false,addedBy:'Principessa',personalFor:'',
      personal:{Principessa:{text:'My socks',done:true,order:0}}
    });
    plan.prep.packing.push({
      id:'private-socks',text:'2 socks',done:false,addedBy:'Principessa',personalFor:'Principessa'
    });

    const saved=action(context.database,'saveTripPrep',{planId:created.planId,prep:plan.prep},'Principessa');
    assert.equal(saved.ok,true);
    const savedShared=saved.prep.packing.find((item)=>item.id==='shared-socks');
    const savedPrivate=saved.prep.packing.find((item)=>item.id==='private-socks');
    assert.equal(savedShared.personalFor,'');
    assert.equal(savedPrivate.personalFor,'Principessa');
    assert.equal(savedShared.personal.Principessa.text,'My socks');
    assert.equal(savedShared.personal.Principessa.done,true);

    const defaults=getState().tripPrepDefaults.packing;
    const sharedDefault=defaults.find((item)=>item.id===savedShared.recurrentId);
    const privateDefault=defaults.find((item)=>item.id===savedPrivate.recurrentId);
    assert.ok(sharedDefault);
    assert.ok(privateDefault);
    assert.equal(sharedDefault.personalFor,'');
    assert.equal(privateDefault.personalFor,'Principessa');

    const legacy=action(context.database,'saveTripPrepDefaults',{
      prep:{
        packing:[...defaults,{id:'legacy-shared',text:'Legacy shared',done:false,addedBy:'Principe'}],
        reminders:[]
      }
    },'Principessa');
    assert.equal(legacy.prep.packing.find((item)=>item.id==='legacy-shared').personalFor,'');

    const future=action(context.database,'savePlan',{
      meta:{location:'Italy',city:'Verona',start:'2099-12-20',end:'2099-12-22'},
      budget:''
    },'Principe');
    const futurePlan=getState().plans.find((item)=>item.id===future.planId);
    assert.ok(futurePlan.prep.packing.some((item)=>item.recurrentId===sharedDefault.id&&item.personalFor===''));
    assert.ok(futurePlan.prep.packing.some((item)=>item.recurrentId===privateDefault.id&&item.personalFor==='Principessa'));
  } finally {
    context.cleanup();
  }
});

test('trip notes persist with dates and shared or personal scope without recurrent saves wiping them', () => {
  const context = setup();
  try {
    const saved=action(context.database,'saveTripNotes',{
      notes:[
        {id:'shared-note',text:'Black hoodie is already at Principe’s',addedBy:'Principessa',personalFor:'',createdAt:'2026-09-30T18:00:00.000Z'},
        {id:'private-note',text:'Bring my yellow charger',addedBy:'Principessa',personalFor:'Principessa'}
      ]
    },'Principessa');
    assert.equal(saved.ok,true);
    assert.equal(saved.notes.length,2);
    assert.equal(saved.notes[0].createdAt,'2026-09-30T18:00:00.000Z');
    assert.equal(saved.notes[1].personalFor,'Principessa');
    assert.ok(Number.isFinite(Date.parse(saved.notes[1].createdAt)));

    const recurrentSave=action(context.database,'saveTripPrepDefaults',{
      prep:{packing:[],reminders:[]}
    },'Principe');
    assert.equal(recurrentSave.ok,true);
    assert.equal(recurrentSave.prep.notes.length,2);
    assert.equal(recurrentSave.prep.notes.find((item)=>item.id==='shared-note').text,'Black hoodie is already at Principe’s');

    const hidden=action(context.database,'saveTripNotes',{
      notes:saved.notes.map((item)=>item.id==='shared-note'
        ? {...item,personal:{Principessa:{hidden:true,text:'My hidden hoodie note'}}}
        : item)
    },'Principessa');
    const shared=hidden.notes.find((item)=>item.id==='shared-note');
    assert.equal(shared.personal.Principessa.hidden,true);
    assert.equal(shared.personal.Principessa.text,'My hidden hoodie note');
  } finally {
    context.cleanup();
  }
});

test('packing section overrides persist through recurrent defaults and trip creation', () => {
  const context = setup();
  try {
    const defaults=action(context.database,'saveTripPrepDefaults',{
      prep:{
        packing:[
          {id:'packing-charger',text:'Phone charger',done:false,section:'electronics'},
          {id:'packing-passport',text:'Passport',done:false,section:'documents',personal:{Principessa:{section:'other'}}},
        ],
        reminders:[],
      },
    });
    assert.equal(defaults.ok,true);
    assert.equal(defaults.prep.packing.find((item)=>item.id==='packing-charger').section,'electronics');
    assert.equal(defaults.prep.packing.find((item)=>item.id==='packing-passport').personal.Principessa.section,'other');

    const created=action(context.database,'savePlan',{
      meta:{location:'Italy',city:'Lonato',start:'2099-12-20',end:'2099-12-22'},
      budget:'',
    });
    let plan=getState().plans.find((item)=>item.id===created.planId);
    const charger=plan.prep.packing.find((item)=>item.recurrentId==='packing-charger');
    assert.equal(charger.section,'electronics');

    charger.section='clothes';
    const saved=action(context.database,'saveTripPrep',{planId:created.planId,prep:plan.prep});
    assert.equal(saved.ok,true);
    plan=getState().plans.find((item)=>item.id===created.planId);
    assert.equal(plan.prep.packing.find((item)=>item.id===charger.id).section,'clothes');
  } finally {
    context.cleanup();
  }
});

test('packing categories can be renamed, added and removed without losing items', () => {
  const context = setup();
  try {
    const saved=action(context.database,'saveTripPrepDefaults',{
      prep:{
        packingSections:[
          {id:'electronics',label:'Tech'},
          {id:'custom-pets',label:'Pet things'},
          {id:'other',label:'Misc'},
        ],
        packing:[
          {id:'packing-charger',text:'Phone charger',done:false,section:'electronics'},
          {id:'packing-leash',text:'Dog leash',done:false,section:'custom-pets'},
        ],
        reminders:[],
      },
    });
    assert.equal(saved.ok,true);
    assert.deepEqual(saved.prep.packingSections.map((section)=>section.label),['Tech','Pet things','Misc']);
    assert.equal(saved.prep.packing.find((item)=>item.id==='packing-leash').section,'custom-pets');

    const created=action(context.database,'savePlan',{
      meta:{location:'Italy',city:'Lonato',start:'2099-12-24',end:'2099-12-27'},
      budget:'',
    });
    let plan=getState().plans.find((item)=>item.id===created.planId);
    assert.equal(plan.prep.packing.find((item)=>item.recurrentId==='packing-leash').section,'custom-pets');

    const removed=action(context.database,'saveTripPrepDefaults',{
      prep:{
        packingSections:[
          {id:'electronics',label:'Tech'},
          {id:'other',label:'Misc'},
        ],
        packing:saved.prep.packing,
        reminders:[],
      },
    });
    assert.equal(removed.ok,true);
    assert.equal(removed.prep.packing.find((item)=>item.id==='packing-leash').section,'other');

    plan=getState().plans.find((item)=>item.id===created.planId);
    assert.equal(plan.prep.packing.find((item)=>item.recurrentId==='packing-leash').section,'other');
  } finally {
    context.cleanup();
  }
});

test('important reminder notification time stays on the trip and survives recurrent sync', () => {
  const context = setup();
  try {
    action(context.database, 'saveTripPrepDefaults', { prep:{ packing:[], reminders:[] } });
    const created = action(context.database, 'savePlan', {
      meta:{ location:'Italy', city:'Lonato', start:'2099-12-20', end:'2099-12-22' },
      budget:'',
    });
    let plan=getState().plans.find((item)=>item.id===created.planId);
    plan.prep.reminders.push({
      id:'trip-gift',
      text:'Buy birthday gift',
      done:false,
      addedBy:'Principessa',
      notifyAt:'2099-12-19T17:30:00.000Z',
    });

    const saved=action(context.database,'saveTripPrep',{planId:created.planId,prep:plan.prep});
    assert.equal(saved.ok,true);
    const reminder=saved.prep.reminders.find((item)=>item.id==='trip-gift');
    assert.equal(reminder.notifyAt,'2099-12-19T17:30:00.000Z');

    const recurrent=getState().tripPrepDefaults.reminders.find((item)=>item.id===reminder.recurrentId);
    assert.ok(recurrent);
    assert.equal(Object.prototype.hasOwnProperty.call(recurrent,'notifyAt'),false);

    action(context.database,'saveTripPrepDefaults',{
      prep:{packing:[],reminders:[{...recurrent,text:'Buy the birthday gift'}]},
    });
    plan=getState().plans.find((item)=>item.id===created.planId);
    const synced=plan.prep.reminders.find((item)=>item.id==='trip-gift');
    assert.equal(synced.text,'Buy the birthday gift');
    assert.equal(synced.notifyAt,'2099-12-19T17:30:00.000Z');
  } finally {
    context.cleanup();
  }
});

test('scheduled important reminders only create push items once they are due', () => {
  const state={
    plans:[{
      id:'plan-reminder',
      meta:{location:'Italy',city:'Lonato',start:'2099-12-20',end:'2099-12-22'},
      prep:{
        updatedAt:'2026-09-30T10:00:00.000Z',
        packing:[],
        reminders:[{id:'gift-reminder',text:'Buy birthday gift',done:false,notifyAt:'2026-10-01T12:00:00.000Z'}],
      },
    }],
    trips:[],
    tripPrepDefaults:{packing:[],reminders:[]},
    finances:{Principessa:[],Principe:[]},
    financeProfiles:{Principessa:{},Principe:{}},
  };

  const before=buildPushItems(state,'Principessa','Europe/Amsterdam',new Date('2026-10-01T11:59:00.000Z'));
  assert.equal(before.some((item)=>String(item.eventKey).startsWith('trip-reminder:')),false);

  const due=buildPushItems(state,'Principessa','Europe/Amsterdam',new Date('2026-10-01T12:00:01.000Z'));
  const item=due.find((entry)=>String(entry.eventKey).startsWith('trip-reminder:'));
  assert.ok(item);
  assert.equal(item.title,'Buy birthday gift');
  assert.equal(item.body,'Lonato · Important reminder');

  state.plans[0].prep.reminders[0].done=true;
  const completed=buildPushItems(state,'Principessa','Europe/Amsterdam',new Date('2026-10-01T12:05:00.000Z'));
  assert.equal(completed.some((entry)=>String(entry.eventKey).startsWith('trip-reminder:')),false);
});

test('deleting a recurrent-linked item from one trip does not let recurrent sync add it back', () => {
  const context = setup();
  try {
    action(context.database, 'saveTripPrepDefaults', {
      prep: {
        packing: [{ id:'packing-passport', text:'Passport', done:false }],
        reminders: [],
      },
    });
    const created = action(context.database, 'savePlan', {
      meta: { location:'Italy', city:'Lonato', start:'2099-12-10', end:'2099-12-12' },
      budget: '',
    });

    let plan = getState().plans.find((item) => item.id === created.planId);
    plan.prep.packing = plan.prep.packing.filter((item) => item.recurrentId !== 'packing-passport');
    assert.equal(action(context.database, 'saveTripPrep', { planId:created.planId, prep:plan.prep }).ok, true);

    action(context.database, 'saveTripPrepDefaults', {
      prep: {
        packing: [
          { id:'packing-passport', text:'Passport & ID', done:false },
          { id:'packing-charger', text:'Phone charger', done:false },
        ],
        reminders: [],
      },
    });

    plan = getState().plans.find((item) => item.id === created.planId);
    assert.equal(plan.prep.packing.some((item) => item.recurrentId === 'packing-passport'), false);
    assert.equal(plan.prep.packing.filter((item) => item.recurrentId === 'packing-charger').length, 1);
    assert.equal(getState().tripPrepDefaults.packing.some((item) => item.id === 'packing-passport'), true);
  } finally {
    context.cleanup();
  }
});

test('creates a trip plan without a budget when budget is skipped', () => {
  const context = setup();
  try {
    const created = action(context.database, 'savePlan', {
      meta: { location: 'Italy', city: 'Desenzano', start: '2026-10-01', end: '2026-10-08' },
      budget: '',
    });
    assert.equal(created.ok, true);
    const plan = getState().plans.find((item) => item.id === created.planId);
    assert.ok(plan);
    assert.equal(plan.budgets.Principessa, '');
    assert.equal(plan.meta.start, '2026-10-01');
    assert.equal(plan.meta.end, '2026-10-08');
  } finally {
    context.cleanup();
  }
});

test('persists plans, shared expenses, trip confirmation and rewards', () => {
  const context = setup();
  try {
    const meta = { location: 'Italy', city: 'Verona', start: '2026-10-01', end: '2026-10-03' };
    const created = action(context.database, 'savePlan', { meta, budget: 500 });
    assert.equal(created.ok, true);
    assert.equal(action(context.database, 'savePlan', { id: created.planId, budget: 500 }, 'Principe').ok, true);

    assert.equal(action(context.database, 'saveSharedExpense', {
      planId: created.planId, key: 'accom', total: 800, mode: 'shared', paid: 400, expectedTotal: '',
    }).ok, true);
    assert.equal(action(context.database, 'saveSharedExpense', {
      planId: created.planId, key: 'accom', total: 800, mode: 'shared', paid: 400, expectedTotal: 800,
    }, 'Principe').ok, true);

    const submission = {
      ...meta, accom: 800, travel: 0, groceries: 0, eat: 0, fuel: 0,
      tolls: 0, other: 0, otherNote: '', paid: 400, uncertain: {},
    };
    const first = action(context.database, 'savePlanSubmission', { planId: created.planId, submission });
    assert.equal(first.ok, true);
    assert.equal(action(context.database, 'savePlanSubmission', { planId: created.planId, submission }, 'Principe').ok, true);
    assert.equal(action(context.database, 'confirmTrip', { id: first.tripId }).ok, true);
    assert.equal(action(context.database, 'confirmTrip', { id: first.tripId }, 'Principe').ok, true);

    const state = getState();
    assert.equal(state.trips[0].confirmed.Principessa, true);
    assert.equal(state.trips[0].confirmed.Principe, true);
    assert.equal(state.game.Principessa.twos, 100);
    assert.equal(state.game.Principe.twos, 100);
    assert.ok(state.updatedAt);
  } finally {
    context.cleanup();
  }
});

test('handles the shared jar and repayment confirmation', () => {
  const context = setup();
  try {
    const created = action(context.database, 'savePlan', {
      meta: { location: 'Italy', city: 'Rome', start: '2026-11-01', end: '2026-11-02' },
      budget: 300,
    });
    const saved = action(context.database, 'saveAccommodationExpense', {
      planId: created.planId, total: 500, useJar: true, paymentType: 'shared', paidUpfront: true,
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.sharedJar.balance, 770);
    assert.equal(saved.sharedExpense.accommodation.repayment.amount, 200);
    assert.equal(saved.sharedExpense.accommodation.repayment.status, 'pending');

    const confirmed = action(context.database, 'confirmAccommodationRepayment', {
      planId: created.planId, paidBack: true,
    }, 'Principe');
    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.sharedExpense.accommodation.repayment.status, 'confirmed');
  } finally {
    context.cleanup();
  }
});

test('edits the Shared Jar balance without breaking accommodation deductions', () => {
  const context = setup();
  try {
    const created = action(context.database, 'savePlan', {
      meta: { location: 'Italy', city: 'Bergamo', start: '2026-11-10', end: '2026-11-12' },
      budget: 400,
    });
    const first = action(context.database, 'saveAccommodationExpense', {
      planId: created.planId, total: 500, useJar: true, paymentType: 'shared', paidUpfront: true,
    });
    assert.equal(first.sharedJar.balance, 770);
    assert.equal(first.sharedJar.transactions.length, 1);

    const edited = action(context.database, 'updateSharedJarBalance', { balance: 600 });
    assert.equal(edited.ok, true);
    assert.equal(edited.sharedJar.balance, 600);
    assert.equal(edited.sharedJar.initialBalance, 700);
    assert.equal(edited.sharedJar.transactions.length, 1);

    const changedAccommodation = action(context.database, 'saveAccommodationExpense', {
      planId: created.planId, total: 1000, useJar: true, paymentType: 'shared', paidUpfront: true,
    });
    assert.equal(changedAccommodation.sharedJar.balance, 500);
    assert.equal(changedAccommodation.sharedJar.transactions[0].amount, 200);
  } finally {
    context.cleanup();
  }
});

test('persists finance and wishlist data independently', () => {
  const context = setup();
  try {
    const month = action(context.database, 'saveFinanceMonth', {
      monthData: {
        month: '2026-09', incomes: [{ name: 'Income', amount: 1000 }],
        expenses: [{ group: 'rent', name: 'Rent', amount: 100 }],
        extraBudget: 250, extraSpends: [], finalized: true,
      },
    });
    assert.equal(month.ok, true);
    assert.equal(month.twosDelta, 650);

    const profile = {
      bankAccounts: [], savingsTotal: '', savingsReserved: [],
      receivables: [{ id: 'loan-1', person: 'Sis', reason: 'Test loan', principal: 100, repayments: [{ id: 'repay-1', month: '2026-09', date: '2026-09-24', amount: 40, at: '2026-09-24T12:00:00Z' }] }],
      scenarios: [], compareLab: {},
      wishlist: [{ id: 'wish-1', name: 'Weekend bag', price: 40, priority: 2, createdAt: '2026-09-01T00:00:00Z' }],
    };
    assert.equal(action(context.database, 'saveFinanceProfile', { profile }).ok, true);
    assert.equal(action(context.database, 'wishlistCheckout', { ids: ['wish-1'] }).ok, true);

    const state = getState();
    assert.equal(state.finances.Principessa.length, 1);
    assert.equal(state.financeProfiles.Principessa.wishlist[0].unlockedBy, 'Principessa');
    assert.equal(state.financeProfiles.Principessa.receivables[0].repayments[0].date, '2026-09-24');
    assert.equal(state.game.Principessa.twos, 610);
    assert.equal(state.game.Principessa.lovis, 8);
  } finally {
    context.cleanup();
  }
});

test('partial finance drafts keep only the expenses explicitly logged', () => {
  const context = setup();
  try {
    const result = action(context.database, 'saveFinanceMonth', {
      monthData: {
        month: '2026-09',
        incomes: [],
        expenses: [{ group: 'rent', name: 'Rent', amount: 50 }],
        extraBudget: 250,
        extraSpends: [],
        partialOnly: true,
        finalized: false,
      },
    });
    assert.equal(result.ok, true);
    const saved = getState().finances.Principessa[0];
    assert.equal(saved.partialOnly, true);
    assert.deepEqual(saved.expenses.map((x) => x.name), ['Rent']);
  } finally {
    context.cleanup();
  }
});

test('Principe Money used extra allows Saved up and Leftover but not credit card', () => {
  const context = setup();
  try {
    assert.equal(action(context.database, 'saveFinanceProfile', { profile: { savingsTotal: 1000 } }, 'Principe').ok, true);

    const first = action(context.database, 'saveFinanceMonth', {
      monthData: {
        month: '2026-09',
        incomes: [{ name: 'Salary', amount: 1550 }],
        expenses: [{ group: 'rent', name: 'Rent', amount: 575 }],
        extraSpends: [
          { source: 'savings', amount: 120 },
          { source: 'main', amount: 35 },
          { source: 'creditcard', amount: 50 },
        ],
        finalized: false,
      },
    }, 'Principe');
    assert.equal(first.ok, true);
    assert.equal(first.financeProfile.savingsTotal, 880);
    assert.deepEqual(getState().finances.Principe[0].extraSpends.map((x) => x.source), ['savings', 'main']);

    const edited = action(context.database, 'saveFinanceMonth', {
      monthData: {
        month: '2026-09',
        incomes: [{ name: 'Salary', amount: 1550 }],
        expenses: [{ group: 'rent', name: 'Rent', amount: 575 }],
        extraSpends: [{ source: 'savings', amount: 70 }],
        finalized: false,
      },
    }, 'Principe');
    assert.equal(edited.ok, true);
    assert.equal(edited.financeProfile.savingsTotal, 930);

    const removed = action(context.database, 'saveFinanceMonth', {
      monthData: {
        month: '2026-09',
        incomes: [{ name: 'Salary', amount: 1550 }],
        expenses: [{ group: 'rent', name: 'Rent', amount: 575 }],
        extraSpends: [],
        finalized: false,
      },
    }, 'Principe');
    assert.equal(removed.ok, true);
    assert.equal(removed.financeProfile.savingsTotal, 1000);

    const tooMuch = action(context.database, 'saveFinanceMonth', {
      monthData: { month: '2026-10', incomes: [], expenses: [], extraSpends: [{ source: 'savings', amount: 1200 }], finalized: false },
    }, 'Principe');
    assert.equal(tooMuch.ok, false);
    assert.match(tooMuch.error, /Saved up only has/);
    assert.equal(getState().financeProfiles.Principe.savingsTotal, 1000);
  } finally {
    context.cleanup();
  }
});

test('Principessa Saved up extra spending reduces and restores Saved up', () => {
  const context = setup();
  try {
    assert.equal(action(context.database, 'saveFinanceProfile', { profile: { savingsTotal: 1000 } }, 'Principessa').ok, true);

    const first = action(context.database, 'saveFinanceMonth', {
      monthData: {
        month: '2026-09',
        incomes: [],
        expenses: [],
        extraSpends: [{ source: 'savings', amount: 150 }],
        partialOnly: true,
        finalized: false,
      },
    }, 'Principessa');
    assert.equal(first.ok, true);
    assert.equal(first.financeProfile.savingsTotal, 850);

    const removed = action(context.database, 'saveFinanceMonth', {
      monthData: {
        month: '2026-09',
        incomes: [],
        expenses: [],
        extraSpends: [],
        partialOnly: true,
        finalized: false,
      },
    }, 'Principessa');
    assert.equal(removed.ok, true);
    assert.equal(removed.financeProfile.savingsTotal, 1000);
  } finally {
    context.cleanup();
  }
});

test('pending credit card only counts in finalized outflow when marked to count while pending', () => {
  const context = setup();
  try {
    const beforeSalary = action(context.database, 'saveFinanceMonth', {
      monthData: {
        month: '2026-10',
        incomes: [{ name: 'Neways', amount: 1000 }],
        expenses: [{ group: 'other', name: 'Normal', amount: 100 }],
        extraSpends: [{ source: 'creditcard', amount: 200, date: '2026-10-10', status: 'pending', pendingCounts: false }],
        partialOnly: true,
        finalized: true,
      },
    }, 'Principessa');
    assert.equal(beforeSalary.ok, true);
    assert.equal(beforeSalary.twosDelta, 900);
    assert.equal(getState().finances.Principessa[0].extraSpends[0].status, 'pending');
    assert.equal(getState().finances.Principessa[0].extraSpends[0].pendingCounts, false);

    const futureCycle = action(context.database, 'saveFinanceMonth', {
      monthData: {
        month: '2026-11',
        incomes: [{ name: 'Neways', amount: 1000 }],
        expenses: [{ group: 'other', name: 'Normal', amount: 100 }],
        extraSpends: [{ source: 'creditcard', amount: 200, date: '2026-11-10', status: 'pending', pendingCounts: true }],
        partialOnly: true,
        finalized: true,
      },
    }, 'Principessa');
    assert.equal(futureCycle.ok, true);
    assert.equal(futureCycle.twosDelta, 700);
  } finally {
    context.cleanup();
  }
});

test('confirms a pending credit card charge without changing its amount', () => {
  const context = setup();
  try {
    const saved = action(context.database, 'saveFinanceMonth', {
      monthData: {
        month: '2026-10',
        incomes: [{ name: 'Neways', amount: 1000 }],
        expenses: [],
        extraSpends: [{ id:'cc-1', source:'creditcard', amount:125.5, date:'2026-10-18', status:'pending', pendingCounts:false }],
        partialOnly:true,
        finalized:false,
      },
    }, 'Principessa');
    assert.equal(saved.ok, true);

    const confirmed = action(context.database, 'confirmFinanceCreditCard', {
      month:'2026-10',
      extraSpendId:'cc-1',
    }, 'Principessa');
    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.monthData.extraSpends[0].amount, 125.5);
    assert.equal(confirmed.monthData.extraSpends[0].status, 'confirmed');
    assert.equal(confirmed.monthData.extraSpends[0].pendingCounts, true);

    const stored = getState().finances.Principessa[0].extraSpends[0];
    assert.equal(stored.amount, 125.5);
    assert.equal(stored.status, 'confirmed');
  } finally {
    context.cleanup();
  }
});

test('deleting the final credit card log does not revive it from legacy extra fields', () => {
  const context = setup();
  try {
    assert.equal(action(context.database, 'saveFinanceMonth', {
      monthData: {
        month: '2026-10',
        incomes: [],
        expenses: [],
        extraSpends: [{ id:'cc-delete', source:'creditcard', amount:80, date:'2026-10-20', status:'pending', pendingCounts:false }],
        partialOnly:true,
        finalized:false,
      },
    }, 'Principessa').ok, true);

    const stored = getState().finances.Principessa[0];
    assert.equal(stored.extraOverspendSource, 'creditcard');
    assert.equal(stored.extraOverspendAmount, 80);

    const deleting = JSON.parse(JSON.stringify(stored));
    deleting.extraSpends = [];
    // These compatibility fields intentionally stay stale, matching the UI delete path.
    assert.equal(action(context.database, 'saveFinanceMonth', { monthData: deleting }, 'Principessa').ok, true);

    const after = getState().finances.Principessa[0];
    assert.deepEqual(after.extraSpends, []);
    assert.equal(after.extraOverspendSource, '');
    assert.equal(after.extraOverspendAmount, 0);
  } finally {
    context.cleanup();
  }
});

test('Shared Jar finance expenses stay in the personal log without reducing personal money', () => {
  const context = setup();
  try {
    const first = action(context.database, 'saveFinanceMonth', {
      monthData: {
        month:'2026-10',
        incomes:[{name:'Salary',amount:1000,date:'2026-10-01'}],
        expenses:[
          {id:'gift-1',group:'other',name:'Birthday gift',amount:50,date:'2026-10-05',paidFrom:'sharedJar'},
          {id:'rent-1',group:'rent',name:'Rent',amount:100,date:'2026-10-02',paidFrom:'personal'},
        ],
        partialOnly:true,
        finalized:true,
      },
    }, 'Principessa');
    assert.equal(first.ok, true);
    assert.equal(first.twosDelta, 900);
    assert.equal(first.sharedJar.balance, 820);
    assert.equal(first.sharedJar.transactions.filter((x) => x.source === 'finance').length, 1);
    const firstTx = first.sharedJar.transactions.find((x) => x.source === 'finance');
    assert.equal(firstTx.expenseId, 'gift-1');
    assert.equal(firstTx.name, 'Birthday gift');
    assert.equal(firstTx.actor, 'Principessa');
    assert.equal(first.monthData.expenses.find((x) => x.id === 'gift-1').paidFrom, 'sharedJar');

    // Re-open the month for the edit/delete regression without awarding Twos again.
    const stored = getState();
    stored.finances.Principessa[0].finalized = false;
    stored.finances.Principessa[0].finalizedAt = '';
    context.database.store.write(stored);

    const edited = action(context.database, 'saveFinanceMonth', {
      monthData: {
        ...getState().finances.Principessa[0],
        expenses:[
          {id:'gift-1',group:'other',name:'Bigger birthday gift',amount:70,date:'2026-10-05',paidFrom:'sharedJar'},
          {id:'rent-1',group:'rent',name:'Rent',amount:100,date:'2026-10-02',paidFrom:'personal'},
        ],
        finalized:false,
      },
    }, 'Principessa');
    assert.equal(edited.ok, true);
    assert.equal(edited.sharedJar.balance, 800);
    assert.equal(edited.sharedJar.transactions.filter((x) => x.source === 'finance').length, 1);
    assert.equal(edited.sharedJar.transactions.find((x) => x.source === 'finance').amount, 70);

    const removed = action(context.database, 'saveFinanceMonth', {
      monthData: {
        ...getState().finances.Principessa[0],
        expenses:[{id:'rent-1',group:'rent',name:'Rent',amount:100,date:'2026-10-02',paidFrom:'personal'}],
        finalized:false,
      },
    }, 'Principessa');
    assert.equal(removed.ok, true);
    assert.equal(removed.sharedJar.balance, 870);
    assert.equal(removed.sharedJar.transactions.some((x) => x.source === 'finance'), false);
  } finally {
    context.cleanup();
  }
});

test('keeps optional finance dates and recurring usual days', () => {
  const context = setup();
  try {
    const profileResult = action(context.database, 'saveFinanceProfile', {
      profile: {
        recurring: {
          custom: true,
          incomes: [{ id: 'income-salary', name: 'Salary', amount: 1550, day: 24 }],
          expenses: [
            { id: 'expense-phone', group: 'subscriptions', name: 'Odido', amount: 30, day: 30 },
            { id: 'expense-flex', group: 'other', name: 'Flexible', amount: 12, day: 40 },
          ],
        },
        financeReminders: [
          { id: 'finance:Principessa:2026-09:income::salary', kind: 'income', name: 'Salary', amount: 1550, month: '2026-09', date: '2026-09-24', createdAt: '2026-09-24T08:00:00Z' },
          { id: 'finance:Principessa:2026-09:investment-snapshot', kind: 'investment-snapshot', name: 'Investment value', group: 'investments', amount: '', month: '2026-09', date: '2026-09-24', createdAt: '2026-09-24T09:00:00Z' },
        ],
      },
    });
    assert.equal(profileResult.ok, true);

    const monthResult = action(context.database, 'saveFinanceMonth', {
      monthData: {
        month: '2026-09',
        incomes: [{ name: 'Salary', amount: 1550, date: '2026-09-24' }],
        expenses: [
          { group: 'subscriptions', name: 'Odido', amount: 30, date: '2026-09-30' },
          { group: 'other', name: 'Wrong month', amount: 5, date: '2026-10-01' },
        ],
        finalized: false,
      },
    });
    assert.equal(monthResult.ok, true);

    const state = getState();
    assert.equal(state.financeProfiles.Principessa.recurring.incomes[0].day, 24);
    assert.equal(state.financeProfiles.Principessa.recurring.expenses[0].day, 30);
    assert.equal(state.financeProfiles.Principessa.recurring.expenses[1].day, '');
    assert.equal(state.financeProfiles.Principessa.financeReminders[0].date, '2026-09-24');
    assert.equal(state.financeProfiles.Principessa.financeReminders[0].name, 'Salary');
    assert.equal(state.financeProfiles.Principessa.financeReminders[1].kind, 'investment-snapshot');
    assert.equal(state.financeProfiles.Principessa.financeReminders[1].group, 'investments');
    assert.equal(state.financeProfiles.Principessa.financeReminders[1].amount, '');
    assert.equal(state.finances.Principessa[0].incomes[0].date, '2026-09-24');
    assert.equal(state.finances.Principessa[0].expenses.find((x) => x.name === 'Odido').date, '2026-09-30');
    assert.equal(state.finances.Principessa[0].expenses.find((x) => x.name === 'Wrong month').date, '');
  } finally {
    context.cleanup();
  }
});

test('keeps saved data after the database is closed and reopened', () => {
  const directory = mkdtempSync(join(tmpdir(), 'twogether-reopen-'));
  const databasePath = join(directory, 'test.sqlite');
  try {
    let database = openDatabase(databasePath);
    configureStateStore(database.store);
    const saved = action(database, 'savePlan', {
      meta: { location: 'Italy', city: 'Milan', start: '2026-12-01', end: '2026-12-02' },
      budget: 275,
    });
    assert.equal(saved.ok, true);
    database.close();

    database = openDatabase(databasePath);
    configureStateStore(database.store);
    assert.equal(getState().plans[0].id, saved.planId);
    assert.equal(getState().plans[0].budgets.Principessa, 275);
    database.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('trip expense entries save one at a time, keep Food types, and restrict Shared Jar to accommodation', () => {
  const c = setup();
  try {
    const p = action(c.database, 'savePlan', { meta: { location: 'Italy', city: 'Lonato', start: '2026-09-19', end: '2026-09-22' }, budget: 500 });
    const groceries = action(c.database, 'saveTripExpense', { planId: p.planId, expense: { category: 'food', foodType: 'groceries', amount: 42, paidBy: 'Principessa', split: 'shared', date: '2026-09-20', useJar: true } });
    assert.equal(groceries.expense.foodType, 'groceries');
    assert.equal(groceries.expense.useJar, false);
    assert.equal(groceries.sharedJar.balance, 870);

    const eatingOut = action(c.database, 'saveTripExpense', { planId: p.planId, expense: { category: 'food', foodType: 'eating-out', amount: 18, paidBy: 'Principe', split: 'shared', date: '2026-09-21' } });
    assert.equal(eatingOut.expense.foodType, 'eating-out');
    const foodTypes = getState().plans[0].expenseEntries.filter((x) => x.category === 'food').map((x) => x.foodType);
    assert.deepEqual(foodTypes, ['groceries', 'eating-out']);

    const tolls = action(c.database, 'saveTripExpense', { planId: p.planId, expense: { category: 'transport', transportType: 'tolls', amount: 12, paidBy: 'Principessa', split: 'shared', date: '2026-09-21' } });
    const fuel = action(c.database, 'saveTripExpense', { planId: p.planId, expense: { category: 'transport', transportType: 'fuel', amount: 55, paidBy: 'Principe', split: 'shared', date: '2026-09-21' } });
    const transportOther = action(c.database, 'saveTripExpense', { planId: p.planId, expense: { category: 'transport', transportType: 'other', amount: 9, paidBy: 'Principessa', split: 'personal', forActor: 'Principessa', date: '2026-09-21' } });
    assert.equal(tolls.expense.transportType, 'tolls');
    assert.equal(fuel.expense.transportType, 'fuel');
    assert.equal(transportOther.expense.transportType, 'other');
    const transportTypes = getState().plans[0].expenseEntries.filter((x) => x.category === 'transport').map((x) => x.transportType);
    assert.deepEqual(transportTypes, ['tolls', 'fuel', 'other']);

    const flights = action(c.database, 'saveTripExpense', { planId: p.planId, expense: { category: 'transport', transportType: 'flights-trains', amount: 70, paidBy: 'Principessa', split: 'shared', date: '2026-09-21' } });
    const parking = action(c.database, 'saveTripExpense', { planId: p.planId, expense: { category: 'transport', transportType: 'parking-tolls', amount: 14, paidBy: 'Principe', split: 'shared', date: '2026-09-21' } });
    const foodOther = action(c.database, 'saveTripExpense', { planId: p.planId, expense: { category: 'food', foodType: 'other', name: 'Picnic supplies', amount: 11, paidBy: 'Principessa', split: 'shared', date: '2026-09-21' } });
    const namedOther = action(c.database, 'saveTripExpense', { planId: p.planId, expense: { category: 'other', name: 'Souvenirs', amount: 25, paidBy: 'Principe', split: 'personal', forActor: 'Principe', date: '2026-09-21' } });
    assert.equal(flights.expense.transportType, 'flights-trains');
    assert.equal(parking.expense.transportType, 'parking-tolls');
    assert.equal(foodOther.expense.foodType, 'other');
    assert.equal(foodOther.expense.name, 'Picnic supplies');
    assert.equal(namedOther.expense.name, 'Souvenirs');

    const a = action(c.database, 'saveTripExpense', { planId: p.planId, expense: { category: 'accommodation', foodType: 'groceries', amount: 500, paidBy: 'Principessa', split: 'shared', date: '2026-09-20', useJar: true } });
    assert.equal(a.expense.foodType, '');
    assert.equal(a.expense.transportType, '');
    assert.equal(a.expense.jarContribution, 100);
    assert.equal(a.sharedJar.balance, 770);
    const d = action(c.database, 'deleteTripExpense', { planId: p.planId, expenseId: a.expense.id });
    assert.equal(d.sharedJar.balance, 870);
  } finally {
    c.cleanup();
  }
});

test('deletes an unfinished current trip safely and restores Shared Jar usage', () => {
  const c = setup();
  try {
    const p = action(c.database, 'savePlan', {
      meta: { location: 'Italy', city: 'Lonato', start: '2026-09-19', end: '2026-09-22' },
      budget: 500,
    });
    const stay = action(c.database, 'saveTripExpense', {
      planId: p.planId,
      expense: { category: 'accommodation', amount: 500, paidBy: 'Principessa', split: 'shared', date: '2026-09-20', useJar: true },
    });
    assert.equal(stay.sharedJar.balance, 770);

    const linked = action(c.database, 'savePlanSubmission', {
      planId: p.planId,
      submission: {
        location: 'Italy', city: 'Lonato', start: '2026-09-19', end: '2026-09-22',
        accom: 0, travel: 0, groceries: 0, eat: 0, fuel: 0, tolls: 0, other: 0,
        otherNote: '', paid: 0, uncertain: {},
      },
    });
    assert.ok(linked.tripId);
    assert.equal(getState().plans.length, 1);
    assert.equal(getState().trips.length, 1);

    const removed = action(c.database, 'deleteCurrentTrip', { kind: 'plan', id: p.planId });
    assert.equal(removed.ok, true);
    assert.equal(removed.sharedJar.balance, 870);
    assert.equal(getState().plans.length, 0);
    assert.equal(getState().trips.length, 0);
  } finally {
    c.cleanup();
  }
});

test('deletes standalone unfinished trips but protects confirmed trips', () => {
  const c = setup();
  try {
    const standalone = action(c.database, 'saveSubmission', {
      submission: {
        location: 'Italy', city: 'Bergamo', start: '2026-10-01', end: '2026-10-02',
        accom: 10, travel: 0, groceries: 0, eat: 0, fuel: 0, tolls: 0, other: 0,
        otherNote: '', paid: 10, uncertain: {},
      },
      budget: 100,
    });
    assert.equal(action(c.database, 'deleteCurrentTrip', { kind: 'trip', id: standalone.tripId }).ok, true);
    assert.equal(getState().trips.length, 0);

    const p = action(c.database, 'savePlan', {
      meta: { location: 'Italy', city: 'Rome', start: '2026-11-01', end: '2026-11-02' },
      budget: 300,
    });
    action(c.database, 'savePlan', { id: p.planId, budget: 300 }, 'Principe');
    const submission = {
      location: 'Italy', city: 'Rome', start: '2026-11-01', end: '2026-11-02',
      accom: 0, travel: 0, groceries: 0, eat: 0, fuel: 0, tolls: 0, other: 0,
      otherNote: '', paid: 0, uncertain: {},
    };
    const first = action(c.database, 'savePlanSubmission', { planId: p.planId, submission });
    action(c.database, 'savePlanSubmission', { planId: p.planId, submission }, 'Principe');
    const expense = action(c.database, 'saveTripExpense', {
      planId: p.planId,
      expense: { category: 'food', foodType: 'groceries', amount: 24, paidBy: 'Principessa', split: 'shared', date: '2026-11-01' },
    });
    action(c.database, 'confirmTrip', { id: first.tripId });
    action(c.database, 'confirmTrip', { id: first.tripId }, 'Principe');

    const blockedExpense = action(c.database, 'deleteTripExpense', { planId: p.planId, expenseId: expense.expense.id });
    assert.equal(blockedExpense.ok, false);
    assert.match(blockedExpense.error, /Confirmed trip expenses cannot be deleted/);
    assert.equal(getState().plans[0].expenseEntries.length, 1);

    const blocked = action(c.database, 'deleteCurrentTrip', { kind: 'plan', id: p.planId });
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /Confirmed trips cannot be deleted/);
    assert.equal(getState().plans.length, 1);
    assert.equal(getState().trips.length, 1);
  } finally {
    c.cleanup();
  }
});

test('logs partial trip repayments without double-counting the trip expense', () => {
  const c = setup();
  try {
    const p = action(c.database, 'savePlan', {
      meta: { location: 'Italy', city: 'Lonato', start: '2026-09-19', end: '2026-09-22' },
      budget: 600,
    });

    const stay = action(c.database, 'saveTripExpense', {
      planId: p.planId,
      expense: {
        category: 'accommodation',
        amount: 400,
        paidBy: 'Principe',
        split: 'shared',
        date: '2026-09-20',
        useJar: false,
      },
    }, 'Principe');
    assert.equal(stay.ok, true);

    const first = action(c.database, 'saveTripRepayment', {
      planId: p.planId,
      amount: 50,
      date: '2026-09-30',
      category: 'stay',
    }, 'Principessa');
    assert.equal(first.ok, true);
    assert.equal(first.settlement.debtor, 'Principessa');
    assert.equal(first.settlement.creditor, 'Principe');
    assert.equal(first.settlement.amount, 150);

    const tooMuch = action(c.database, 'saveTripRepayment', {
      planId: p.planId,
      amount: 151,
      date: '2026-10-01',
      category: 'stay',
    }, 'Principessa');
    assert.equal(tooMuch.ok, false);
    assert.match(tooMuch.error, /only owe €150\.00/i);

    const second = action(c.database, 'saveTripRepayment', {
      planId: p.planId,
      amount: 100,
      date: '2026-10-15',
      category: 'stay',
    }, 'Principessa');
    assert.equal(second.ok, true);
    assert.equal(second.settlement.amount, 50);

    const final = action(c.database, 'saveTripRepayment', {
      planId: p.planId,
      amount: 50,
      date: '2026-10-31',
      category: 'stay',
    }, 'Principessa');
    assert.equal(final.ok, true);
    assert.equal(final.settlement.amount, 0);
    assert.equal(final.settlement.debtor, '');
    assert.equal(final.settlement.creditor, '');

    const state = getState();
    const plan = state.plans.find((item) => item.id === p.planId);
    assert.equal(plan.expenseEntries.length, 1);
    assert.equal(plan.expenseEntries[0].amount, 400);
    assert.equal(plan.repayments.length, 3);
    assert.equal(plan.repayments.reduce((sum, item) => sum + Number(item.amount || 0), 0), 200);

    const extra = action(c.database, 'saveTripRepayment', {
      planId: p.planId,
      amount: 1,
      date: '2026-11-01',
      category: 'stay',
    }, 'Principessa');
    assert.equal(extra.ok, false);
    assert.match(extra.error, /do not owe anything/i);
  } finally {
    c.cleanup();
  }
});



test('past planned trips stay open until both users confirm the current logged expenses', () => {
  const c = setup();
  try {
    const p = action(c.database, 'savePlan', {
      meta: { location: 'Italy', city: 'Lonato', start: '2020-01-01', end: '2020-01-03' },
      budget: 300,
    });
    action(c.database, 'savePlan', { id: p.planId, budget: 250 }, 'Principe');
    const saved = action(c.database, 'saveTripExpense', {
      planId: p.planId,
      expense: { category: 'food', foodType: 'groceries', amount: 40, paidBy: 'Principessa', split: 'shared', date: '2020-01-02' },
    });

    const first = action(c.database, 'confirmPlanTrip', { planId: p.planId });
    assert.equal(first.ok, true);
    assert.equal(first.locked, false);
    assert.equal(first.confirmed.Principessa, true);
    assert.equal(first.confirmed.Principe, false);
    assert.ok(getState().plans[0].linkedTripId);
    assert.equal(getState().trips[0].submissions.Principessa.groceries, 40);
    assert.equal(getState().trips[0].submissions.Principe.groceries, 40);

    action(c.database, 'saveTripExpense', {
      planId: p.planId,
      expense: { id: saved.expense.id, category: 'food', foodType: 'groceries', amount: 60, paidBy: 'Principessa', split: 'shared', date: '2020-01-02' },
    });
    assert.deepEqual(getState().trips[0].confirmed, { Principessa: false, Principe: false });

    assert.equal(action(c.database, 'confirmPlanTrip', { planId: p.planId }).locked, false);
    const final = action(c.database, 'confirmPlanTrip', { planId: p.planId }, 'Principe');
    assert.equal(final.locked, true);
    assert.deepEqual(getState().trips[0].confirmed, { Principessa: true, Principe: true });
    assert.equal(getState().trips[0].submissions.Principessa.groceries, 60);
    assert.equal(getState().trips[0].submissions.Principe.groceries, 60);
  } finally {
    c.cleanup();
  }
});

test('blocks trip confirmation when payments do not cover the trip total', () => {
  const c = setup();
  try {
    const meta = { location:'Italy', city:'Test', start:'2020-01-01', end:'2020-01-03' };
    const created = action(c.database, 'savePlan', { meta, budget:300 });
    const principessa = { ...meta, accom:0, groceries:100, eat:0, travel:0, fuel:0, tolls:0, other:0, otherNote:'', paid:50, uncertain:{} };
    const principe = { ...principessa, paid:20 };
    const first = action(c.database, 'savePlanSubmission', { planId:created.planId, submission:principessa });
    assert.equal(first.ok, true);
    assert.equal(action(c.database, 'savePlanSubmission', { planId:created.planId, submission:principe }, 'Principe').ok, true);

    const result = action(c.database, 'confirmTrip', { id:first.tripId });
    assert.equal(result.ok, false);
    assert.match(result.error, /payments do not match trip expenses/i);
    assert.deepEqual(getState().trips[0].confirmed, { Principessa:false, Principe:false });
  } finally {
    c.cleanup();
  }
});

test('Shared Jar contributions count as assigned payment when confirming a planned trip', () => {
  const c = setup();
  try {
    const created = action(c.database, 'savePlan', {
      meta:{ location:'Italy', city:'Test', start:'2020-01-01', end:'2020-01-03' },
      budget:600,
    });
    action(c.database, 'saveTripExpense', {
      planId:created.planId,
      expense:{ category:'accommodation', amount:500, paidBy:'Principessa', split:'shared', date:'2020-01-02', useJar:true },
    });
    const repayment = action(c.database, 'saveTripRepayment', {
      planId:created.planId, amount:200, date:'2020-01-04', category:'stay',
    }, 'Principe');
    assert.equal(repayment.ok, true);

    const first = action(c.database, 'confirmPlanTrip', { planId:created.planId });
    assert.equal(first.ok, true);
    assert.equal(first.locked, false);
    const second = action(c.database, 'confirmPlanTrip', { planId:created.planId }, 'Principe');
    assert.equal(second.ok, true);
    assert.equal(second.locked, true);
    assert.equal(getState().trips[0].confirmed.Principessa, true);
    assert.equal(getState().trips[0].confirmed.Principe, true);
  } finally {
    c.cleanup();
  }
});

test('planned trips cannot be confirmed before their end date has passed', () => {
  const c = setup();
  try {
    const p = action(c.database, 'savePlan', {
      meta: { location: 'Italy', city: 'Rome', start: '2099-01-01', end: '2099-01-03' },
      budget: 300,
    });
    const result = action(c.database, 'confirmPlanTrip', { planId: p.planId });
    assert.equal(result.ok, false);
    assert.match(result.error, /after it has ended/);
  } finally {
    c.cleanup();
  }
});


test('trip repayments can target a category and keep an optional note', () => {
  const c = setup();
  try {
    const p = action(c.database, 'savePlan', {
      meta: { location: 'Italy', city: 'Lonato', start: '2026-09-19', end: '2026-09-22' },
      budget: 600,
    });
    action(c.database, 'saveTripExpense', {
      planId: p.planId,
      expense: { category:'accommodation', amount:200, paidBy:'Principe', split:'shared', date:'2026-09-20', useJar:false },
    }, 'Principe');
    action(c.database, 'saveTripExpense', {
      planId: p.planId,
      expense: { category:'food', foodType:'groceries', amount:80, paidBy:'Principe', split:'shared', date:'2026-09-21' },
    }, 'Principe');

    const first = action(c.database, 'saveTripRepayment', {
      planId:p.planId, amount:60, date:'2026-09-23', category:'stay', note:'My part of the Airbnb',
    }, 'Principessa');
    assert.equal(first.ok, true);
    assert.equal(first.settlement.amount, 80);

    const plan = getState().plans.find((item) => item.id === p.planId);
    assert.equal(plan.repayments[0].category, 'stay');
    assert.equal(plan.repayments[0].note, 'My part of the Airbnb');

    const tooMuchStay = action(c.database, 'saveTripRepayment', {
      planId:p.planId, amount:41, date:'2026-09-24', category:'stay',
    }, 'Principessa');
    assert.equal(tooMuchStay.ok, false);
    assert.match(tooMuchStay.error, /only owe €40\.00 for Stay/i);

    const groceries = action(c.database, 'saveTripRepayment', {
      planId:p.planId, amount:40, date:'2026-09-24', category:'groceries',
    }, 'Principessa');
    assert.equal(groceries.ok, true);
    assert.equal(groceries.settlement.amount, 40);
  } finally {
    c.cleanup();
  }
});


test('legacy uncategorized repayments reduce the current category debt instead of appearing twice', () => {
  const c = setup();
  try {
    const p = action(c.database, 'savePlan', {
      meta: { location:'Italy', city:'Lonato', start:'2026-09-19', end:'2026-09-22' },
      budget: 600,
    });

    action(c.database, 'saveTripExpense', {
      planId:p.planId,
      expense:{ category:'accommodation', amount:281.60, paidBy:'Principe', split:'shared', date:'2026-09-20', useJar:false },
    }, 'Principe');

    const state = getState();
    const plan = state.plans.find((item)=>item.id===p.planId);
    plan.repayments.push({
      id:'legacy-repayment',
      from:'Principessa',
      to:'Principe',
      amount:110.80,
      date:'2026-09-22',
      createdAt:'2026-09-22T12:00:00.000Z',
    });
    c.database.store.write(state);

    const tooMuch = action(c.database, 'saveTripRepayment', {
      planId:p.planId,
      amount:30.01,
      date:'2026-09-23',
      category:'stay',
    }, 'Principessa');
    assert.equal(tooMuch.ok, false);
    assert.match(tooMuch.error, /only owe €30\.00 for Stay/i);

    const final = action(c.database, 'saveTripRepayment', {
      planId:p.planId,
      amount:30,
      date:'2026-09-23',
      category:'stay',
      note:'Final stay repayment',
    }, 'Principessa');
    assert.equal(final.ok, true);
    assert.equal(final.settlement.amount, 0);

    const saved = getState().plans.find((item)=>item.id===p.planId);
    assert.equal(saved.repayments.length, 2);
    assert.equal(saved.repayments[0].amount, 110.8);
    assert.equal(saved.repayments[0].category, '');
    assert.equal(saved.repayments[1].category, 'stay');
    assert.equal(saved.repayments[1].note, 'Final stay repayment');
  } finally {
    c.cleanup();
  }
});


test('legacy repayment stays with the debt that existed before a later grocery expense', () => {
  const c = setup();
  try {
    const p = action(c.database, 'savePlan', {
      meta: { location:'Italy', city:'Lonato', start:'2026-09-19', end:'2026-09-22' },
      budget:600,
    });

    action(c.database, 'saveTripExpense', {
      planId:p.planId,
      expense:{ category:'accommodation', amount:281.60, paidBy:'Principessa', split:'shared', date:'2026-09-20', useJar:false },
    }, 'Principessa');

    const state = getState();
    const plan = state.plans.find((item)=>item.id===p.planId);
    plan.repayments.push({
      id:'legacy-stay-paid',
      from:'Principe',
      to:'Principessa',
      amount:140.80,
      date:'2026-09-21',
      createdAt:'2026-09-21T10:00:00.000Z',
    });
    c.database.store.write(state);

    action(c.database, 'saveTripExpense', {
      planId:p.planId,
      expense:{ category:'food', foodType:'groceries', amount:60, paidBy:'Principessa', split:'shared', date:'2026-09-22' },
    }, 'Principessa');

    const stay = action(c.database, 'saveTripRepayment', {
      planId:p.planId,
      amount:1,
      date:'2026-09-23',
      category:'stay',
    }, 'Principe');
    assert.equal(stay.ok,false);
    assert.match(stay.error,/do not owe anything for Stay/i);

    const groceriesTooMuch = action(c.database, 'saveTripRepayment', {
      planId:p.planId,
      amount:30.01,
      date:'2026-09-23',
      category:'groceries',
    }, 'Principe');
    assert.equal(groceriesTooMuch.ok,false);
    assert.match(groceriesTooMuch.error,/only owe €30\.00 for Groceries/i);

    const groceries = action(c.database, 'saveTripRepayment', {
      planId:p.planId,
      amount:30,
      date:'2026-09-23',
      category:'groceries',
    }, 'Principe');
    assert.equal(groceries.ok,true);
    assert.equal(groceries.settlement.amount,0);
  } finally {
    c.cleanup();
  }
});
