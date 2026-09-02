const STATE_KEY = 'TOGETHER_BUDGET_STATE_V1';
const MAX_AUDIT = 500;

function defaultState_() {
  return {
    version: 1,
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
      version: 1,
      trips: Array.isArray(parsed.trips) ? parsed.trips : [],
      compare: Object.assign(base.compare, parsed.compare || {}),
      audit: Array.isArray(parsed.audit) ? parsed.audit : [],
      updatedAt: parsed.updatedAt || ''
    };
  } catch (err) {
    return defaultState_();
  }
}

function saveState_(state) {
  state.updatedAt = new Date().toISOString();
  if (state.audit.length > MAX_AUDIT) state.audit = state.audit.slice(-MAX_AUDIT);
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
    if (action === 'ping') return output_({ok:true, now:new Date().toISOString()}, callback);
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

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const state = readState_();

    if (action === 'upsertTrip') {
      const incoming = sanitizeTrip_(payload.trip || {});
      const now = new Date().toISOString();
      let idx = incoming.id ? state.trips.findIndex(t => t.id === incoming.id) : -1;

      if (idx >= 0) {
        const existing = state.trips[idx];
        incoming.createdAt = existing.createdAt || now;
        incoming.createdBy = existing.createdBy || actor;
        incoming.updatedAt = now;
        incoming.updatedBy = actor;
        state.trips[idx] = incoming;
        addAudit_(state, actor, 'updateTrip', incoming.id);
      } else {
        incoming.id = Utilities.getUuid();
        incoming.createdAt = now;
        incoming.createdBy = actor;
        incoming.updatedAt = now;
        incoming.updatedBy = actor;
        state.trips.push(incoming);
        addAudit_(state, actor, 'createTrip', incoming.id);
      }
      saveState_(state);
      return output_({ok:true});
    }

    if (action === 'deleteTrip') {
      const id = String(payload.id || '');
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
  if (actor !== 'Principe' && actor !== 'Principessa') return 'Unknown';
  return actor;
}

function cleanText_(value, maxLen) {
  return String(value == null ? '' : value).trim().slice(0, maxLen || 200);
}

function cleanMoney_(value) {
  if (value === '' || value == null) return '';
  const num = Number(String(value).replace(',', '.'));
  return isFinite(num) ? num : 0;
}

function sanitizeTrip_(t) {
  return {
    id: cleanText_(t.id, 80),
    location: cleanText_(t.location, 80),
    otherLocation: cleanText_(t.otherLocation, 120),
    city: cleanText_(t.city, 160),
    start: cleanText_(t.start, 20),
    end: cleanText_(t.end, 20),
    accom: cleanMoney_(t.accom),
    groceries: cleanMoney_(t.groceries),
    eat: cleanMoney_(t.eat),
    travel: cleanMoney_(t.travel),
    fuel: cleanMoney_(t.fuel),
    tolls: cleanMoney_(t.tolls),
    other: cleanMoney_(t.other),
    otherNote: cleanText_(t.otherNote, 200),
    you: cleanMoney_(t.you),
    him: cleanMoney_(t.him),
    createdAt: cleanText_(t.createdAt, 40),
    createdBy: cleanText_(t.createdBy, 40),
    updatedAt: cleanText_(t.updatedAt, 40),
    updatedBy: cleanText_(t.updatedBy, 40)
  };
}

function addAudit_(state, actor, action, ref) {
  state.audit.push({
    id: Utilities.getUuid(),
    actor: actor,
    action: action,
    ref: String(ref || ''),
    at: new Date().toISOString()
  });
}

function resetDatabaseForOwnerOnly() {
  PropertiesService.getScriptProperties().deleteProperty(STATE_KEY);
}
