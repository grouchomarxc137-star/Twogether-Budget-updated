const STATE_KEY = 'TOGETHER_BUDGET_STATE_V1';
const MAX_AUDIT = 2;
const ACTORS = ['Principessa', 'Principe'];
const MONEY_FIELDS = ['accom','groceries','eat','travel','fuel','tolls','other'];

function defaultState_() {
  return {
    version: 2,
    trips: [],
    compare: {
      rent: 600, utilities: 120, condo: 0, stilltravel: 180, food: 250,
      carpay: 250, insurance: 90, tax: 45, carfuel: 120, maintenance: 50
    },
    audit: [],
    updatedAt: ''
  };
}

function readState_() {
  const raw = PropertiesService.getScriptProperties().getProperty(STATE_KEY);
  if (!raw) return defaultState_();
  try {
    const parsed = JSON.parse(raw);
    const base = defaultState_();
    return {
      version: 2,
      trips: Array.isArray(parsed.trips) ? parsed.trips.map(migrateTrip_) : [],
      compare: Object.assign(base.compare, parsed.compare || {}),
      audit: Array.isArray(parsed.audit) ? parsed.audit.slice(-MAX_AUDIT) : [],
      updatedAt: parsed.updatedAt || ''
    };
  } catch (err) {
    return defaultState_();
  }
}

function migrateTrip_(trip) {
  if (trip && trip.submissions) {
    return sanitizeTripRecord_(trip);
  }

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

  const out = {
    id: cleanText_(trip && trip.id, 80) || Utilities.getUuid(),
    submissions: {Principessa:null, Principe:null},
    createdAt: cleanText_(trip && trip.createdAt, 40) || new Date().toISOString(),
    createdBy: cleanActor_(trip && trip.createdBy) === 'Unknown' ? actor : cleanActor_(trip && trip.createdBy),
    updatedAt: cleanText_(trip && trip.updatedAt, 40) || new Date().toISOString(),
    updatedBy: cleanActor_(trip && trip.updatedBy) === 'Unknown' ? actor : cleanActor_(trip && trip.updatedBy)
  };
  out.submissions[actor] = submission;
  return out;
}

function saveState_(state) {
  state.version = 2;
  state.updatedAt = new Date().toISOString();
  state.audit = Array.isArray(state.audit) ? state.audit.slice(-MAX_AUDIT) : [];
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
    if (action === 'ping') return output_({ok:true, version:2, now:new Date().toISOString()}, callback);
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

    if (action === 'saveSubmission') {
      const incoming = sanitizeSubmission_(payload.submission || {}, actor);
      const tripId = cleanText_(payload.tripId, 80);
      const now = new Date().toISOString();
      let idx = tripId ? state.trips.findIndex(t => t.id === tripId) : -1;
      let trip;

      if (idx >= 0) {
        trip = sanitizeTripRecord_(state.trips[idx]);
      } else {
        trip = {
          id: Utilities.getUuid(),
          submissions: {Principessa:null, Principe:null},
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
      trip.updatedAt = now;
      trip.updatedBy = actor;
      state.trips[idx] = trip;
      addAudit_(state, actor, wasExisting ? 'updateSubmission' : 'addSubmission', trip.id);
      saveState_(state);
      return output_({ok:true, tripId:trip.id});
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
        id: Utilities.getUuid(), submissions:{Principessa:null,Principe:null},
        createdAt:now, createdBy:actor, updatedAt:now, updatedBy:actor
      };
      trip.submissions[actor] = submission;
      trip.updatedAt = now; trip.updatedBy = actor;
      if (idx >= 0) state.trips[idx] = trip; else state.trips.push(trip);
      addAudit_(state, actor, 'addSubmission', trip.id);
      saveState_(state);
      return output_({ok:true, tripId:trip.id});
    }

    if (action === 'deleteTrip') {
      const id = cleanText_(payload.id, 80);
      const before = state.trips.length;
      state.trips = state.trips.filter(t => t.id !== id);
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
  return isFinite(num) ? num : '';
}

function cleanUncertain_(obj) {
  const out = {};
  const source = obj && typeof obj === 'object' ? obj : {};
  MONEY_FIELDS.forEach(k => { if (source[k] === true) out[k] = true; });
  return out;
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
    submissions: {Principessa:null, Principe:null},
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

function addAudit_(state, actor, action, ref) {
  state.audit.push({
    id: Utilities.getUuid(), actor: actor, action: action,
    ref: String(ref || ''), at: new Date().toISOString()
  });
  state.audit = state.audit.slice(-MAX_AUDIT);
}

function resetDatabaseForOwnerOnly() {
  PropertiesService.getScriptProperties().deleteProperty(STATE_KEY);
}
