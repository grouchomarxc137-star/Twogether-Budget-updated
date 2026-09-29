import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';

const ACTORS = new Set(['Principessa', 'Principe']);
const FALLBACK_TIMEZONE = 'Europe/Amsterdam';
const CHECKLIST_DEFAULTS = {
  packing: ['Toothbrushes', 'Slippers', 'Hair brush', 'Shampoo', 'Conditioner', 'Shower gel', 'Dishwasher detergent'],
  reminders: ["Don't forget to put fuel", "Don't forget to ask mom to make work sandwich", "Don't forget to take pictures of the Airbnb when you arrive"],
};

const cleanText = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const amount = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const base64urlJson = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function validTimeZone(value) {
  const zone = cleanText(value, 80) || FALLBACK_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone }).format(new Date());
    return zone;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

function localIsoDate(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: validTimeZone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dayDiff(left, right) {
  const a = Date.parse(String(left || '') + 'T12:00:00Z');
  const b = Date.parse(String(right || '') + 'T12:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

function localWallClock(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: validTimeZone(timeZone),
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second),
  };
}

function hoursUntilTripStart(value, timeZone, now = new Date()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const current = localWallClock(timeZone, now);
  const start = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0);
  const localNow = Date.UTC(current.year, current.month - 1, current.day, current.hour, current.minute, current.second);
  if (!Number.isFinite(start) || !Number.isFinite(localNow)) return null;
  return (start - localNow) / 3600000;
}

function normalizeGroup(value) {
  const group = String(value || 'other');
  if (group === 'health') return 'medical';
  if (group === 'living') return 'rent';
  if (group === 'transport') return 'subscriptions';
  return group;
}

function financeRecord(state, actor, month) {
  return (state?.finances?.[actor] || []).find((item) => String(item?.month || '') === month) || null;
}

function financeReminderResolved(state, actor, reminder) {
  const record = financeRecord(state, actor, reminder.month);
  if (record?.finalized === true) return true;
  if (!record) return false;
  if (reminder.kind === 'investment-snapshot') {
    if (record.investmentTotal === '' || record.investmentTotal == null) return false;
    const snapshotAt = String(record.updatedAt || '');
    const requestedAt = String(reminder.createdAt || '');
    return !!snapshotAt && (!requestedAt || snapshotAt >= requestedAt);
  }
  const list = reminder.kind === 'income' ? (record.incomes || []) : (record.expenses || []);
  const name = String(reminder.name || '').trim().toLowerCase();
  return list.some((item) => {
    if (String(item?.name || '').trim().toLowerCase() !== name) return false;
    if (reminder.kind === 'expense' && normalizeGroup(item?.group) !== normalizeGroup(reminder.group)) return false;
    return true;
  });
}

function financeSlug(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';
}

function financeDateForDay(month, day) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  const value = Number(day);
  if (!match || !Number.isInteger(value) || value < 1 || value > 31) return '';
  const year = Number(match[1]), monthIndex = Number(match[2]);
  const last = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return `${match[1]}-${match[2]}-${String(Math.min(value, last)).padStart(2, '0')}`;
}

function financeQuestion(reminder) {
  if (reminder.kind === 'investment-snapshot') return "What's your investment worth now?";
  return reminder.kind === 'income' ? `Has ${reminder.name} arrived?` : `Has ${reminder.name} been charged?`;
}

function euro(value) {
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount(value));
}

function shortDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
}

function monthLabel(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
  if (!match) return String(value || '');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function buildFinancePushItems(state, actor, today) {
  const profile = state?.financeProfiles?.[actor] || {};
  const byId = new Map();
  const saved = Array.isArray(profile.financeReminders) ? profile.financeReminders : [];
  for (const raw of saved) {
    const reminder = {
      id: cleanText(raw?.id, 220), kind: raw?.kind === 'income' ? 'income' : raw?.kind === 'investment-snapshot' ? 'investment-snapshot' : 'expense',
      name: cleanText(raw?.name, 100), group: cleanText(raw?.group, 60), amount: raw?.amount,
      month: cleanText(raw?.month, 7), date: cleanText(raw?.date, 10), createdAt: cleanText(raw?.createdAt, 50),
    };
    if (!reminder.id || !reminder.name || reminder.date > today || financeReminderResolved(state, actor, reminder)) continue;
    byId.set(reminder.id, reminder);
  }

  const month = today.slice(0, 7);
  const record = financeRecord(state, actor, month);
  const recurring = profile?.recurring && profile.recurring.custom === true ? profile.recurring : null;
  if (record?.finalized !== true && recurring) {
    const rows = [
      ...(Array.isArray(recurring.incomes) ? recurring.incomes : []).map((item) => ({ kind: 'income', item })),
      ...(Array.isArray(recurring.expenses) ? recurring.expenses : []).map((item) => ({ kind: 'expense', item })),
    ];
    for (const { kind, item } of rows) {
      const day = Number(item?.day);
      if (!Number.isInteger(day) || day < 1 || day > 31) continue;
      const dueDate = financeDateForDay(month, day);
      if (!dueDate || dueDate > today) continue;
      const group = kind === 'expense' ? String(item?.group || '') : '';
      const id = ['finance', actor, month, kind, kind === 'expense' ? normalizeGroup(group) : '', financeSlug(item?.name)].join(':');
      const reminder = { id, kind, name: cleanText(item?.name, 100), group, amount: item?.amount, month, date: dueDate, createdAt: '' };
      if (!reminder.name || financeReminderResolved(state, actor, reminder)) continue;
      if (!byId.has(id)) byId.set(id, reminder);
    }
  }

  return [...byId.values()].map((reminder) => ({
    eventKey: reminder.id,
    tag: reminder.id,
    source: 'finances',
    title: financeQuestion(reminder),
    body: reminder.kind === 'investment-snapshot'
      ? `Update ${monthLabel(reminder.month)} investment value`
      : `${euro(reminder.amount)} · ${shortDate(reminder.date)}`,
    url: './?notifications=finances',
  }));
}

function settlementState(plan) {
  const paid = { Principessa: 0, Principe: 0 };
  const share = { Principessa: 0, Principe: 0 };
  for (const entry of Array.isArray(plan?.expenseEntries) ? plan.expenseEntries : []) {
    const remaining = Math.max(0, amount(entry?.amount) - amount(entry?.jarContribution));
    if (entry?.paidBy === 'both') { paid.Principessa += remaining / 2; paid.Principe += remaining / 2; }
    else if (paid[entry?.paidBy] != null) paid[entry.paidBy] += remaining;
    if (entry?.split === 'personal') share[entry?.forActor === 'Principe' ? 'Principe' : 'Principessa'] += remaining;
    else { share.Principessa += remaining / 2; share.Principe += remaining / 2; }
  }
  for (const repayment of Array.isArray(plan?.repayments) ? plan.repayments : []) {
    const value = amount(repayment?.amount);
    if (repayment?.from === 'Principessa' && repayment?.to === 'Principe') { paid.Principessa += value; paid.Principe -= value; }
    else if (repayment?.from === 'Principe' && repayment?.to === 'Principessa') { paid.Principe += value; paid.Principessa -= value; }
  }
  const delta = paid.Principessa - share.Principessa;
  if (Math.abs(delta) < .005) return { debtor: '', creditor: '', amount: 0 };
  return { debtor: delta > 0 ? 'Principe' : 'Principessa', creditor: delta > 0 ? 'Principessa' : 'Principe', amount: Math.abs(delta) };
}

function planName(meta) {
  return cleanText(meta?.city || (meta?.location === 'Other' ? meta?.otherLocation : meta?.location) || 'Trip', 100) || 'Trip';
}

function buildTripPushItems(state, actor, today, timeZone, now) {
  const items = [];
  const plans = Array.isArray(state?.plans) ? state.plans : [];
  const trips = Array.isArray(state?.trips) ? state.trips : [];
  for (const plan of plans) {
    const meta = plan?.meta || {};
    const start = cleanText(meta.start, 10);
    const hoursUntilStart = hoursUntilTripStart(start, timeZone, now);
    const reminderStage = hoursUntilStart != null && hoursUntilStart > 0 && hoursUntilStart <= 12
      ? 'important'
      : hoursUntilStart != null && hoursUntilStart > 12 && hoursUntilStart <= 48
        ? 'two-days'
        : '';
    const linked = plan?.linkedTripId ? trips.find((trip) => trip?.id === plan.linkedTripId) : null;
    const locked = !!(linked?.confirmed?.Principessa && linked?.confirmed?.Principe);
    if (!locked && reminderStage) {
      const stored = plan?.prep || {};
      const initialized = !!stored.updatedAt || (Array.isArray(stored.packing) && stored.packing.length) || (Array.isArray(stored.reminders) && stored.reminders.length);
      const fallback = state?.tripPrepDefaults || {};
      const prep = initialized ? stored : {
        packing: Array.isArray(fallback.packing) ? fallback.packing : CHECKLIST_DEFAULTS.packing.map((text) => ({ text, done: false })),
        reminders: Array.isArray(fallback.reminders) ? fallback.reminders : CHECKLIST_DEFAULTS.reminders.map((text) => ({ text, done: false })),
      };
      const reminders = (Array.isArray(prep.reminders) ? prep.reminders : []).filter((item) => !item?.done && cleanText(item?.text, 160));
      const packing = (Array.isArray(prep.packing) ? prep.packing : []).filter((item) => !item?.done && cleanText(item?.text, 160));
      if (reminders.length || packing.length) {
        const name = planName(meta);
        const title = reminderStage === 'important'
          ? `${name} starts soon — final checks`
          : `${name} is coming up ♡`;
        const parts = [];
        if (reminders.length) parts.push(`${reminders.length} important reminder${reminders.length === 1 ? '' : 's'}`);
        if (packing.length) parts.push(`${packing.length} packing item${packing.length === 1 ? '' : 's'}`);
        items.push({
          eventKey: `trip-prep:${plan.id}:${reminderStage}`,
          tag: `trip-prep:${plan.id}`,
          source: 'trips', title, body: parts.join(' · '), url: './?notifications=trips',
        });
      }
    }

    const end = cleanText(meta.end, 10);
    const daysAfterEnd = dayDiff(end, today);
    if (daysAfterEnd != null && daysAfterEnd >= 2) {
      const settlement = settlementState(plan);
      if (settlement.debtor && settlement.creditor && settlement.amount > .005 && (actor === settlement.debtor || actor === settlement.creditor)) {
        const cents = Math.round(settlement.amount * 100);
        const title = actor === settlement.debtor
          ? `You still need to pay ${settlement.creditor} ${euro(settlement.amount)}`
          : `${settlement.debtor} still needs to pay you ${euro(settlement.amount)}`;
        items.push({
          eventKey: `trip-repayment:${plan.id}:${actor}:${settlement.debtor}:${settlement.creditor}:${cents}`,
          tag: `trip-repayment:${plan.id}:${actor}`,
          source: 'trips', title,
          body: `${planName(meta)} · ended ${daysAfterEnd} day${daysAfterEnd === 1 ? '' : 's'} ago`,
          url: './?notifications=trips',
        });
      }
    }
  }
  return items;
}

export function buildPushItems(state, actor, timeZone, now = new Date()) {
  const today = localIsoDate(timeZone, now);
  return [...buildTripPushItems(state, actor, today, timeZone, now), ...buildFinancePushItems(state, actor, today)];
}

function ensureVapidKeys(db) {
  const get = db.prepare('SELECT value FROM push_settings WHERE key = ?');
  const put = db.prepare('INSERT INTO push_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  let publicKey = get.get('vapidPublicKey')?.value || '';
  let privateJwkText = get.get('vapidPrivateJwk')?.value || '';
  if (!publicKey || !privateJwkText) {
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const publicJwk = pair.publicKey.export({ format: 'jwk' });
    const privateJwk = pair.privateKey.export({ format: 'jwk' });
    publicKey = Buffer.concat([
      Buffer.from([4]), Buffer.from(publicJwk.x, 'base64url'), Buffer.from(publicJwk.y, 'base64url'),
    ]).toString('base64url');
    privateJwkText = JSON.stringify(privateJwk);
    const tx = db.transaction(() => {
      put.run('vapidPublicKey', publicKey);
      put.run('vapidPrivateJwk', privateJwkText);
    });
    tx();
  }
  return { publicKey, privateJwk: JSON.parse(privateJwkText) };
}

function vapidToken(privateJwk, endpoint) {
  const header = base64urlJson({ typ: 'JWT', alg: 'ES256' });
  const payload = base64urlJson({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + (12 * 60 * 60),
    sub: 'mailto:twogether@example.com',
  });
  const unsigned = `${header}.${payload}`;
  const key = createPrivateKey({ key: privateJwk, format: 'jwk' });
  const signature = sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${unsigned}.${signature}`;
}

export function createPushService({ db, readState }) {
  const keys = ensureVapidKeys(db);
  const upsertSubscription = db.prepare(`
    INSERT INTO push_subscriptions (actor, endpoint, p256dh, auth, timezone, created_at, updated_at)
    VALUES (@actor, @endpoint, @p256dh, @auth, @timezone, @now, @now)
    ON CONFLICT(endpoint) DO UPDATE SET actor=excluded.actor, p256dh=excluded.p256dh, auth=excluded.auth,
      timezone=excluded.timezone, updated_at=excluded.updated_at
  `);
  const subscriptionByEndpoint = db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?');
  const allSubscriptions = db.prepare('SELECT * FROM push_subscriptions ORDER BY id');
  const deleteSubscription = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?');
  const clearPendingMessages = db.prepare('DELETE FROM push_messages WHERE subscription_id = ? AND claimed_at IS NULL');
  const insertMessage = db.prepare(`
    INSERT OR IGNORE INTO push_messages (subscription_id, event_key, tag, source, title, body, url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const unclaimedMessages = db.prepare(`
    SELECT id, event_key, tag, source, title, body, url, created_at FROM push_messages
    WHERE subscription_id = ? AND claimed_at IS NULL ORDER BY id LIMIT 20
  `);
  const claimMessage = db.prepare('UPDATE push_messages SET claimed_at = ? WHERE id = ? AND claimed_at IS NULL');
  const unclaimedCount = db.prepare('SELECT COUNT(*) AS count FROM push_messages WHERE subscription_id = ? AND claimed_at IS NULL');
  const updateLastPush = db.prepare('UPDATE push_subscriptions SET last_push_at = ? WHERE id = ?');
  const pruneMessages = db.prepare("DELETE FROM push_messages WHERE created_at < datetime('now', '-120 days')");

  let evaluating = false;
  let queued = false;
  let soonTimer = null;
  const testTimers = new Set();

  async function sendWake(subscription) {
    const jwt = vapidToken(keys.privateJwk, subscription.endpoint);
    let response;
    try {
      response = await fetch(subscription.endpoint, {
        method: 'POST',
        headers: {
          TTL: '86400',
          Urgency: 'normal',
          Authorization: `vapid t=${jwt}, k=${keys.publicKey}`,
        },
      });
    } catch (error) {
      console.warn('Push delivery failed:', error?.message || error);
      return false;
    }
    if (response.status === 404 || response.status === 410) {
      deleteSubscription.run(subscription.endpoint);
      return false;
    }
    if (!response.ok) {
      console.warn('Push service returned', response.status);
      return false;
    }
    updateLastPush.run(new Date().toISOString(), subscription.id);
    return true;
  }

  async function evaluate() {
    if (evaluating) { queued = true; return; }
    evaluating = true;
    try {
      do {
        queued = false;
        pruneMessages.run();
        const state = readState();
        const now = new Date();
        for (const subscription of allSubscriptions.all()) {
          if (!ACTORS.has(subscription.actor)) continue;
          const items = buildPushItems(state, subscription.actor, subscription.timezone, now);
          let inserted = 0;
          const stamp = now.toISOString();
          for (const item of items) {
            inserted += insertMessage.run(subscription.id, item.eventKey, item.tag, item.source, item.title, item.body, item.url, stamp).changes;
          }
          const pending = Number(unclaimedCount.get(subscription.id)?.count || 0);
          if (!pending) continue;
          const lastPush = Date.parse(subscription.last_push_at || '') || 0;
          const retryDue = !lastPush || (Date.now() - lastPush) >= 30 * 60 * 1000;
          if (inserted > 0 || retryDue) await sendWake(subscription);
        }
      } while (queued);
    } finally {
      evaluating = false;
    }
  }

  function evaluateSoon() {
    if (soonTimer) clearTimeout(soonTimer);
    soonTimer = setTimeout(() => {
      soonTimer = null;
      evaluate().catch((error) => console.warn('Push evaluation failed:', error?.message || error));
    }, 350);
    soonTimer.unref?.();
  }

  function subscribe(actorValue, subscriptionValue, timeZoneValue) {
    const actor = cleanText(actorValue, 30);
    if (!ACTORS.has(actor)) throw new Error('Choose Principessa or Principe first');
    const input = subscriptionValue && typeof subscriptionValue === 'object' ? subscriptionValue : {};
    const endpoint = cleanText(input.endpoint, 4000);
    const p256dh = cleanText(input.keys?.p256dh, 500);
    const auth = cleanText(input.keys?.auth, 500);
    if (!endpoint.startsWith('https://') || !p256dh || !auth) throw new Error('Invalid push subscription');
    const previous = subscriptionByEndpoint.get(endpoint);
    const now = new Date().toISOString();
    upsertSubscription.run({ actor, endpoint, p256dh, auth, timezone: validTimeZone(timeZoneValue), now });
    const saved = subscriptionByEndpoint.get(endpoint);
    if (previous && saved && previous.actor !== actor) clearPendingMessages.run(saved.id);
    evaluateSoon();
    return { ok: true };
  }

  function unsubscribe(endpointValue) {
    const endpoint = cleanText(endpointValue, 4000);
    if (endpoint) deleteSubscription.run(endpoint);
    return { ok: true };
  }

  function claim(endpointValue) {
    const endpoint = cleanText(endpointValue, 4000);
    const subscription = endpoint ? subscriptionByEndpoint.get(endpoint) : null;
    if (!subscription) return { ok: true, messages: [] };
    const rows = unclaimedMessages.all(subscription.id);
    const claimedAt = new Date().toISOString();
    const tx = db.transaction(() => rows.forEach((row) => claimMessage.run(claimedAt, row.id)));
    tx();
    return { ok: true, messages: rows.map((row) => ({
      id: String(row.id), tag: row.tag, source: row.source, title: row.title, body: row.body, url: row.url,
    })) };
  }

  function scheduleTest(endpointValue) {
    const endpoint = cleanText(endpointValue, 4000);
    const subscription = endpoint ? subscriptionByEndpoint.get(endpoint) : null;
    if (!subscription) throw new Error('Phone notifications are not enabled on this device');

    const timer = setTimeout(async () => {
      testTimers.delete(timer);
      const current = subscriptionByEndpoint.get(endpoint);
      if (!current) return;
      const now = new Date().toISOString();
      const eventKey = 'push-test:' + Date.now() + ':' + current.id;
      insertMessage.run(
        current.id,
        eventKey,
        'push-test',
        'test',
        'Test notification ♡',
        'Phone notifications are working.',
        './',
        now,
      );
      await sendWake(current);
    }, 60000);
    timer.unref?.();
    testTimers.add(timer);
    return { ok:true, delaySeconds:60 };
  }

  const interval = setInterval(() => evaluate().catch((error) => console.warn('Push evaluation failed:', error?.message || error)), 5 * 60 * 1000);
  interval.unref?.();
  const initial = setTimeout(() => evaluate().catch((error) => console.warn('Initial push evaluation failed:', error?.message || error)), 5000);
  initial.unref?.();

  return {
    publicKey: keys.publicKey,
    subscribe,
    unsubscribe,
    claim,
    scheduleTest,
    evaluateSoon,
    close() {
      clearInterval(interval);
      clearTimeout(initial);
      if (soonTimer) clearTimeout(soonTimer);
      for (const timer of testTimers) clearTimeout(timer);
      testTimers.clear();
    },
  };
}
