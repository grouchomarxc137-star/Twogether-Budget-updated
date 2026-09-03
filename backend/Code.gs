const STATE_KEY = 'TOGETHER_BUDGET_STATE_V1';
const MAX_AUDIT = 2;
const ACTORS = ['Principessa', 'Principe'];
const MONEY_FIELDS = ['accom','groceries','eat','travel','fuel','tolls','other'];

function defaultState_() {
  return {
    version: 4,
    trips: [],
    plans: [],
    compare: {
      rent: 600, utilities: 120, condo: 0, stilltravel: 180, food: 250,
      carpay: 250, insurance: 90, tax: 45, carfuel: 120, maintenance: 50
    },
    audit: [],
    updatedAt: ''
  };
}

function readState_() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(STATE_KEY);
  if (!raw) return defaultState_();

  try {
    const parsed = JSON.parse(raw);
    const base = defaultState_();
    const state = {
      version: 4,
      trips: Array.isArray(parsed.trips) ? parsed.trips.map(migrateTrip_) : [],
      plans: Array.isArray(parsed.plans) ? parsed.plans.map(sanitizePlan_) : [],
      compare: Object.assign(base.compare, parsed.compare || {}),
      audit: Array.isArray(parsed.audit) ? parsed.audit.slice(-MAX_AUDIT) : [],
      updatedAt: parsed.updatedAt || ''
    };

    if (Array.isArray(parsed.audit) && parsed.audit.length > MAX_AUDIT) {
      props.setProperty(STATE_KEY, JSON.stringify(state));
    }
    return state;
  } catch (err) {
    return defaultState_();
  }
}

function migrateTrip_(trip) {
  if (trip && trip.submissions) return sanitizeTripRecord_(trip);

  const who = cleanActor_(trip && (trip.updatedBy || trip.createdBy));
  const actor = who === 'Unknown' ? 'Principessa' : who;
  const submission = sanitizeSubmission_({
    location: trip && trip.location,
    otherLocation: trip && trip.otherLocation,
    city: trip && trip.city,
    start: trip && trip.start,
    end: trip && trip.end,
    accom: trip && trip.accom,
    groceries: trip && trip.groceries,
    eat: trip && trip.eat,
    travel: trip && trip.travel,
    fuel: trip && trip.fuel,
    tolls: trip && trip.tolls,
    other: trip && trip.other,
    otherNote: trip && trip.otherNote,
    paid: actor === 'Principessa' ? (trip && trip.you) : (trip && trip.him),
    uncertain: {}
  }, actor);

  const now = new Date().toISOString();
  const out = {
    id: cleanText_(trip && trip.id, 80) || Utilities.getUuid(),
    budget: cleanMoney_(trip && trip.budget),
    submissions: {Principessa:null, Principe:null},
    confirmed: {Principessa:false, Principe:false},
    createdAt: cleanText_(trip && trip.createdAt, 40) || now,
    createdBy: cleanActor_(trip && trip.createdBy) === 'Unknown' ? actor : cleanActor_(trip && trip.createdBy),
    updatedAt: cleanText_(trip && trip.updatedAt, 40) || now,
    updatedBy: cleanActor_(trip && trip.updatedBy) === 'Unknown' ? actor : cleanActor_(trip && trip.updatedBy)
  };
  out.submissions[actor] = submission;
  return out;
}

function saveState_(state) {
  state.version = 4;
  state.updatedAt = new Date().toISOString();
  state.audit = Array.isArray(state.audit) ? state.audit.slice(-MAX_AUDIT) : [];
  state.plans = Array.isArray(state.plans) ? state.plans.map(sanitizePlan_) : [];
  PropertiesService.getScriptProperties().setProperty(STATE_KEY, JSON.stringify(state));
}

function output_(obj, callback) {
  const json = JSON.stringify(obj);
  if (callback && /^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = String(p.action || 'state').toLowerCase();
  const callback = String(p.callback || '');
  try {
    if (action === 'ping') return output_({ok:true, version:4, now:new Date().toISOString()}, callback);
    if (action === 'state') return output_({ok:true, state:readState_()}, callback);
    return output_({ok:false, error:'Unknown action'}, callback);
  } catch (err) {
    return output_({ok:false, error:String(err && err.message || err)}, callback);
  }
}

function doPost(e) {
  const p = (e && e.parameter) || {};
  const action = String(p.action || '');
  const actor = cleanActor_(p.actor);
  let payload = {};
  try { payload = JSON.parse(p.payload || '{}'); } catch (err) {}

  if (actor === 'Unknown') return output_({ok:false, error:'Choose Principessa or Principe first'});

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const state = readState_();

    if (action === 'savePlan') {
      const id = cleanText_(payload.id, 80);
      const now = new Date().toISOString();
      let idx = id ? state.plans.findIndex(x => x.id === id) : -1;
      let plan;

      if (idx >= 0) {
        plan = sanitizePlan_(state.plans[idx]);
        if (payload.meta && actor === plan.createdBy) {
          plan.meta = sanitizePlanMeta_(payload.meta);
        }
      } else {
        const meta = sanitizePlanMeta_(payload.meta || {});
        if (!meta.location || !meta.city || !meta.start || !meta.end) {
          throw new Error('Add the trip location, city and dates first');
        }
        plan = {
          id: Utilities.getUuid(),
          meta: meta,
          budgets: {Principessa:'', Principe:''},
          linkedTripId: '',
          createdAt: now,
          createdBy: actor,
          updatedAt: now,
          updatedBy: actor
        };
        state.plans.push(plan);
        idx = state.plans.length - 1;
      }

      const budget = cleanMoney_(payload.budget);
      if (budget === '') throw new Error('Enter your individual budget');
      plan.budgets[actor] = budget;
      plan.updatedAt = now;
      plan.updatedBy = actor;
      state.plans[idx] = plan;
      addAudit_(state, actor, 'setIndividualBudget', plan.id);
      saveState_(state);
      return output_({ok:true, planId:plan.id});
    }

    if (action === 'savePlanSubmission') {
      const planId = cleanText_(payload.planId, 80);
      const planIdx = state.plans.findIndex(x => x.id === planId);
      if (planIdx < 0) throw new Error('Budget plan not found');
      const plan = sanitizePlan_(state.plans[planIdx]);
      const now = new Date().toISOString();
      let tripIdx = plan.linkedTripId ? state.trips.findIndex(t => t.id === plan.linkedTripId) : -1;
      let trip;

      if (tripIdx >= 0) {
        trip = sanitizeTripRecord_(state.trips[tripIdx]);
        if (trip.confirmed.Principessa && trip.confirmed.Principe) {
          throw new Error('This trip is already confirmed by both of you');
        }
      } else {
        trip = {
          id: Utilities.getUuid(),
          budget: '',
          submissions: {Principessa:null, Principe:null},
          confirmed: {Principessa:false, Principe:false},
          createdAt: now,
          createdBy: actor,
          updatedAt: now,
          updatedBy: actor
        };
        state.trips.push(trip);
        tripIdx = state.trips.length - 1;
        plan.linkedTripId = trip.id;
      }

      const merged = Object.assign({}, payload.submission || {}, plan.meta || {});
      const incoming = sanitizeSubmission_(merged, actor);
      const wasExisting = !!trip.submissions[actor];
      incoming.submittedAt = now;
      incoming.submittedBy = actor;
      trip.submissions[actor] = incoming;
      trip.confirmed = {Principessa:false, Principe:false};
      trip.updatedAt = now;
      trip.updatedBy = actor;
      state.trips[tripIdx] = trip;

      plan.updatedAt = now;
      plan.updatedBy = actor;
      state.plans[planIdx] = plan;
      addAudit_(state, actor, wasExisting ? 'updateSubmission' : 'addSubmission', trip.id);
      saveState_(state);
      return output_({ok:true, tripId:trip.id, planId:plan.id});
    }

    if (action === 'saveSubmission') {
      const incoming = sanitizeSubmission_(payload.submission || {}, actor);
      const tripId = cleanText_(payload.tripId, 80);
      const now = new Date().toISOString();
      let idx = tripId ? state.trips.findIndex(t => t.id === tripId) : -1;
      let trip;

      if (idx >= 0) {
        trip = sanitizeTripRecord_(state.trips[idx]);
        if (trip.confirmed.Principessa && trip.confirmed.Principe) {
          throw new Error('This trip is already confirmed by both of you');
        }
      } else {
        trip = {
          id: Utilities.getUuid(),
          budget: cleanMoney_(payload.budget),
          submissions: {Principessa:null, Principe:null},
          confirmed: {Principessa:false, Principe:false},
          createdAt: now,
          createdBy: actor,
          updatedAt: now,
          updatedBy: actor
        };
        state.trips.push(trip);
        idx = state.trips.length - 1;
      }

      const wasExisting = !!trip.submissions[actor];
      incoming.submittedAt = now;
      incoming.submittedBy = actor;
      trip.submissions[actor] = incoming;
      trip.confirmed = {Principessa:false, Principe:false};
      trip.updatedAt = now;
      trip.updatedBy = actor;
      state.trips[idx] = trip;
      addAudit_(state, actor, wasExisting ? 'updateSubmission' : 'addSubmission', trip.id);
      saveState_(state);
      return output_({ok:true, tripId:trip.id});
    }

    if (action === 'confirmTrip') {
      const id = cleanText_(payload.id, 80);
      const idx = state.trips.findIndex(t => t.id === id);
      if (idx < 0) throw new Error('Trip not found');
      const trip = sanitizeTripRecord_(state.trips[idx]);
      if (!trip.submissions.Principessa || !trip.submissions.Principe) {
        throw new Error('Both versions must be logged before confirming');
      }
      if (!submissionsMatch_(trip.submissions.Principessa, trip.submissions.Principe)) {
        throw new Error('Your versions still differ. Edit them until they match first.');
      }
      trip.confirmed[actor] = true;
      trip.updatedAt = new Date().toISOString();
      trip.updatedBy = actor;
      state.trips[idx] = trip;
      addAudit_(state, actor, 'confirmTrip', trip.id);
      saveState_(state);
      return output_({ok:true});
    }

    if (action === 'updateTripBudget') {
      const id = cleanText_(payload.id, 80);
      const idx = state.trips.findIndex(t => t.id === id);
      if (idx < 0) throw new Error('Trip not found');
      const trip = sanitizeTripRecord_(state.trips[idx]);
      if (trip.confirmed.Principessa && trip.confirmed.Principe) {
        throw new Error('This trip is already confirmed by both of you');
      }
      trip.budget = cleanMoney_(payload.budget);
      trip.confirmed = {Principessa:false, Principe:false};
      trip.updatedAt = new Date().toISOString();
      trip.updatedBy = actor;
      state.trips[idx] = trip;
      addAudit_(state, actor, 'updateTripBudget', trip.id);
      saveState_(state);
      return output_({ok:true});
    }

    if (action === 'upsertTrip') {
      const old = payload.trip || {};
      const submission = sanitizeSubmission_({
        location:old.location, otherLocation:old.otherLocation, city:old.city,
        start:old.start, end:old.end, accom:old.accom, groceries:old.groceries,
        eat:old.eat, travel:old.travel, fuel:old.fuel, tolls:old.tolls,
        other:old.other, otherNote:old.otherNote,
        paid: actor === 'Principessa' ? old.you : old.him,
        uncertain: old.uncertain || {}
      }, actor);
      const tripId = cleanText_(old.id, 80);
      const now = new Date().toISOString();
      let idx = tripId ? state.trips.findIndex(t => t.id === tripId) : -1;
      let trip = idx >= 0 ? sanitizeTripRecord_(state.trips[idx]) : {
        id: Utilities.getUuid(), budget:'', submissions:{Principessa:null,Principe:null},
        confirmed:{Principessa:false,Principe:false},
        createdAt:now, createdBy:actor, updatedAt:now, updatedBy:actor
      };
      if (trip.confirmed.Principessa && trip.confirmed.Principe) {
        throw new Error('This trip is already confirmed by both of you');
      }
      trip.submissions[actor] = submission;
      trip.confirmed = {Principessa:false, Principe:false};
      trip.updatedAt = now;
      trip.updatedBy = actor;
      if (idx >= 0) state.trips[idx] = trip; else state.trips.push(trip);
      addAudit_(state, actor, 'addSubmission', trip.id);
      saveState_(state);
      return output_({ok:true, tripId:trip.id});
    }

    if (action === 'deleteTrip') {
      const id = cleanText_(payload.id, 80);
      const before = state.trips.length;
      state.trips = state.trips.filter(t => t.id !== id);
      state.plans = state.plans.map(plan => {
        const p = sanitizePlan_(plan);
        if (p.linkedTripId === id) p.linkedTripId = '';
        return p;
      });
      if (state.trips.length !== before) addAudit_(state, actor, 'deleteTrip', id);
      saveState_(state);
      return output_({ok:true});
    }

    if (action === 'updateCompare') {
      const allowed = ['rent','utilities','condo','stilltravel','food','carpay','insurance','tax','carfuel','maintenance'];
      const key = String(payload.key || '');
      if (allowed.indexOf(key) === -1) throw new Error('Invalid comparison key');
      const value = Number(payload.value);
      if (!isFinite(value)) throw new Error('Invalid comparison value');
      state.compare[key] = value;
      addAudit_(state, actor, 'updateCompare', key);
      saveState_(state);
      return output_({ok:true});
    }

    return output_({ok:false, error:'Unknown action'});
  } catch (err) {
    return output_({ok:false, error:String(err && err.message || err)});
  } finally {
    lock.releaseLock();
  }
}

function cleanActor_(value) {
  const actor = String(value || '').trim();
  return ACTORS.indexOf(actor) >= 0 ? actor : 'Unknown';
}

function cleanText_(value, maxLen) {
  return String(value == null ? '' : value).trim().slice(0, maxLen || 200);
}

function cleanMoney_(value) {
  if (value === '' || value == null || value === '-') return '';
  const num = Number(String(value).replace(',', '.'));
  return isFinite(num) && num >= 0 ? num : '';
}

function cleanUncertain_(obj) {
  const out = {};
  const source = obj && typeof obj === 'object' ? obj : {};
  MONEY_FIELDS.forEach(k => { if (source[k] === true) out[k] = true; });
  return out;
}

function sanitizePlanMeta_(meta) {
  return {
    location: cleanText_(meta && meta.location, 80),
    otherLocation: cleanText_(meta && meta.otherLocation, 120),
    city: cleanText_(meta && meta.city, 160),
    start: cleanText_(meta && meta.start, 20),
    end: cleanText_(meta && meta.end, 20)
  };
}

function sanitizePlan_(plan) {
  const budgets = plan && plan.budgets || {};
  return {
    id: cleanText_(plan && plan.id, 80) || Utilities.getUuid(),
    meta: sanitizePlanMeta_(plan && plan.meta || {}),
    budgets: {
      Principessa: cleanMoney_(budgets.Principessa),
      Principe: cleanMoney_(budgets.Principe)
    },
    linkedTripId: cleanText_(plan && plan.linkedTripId, 80),
    createdAt: cleanText_(plan && plan.createdAt, 40),
    createdBy: cleanActor_(plan && plan.createdBy),
    updatedAt: cleanText_(plan && plan.updatedAt, 40),
    updatedBy: cleanActor_(plan && plan.updatedBy)
  };
}

function sanitizeSubmission_(s, actor) {
  return {
    location: cleanText_(s.location, 80),
    otherLocation: cleanText_(s.otherLocation, 120),
    city: cleanText_(s.city, 160),
    start: cleanText_(s.start, 20),
    end: cleanText_(s.end, 20),
    accom: cleanMoney_(s.accom),
    groceries: cleanMoney_(s.groceries),
    eat: cleanMoney_(s.eat),
    travel: cleanMoney_(s.travel),
    fuel: cleanMoney_(s.fuel),
    tolls: cleanMoney_(s.tolls),
    other: cleanMoney_(s.other),
    otherNote: cleanText_(s.otherNote, 200),
    paid: cleanMoney_(s.paid),
    uncertain: cleanUncertain_(s.uncertain),
    submittedAt: cleanText_(s.submittedAt, 40),
    submittedBy: actor
  };
}

function sanitizeTripRecord_(t) {
  const out = {
    id: cleanText_(t && t.id, 80) || Utilities.getUuid(),
    budget: cleanMoney_(t && t.budget),
    submissions: {Principessa:null, Principe:null},
    confirmed: {
      Principessa: !!(t && t.confirmed && t.confirmed.Principessa),
      Principe: !!(t && t.confirmed && t.confirmed.Principe)
    },
    createdAt: cleanText_(t && t.createdAt, 40),
    createdBy: cleanActor_(t && t.createdBy),
    updatedAt: cleanText_(t && t.updatedAt, 40),
    updatedBy: cleanActor_(t && t.updatedBy)
  };
  const subs = t && t.submissions || {};
  ACTORS.forEach(actor => {
    if (subs[actor]) out.submissions[actor] = sanitizeSubmission_(subs[actor], actor);
  });
  return out;
}

function submissionsMatch_(a, b) {
  for (let i = 0; i < MONEY_FIELDS.length; i++) {
    const k = MONEY_FIELDS[i];
    if (Math.abs(Number(a[k] || 0) - Number(b[k] || 0)) > 0.01) return false;
    if (!!(a.uncertain && a.uncertain[k]) !== !!(b.uncertain && b.uncertain[k])) return false;
  }
  if (String(a.otherNote || '').trim().toLowerCase() !== String(b.otherNote || '').trim().toLowerCase()) return false;
  return true;
}

function addAudit_(state, actor, action, ref) {
  state.audit = Array.isArray(state.audit) ? state.audit : [];
  state.audit.push({
    id: Utilities.getUuid(), actor: actor, action: action,
    ref: String(ref || ''), at: new Date().toISOString()
  });
  state.audit = state.audit.slice(-MAX_AUDIT);
}

function resetDatabaseForOwnerOnly() {
  PropertiesService.getScriptProperties().deleteProperty(STATE_KEY);
}
