import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPushItems } from '../src/push.js';

const actor = 'Principessa';
const amsterdam = 'Europe/Amsterdam';

test('finance reminders use the local calendar date and keep their UTC labels', () => {
  const state = {
    financeProfiles: {
      [actor]: {
        recurring: { custom: true, expenses: [{ name: 'Rent', group: 'rent', day: 1, amount: 50 }] },
        financeReminders: [{ id: 'snapshot', name: 'Investment', kind: 'investment-snapshot', month: '2026-11', date: '2026-11-01' }],
      },
    },
  };
  const beforeMidnight = new Date('2026-10-31T22:59:59Z');
  const midnight = new Date('2026-10-31T23:00:00Z');

  assert.deepEqual(buildPushItems(state, actor, amsterdam, beforeMidnight).map(item => item.eventKey), ['finance:Principessa:2026-10:expense:rent:rent']);
  const due = buildPushItems(state, actor, amsterdam, midnight);
  assert.deepEqual(due.map(item => item.body), ['Update Nov 2026 investment value', '€50 · 1 Nov']);
  assert.deepEqual(buildPushItems(state, actor, 'Invalid/Zone', midnight), due);
  assert.deepEqual(buildPushItems(state, actor, '', midnight), due);
});

test('trip reminders keep the local noon threshold through both daylight-saving transitions', () => {
  for (const [start, noon] of [
    ['2026-03-30', '2026-03-29T10:00:00Z'],
    ['2026-10-26', '2026-10-25T11:00:00Z'],
  ]) {
    const state = { plans: [{ id: 'trip', meta: { start }, prep: { packing: [{ text: 'Pack' }] } }] };
    const beforeNoon = new Date(Date.parse(noon) - 1000);

    assert.equal(buildPushItems(state, actor, amsterdam, beforeNoon)[0]?.eventKey, 'trip-prep:trip:two-days');
    assert.equal(buildPushItems(state, actor, amsterdam, new Date(noon))[0]?.eventKey, 'trip-prep:trip:important');
  }
});

test('push evaluations reuse both formatters per time zone and retain up to eight zones', async (t) => {
  const DateTimeFormat = Intl.DateTimeFormat;
  const constructor = t.mock.method(Intl, 'DateTimeFormat', function (...args) {
    return new DateTimeFormat(...args);
  });
  const { buildPushItems: buildItems } = await import('../src/push.js?cache-test');
  const zones = ['UTC', amsterdam, 'Europe/Rome', 'Asia/Tokyo', 'Africa/Cairo', 'America/New_York', 'Pacific/Auckland', 'Asia/Kolkata'];

  for (const zone of zones) buildItems({}, actor, zone);
  assert.equal(constructor.mock.callCount(), 2 + 2 * zones.length);
  for (const zone of zones) buildItems({}, actor, zone);
  assert.equal(constructor.mock.callCount(), 18);

  buildItems({}, actor, 'Europe/London');
  buildItems({}, actor, zones[0]);
  assert.equal(constructor.mock.callCount(), 22);
});
