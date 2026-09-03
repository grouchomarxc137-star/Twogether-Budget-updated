const STATE_KEY = 'TOGETHER_BUDGET_STATE_V1';
const MAX_AUDIT = 2;
const ACTORS = ['Principessa', 'Principe'];
const MONEY_FIELDS = ['accom','groceries','eat','travel','fuel','tolls','other'];

function defaultState_() {
  return {
    version: 11,
    trips: [],
    plans: [],
    finances: {Principessa:[], Principe:[]},
    financeProfiles: {
      Principessa:{bankAccounts:[],savingsTotal:'',savingsReserved:[],receivables:[]},
      Principe:{bankAccounts:[],savingsTotal:'',savingsReserved:[],receivables:[]}
    },
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
      version: 11,
      trips: Array.isArray(parsed.trips) ? parsed.trips.map(migrateTrip_) : [],
      plans: Array.isArray(parsed.plans) ? parsed.plans.map(sanitizePlan_) : [],
      finances: sanitizeFinances_(parsed.finances),
      financeProfiles: sanitizeFinanceProfiles_(parsed.financeProfiles),
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
  state.version = 11;
  state.updatedAt = new Date().toISOString();
  state.audit = Array.isArray(state.audit) ? state.audit.slice(-MAX_AUDIT) : [];
  state.plans = Array.isArray(state.plans) ? state.plans.map(sanitizePlan_) : [];
  state.finances = sanitizeFinances_(state.finances);
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
    if (action === 'ping') return output_({ok:true, version:11, now:new Date().toISOString()}, callback);
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
        if (plan.partials && plan.partials[actor]) {
          throw new Error('Your planned budget is locked because you already started logging actual expenses');
        }
        if (plan.linkedTripId) {
          const linkedTrip = state.trips.find(t => t.id === plan.linkedTripId);
          if (linkedTrip) {
            const safeTrip = sanitizeTripRecord_(linkedTrip);
            if (safeTrip.submissions[actor]) {
              throw new Error('Your planned budget is locked because you already logged your actual expenses');
            }
          }
        }
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
          partials: {Principessa:null, Principe:null},
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

    if (action === 'savePlanPartial') {
      const planId = cleanText_(payload.planId, 80);
      const planIdx = state.plans.findIndex(x => x.id === planId);
      if (planIdx < 0) throw new Error('Budget plan not found');
      const plan = sanitizePlan_(state.plans[planIdx]);
      if (plan.linkedTripId) {
        const linkedTrip = state.trips.find(t => t.id === plan.linkedTripId);
        if (linkedTrip) {
          const safeTrip = sanitizeTripRecord_(linkedTrip);
          if (safeTrip.submissions[actor]) throw new Error('You already logged your full actual expenses');
        }
      }
      const previous = plan.partials && plan.partials[actor] ? plan.partials[actor] : {};
      const incoming = payload.partial || {};
      const merged = Object.assign({}, previous);
      MONEY_FIELDS.forEach(function(key) {
        if (incoming[key] !== undefined) merged[key] = incoming[key];
      });
      if (incoming.otherNote !== undefined) merged.otherNote = incoming.otherNote;
      merged.uncertain = Object.assign({}, previous.uncertain || {}, incoming.uncertain || {});
      merged.updatedAt = new Date().toISOString();
      const partial = sanitizePartialActual_(merged, actor);
      if (!partial) throw new Error('Add at least one expense first');
      plan.partials[actor] = partial;
      plan.updatedAt = merged.updatedAt;
      plan.updatedBy = actor;
      state.plans[planIdx] = plan;
      addAudit_(state, actor, 'savePartialActual', plan.id);
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

      const submitted = Object.assign({}, payload.submission || {});
      const partial = plan.partials && plan.partials[actor] ? plan.partials[actor] : null;
      if (partial) {
        MONEY_FIELDS.forEach(function(key) {
          if ((submitted[key] === '' || submitted[key] == null) && partial[key] !== '' && partial[key] != null) submitted[key] = partial[key];
        });
        if (!submitted.otherNote && partial.otherNote) submitted.otherNote = partial.otherNote;
        submitted.uncertain = Object.assign({}, partial.uncertain || {}, submitted.uncertain || {});
      }
      const merged = Object.assign({}, submitted, plan.meta || {});
      const incoming = sanitizeSubmission_(merged, actor);
      const wasExisting = !!trip.submissions[actor];
      incoming.submittedAt = now;
      incoming.submittedBy = actor;
      trip.submissions[actor] = incoming;
      trip.confirmed = {Principessa:false, Principe:false};
      trip.updatedAt = now;
      trip.updatedBy = actor;
      state.trips[tripIdx] = trip;

      plan.partials[actor] = null;
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

    if (action === 'saveFinanceMonth') {
      const monthData = sanitizeFinanceMonth_(payload.monthData || {}, actor);
      if (!/^\d{4}-\d{2}$/.test(monthData.month)) throw new Error('Choose a valid month');
      state.finances = sanitizeFinances_(state.finances);
      const list = state.finances[actor] || [];
      const idx = list.findIndex(x => x.month === monthData.month);
      const existing = idx >= 0 ? sanitizeFinanceMonth_(list[idx], actor) : null;
      if (existing && existing.finalized) throw new Error('This month is final and locked');
      const now = new Date().toISOString();
      monthData.updatedAt = now;
      monthData.updatedBy = actor;
      monthData.finalized = monthData.finalized === true;
      monthData.finalizedAt = monthData.finalized ? (monthData.finalizedAt || now) : '';
      if (idx >= 0) list[idx] = monthData; else list.push(monthData);
      list.sort((a,b) => String(a.month).localeCompare(String(b.month)));
      state.finances[actor] = list;
      saveState_(state);
      return output_({ok:true, month:monthData.month});
    }

    if (action === 'deleteFinanceMonth') {
      const month = cleanText_(payload.month, 10);
      state.finances = sanitizeFinances_(state.finances);
      state.finances[actor] = (state.finances[actor] || []).filter(x => x.month !== month);
      saveState_(state);
      return output_({ok:true});
    }

    if (action === 'saveFinanceProfile') {
      state.financeProfiles = sanitizeFinanceProfiles_(state.financeProfiles);
      const profile = sanitizeFinanceProfile_(payload.profile || {}, actor);
      profile.updatedAt = new Date().toISOString();
      profile.updatedBy = actor;
      state.financeProfiles[actor] = profile;
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

function sanitizeFinanceIncome_(item) {
  return {name:cleanText_(item && item.name, 100), amount:cleanMoney_(item && item.amount)};
}

function sanitizeFinanceExpense_(item) {
  const allowed = ['medical','subscriptions','rent','transport','groceries','extra','savings','investments','other'];
  let group = String(item && item.group || '');
  if (group === 'health') group = 'medical';
  if (group === 'living') group = 'rent';
  if (allowed.indexOf(group) < 0) group = 'other';
  return {group:group, name:cleanText_(item && item.name, 100), amount:cleanMoney_(item && item.amount)};
}

function sanitizeFinanceReserved_(item) {
  return {name:cleanText_(item && item.name, 100), amount:cleanMoney_(item && item.amount)};
}

function sanitizeFinanceMonth_(record, actor) {
  const incomes = Array.isArray(record && record.incomes) ? record.incomes.slice(0,40).map(sanitizeFinanceIncome_).filter(x => x.name && x.amount !== '') : [];
  let expenses = Array.isArray(record && record.expenses) ? record.expenses.slice(0,100).map(sanitizeFinanceExpense_).filter(x => x.name && x.amount !== '') : [];
  let rawExtraBudget = cleanMoney_(record && record.extraBudget);
  const legacyBudget = rawExtraBudget === '' || Number(rawExtraBudget) <= 0 || Number(rawExtraBudget) === 255;
  if (legacyBudget) {
    const legacyExtraIndex = expenses.findIndex(function(x){ return x.group === 'extra' && String(x.name || '').trim().toLowerCase() === 'extra' && Number(x.amount) === 250; });
    if (legacyExtraIndex >= 0) {
      expenses.splice(legacyExtraIndex, 1);
      rawExtraBudget = 250;
    }
  }
  return {
    month: cleanText_(record && record.month, 10),
    incomes: incomes,
    expenses: expenses,
    extraBudget: rawExtraBudget === '' || Number(rawExtraBudget) <= 0 ? 250 : rawExtraBudget,
    investmentTotal: cleanMoney_(record && record.investmentTotal),
    sisterInvestments: cleanMoney_(record && record.sisterInvestments),
    finalized: !!(record && record.finalized === true),
    finalizedAt: cleanText_(record && record.finalizedAt, 40),
    updatedAt: cleanText_(record && record.updatedAt, 40),
    updatedBy: cleanActor_(record && record.updatedBy || actor)
  };
}

function sanitizeFinanceList_(list, actor) {
  if (!Array.isArray(list)) return [];
  const byMonth = {};
  list.slice(-36).forEach(function(record) {
    const safe = sanitizeFinanceMonth_(record, actor);
    if (/^\d{4}-\d{2}$/.test(safe.month)) byMonth[safe.month] = safe;
  });
  return Object.keys(byMonth).sort().map(function(month){ return byMonth[month]; });
}

function sanitizeFinances_(finances) {
  const source = finances && typeof finances === 'object' ? finances : {};
  return {
    Principessa: sanitizeFinanceList_(source.Principessa, 'Principessa'),
    Principe: sanitizeFinanceList_(source.Principe, 'Principe')
  };
}

function sanitizeFinanceBank_(item) {
  return {
    id: cleanText_(item && item.id, 80) || Utilities.getUuid(),
    name: cleanText_(item && item.name, 100),
    balance: cleanMoney_(item && item.balance)
  };
}

function sanitizeFinanceHold_(item) {
  return {
    id: cleanText_(item && item.id, 80) || Utilities.getUuid(),
    name: cleanText_(item && item.name, 120),
    amount: cleanMoney_(item && item.amount)
  };
}

function sanitizeFinanceReceivable_(item) {
  return {
    id: cleanText_(item && item.id, 80) || Utilities.getUuid(),
    person: cleanText_(item && item.person, 100),
    reason: cleanText_(item && item.reason, 180),
    amount: cleanMoney_(item && item.amount)
  };
}

function sanitizeFinanceProfile_(profile, actor) {
  const source = profile && typeof profile === 'object' ? profile : {};
  return {
    bankAccounts: Array.isArray(source.bankAccounts) ? source.bankAccounts.slice(0,30).map(sanitizeFinanceBank_).filter(x => x.name && x.balance !== '') : [],
    savingsTotal: cleanMoney_(source.savingsTotal),
    savingsReserved: Array.isArray(source.savingsReserved) ? source.savingsReserved.slice(0,40).map(sanitizeFinanceHold_).filter(x => x.name && x.amount !== '') : [],
    receivables: Array.isArray(source.receivables) ? source.receivables.slice(0,40).map(sanitizeFinanceReceivable_).filter(x => x.person && x.reason && x.amount !== '') : [],
    updatedAt: cleanText_(source.updatedAt, 40),
    updatedBy: cleanActor_(source.updatedBy || actor)
  };
}

function sanitizeFinanceProfiles_(profiles) {
  const source = profiles && typeof profiles === 'object' ? profiles : {};
  return {
    Principessa: sanitizeFinanceProfile_(source.Principessa, 'Principessa'),
    Principe: sanitizeFinanceProfile_(source.Principe, 'Principe')
  };
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

function sanitizePartialActual_(partial, actor) {
  if (!partial || typeof partial !== 'object') return null;
  const out = {
    otherNote: cleanText_(partial.otherNote, 200),
    uncertain: cleanUncertain_(partial.uncertain),
    updatedAt: cleanText_(partial.updatedAt, 40),
    updatedBy: cleanActor_(partial.updatedBy || actor)
  };
  let hasAny = false;
  MONEY_FIELDS.forEach(function(key) {
    out[key] = cleanMoney_(partial[key]);
    if (out[key] !== '') hasAny = true;
  });
  return hasAny ? out : null;
}

function sanitizePlan_(plan) {
  const budgets = plan && plan.budgets || {};
  const partials = plan && plan.partials || {};
  return {
    id: cleanText_(plan && plan.id, 80) || Utilities.getUuid(),
    meta: sanitizePlanMeta_(plan && plan.meta || {}),
    budgets: {
      Principessa: cleanMoney_(budgets.Principessa),
      Principe: cleanMoney_(budgets.Principe)
    },
    partials: {
      Principessa: sanitizePartialActual_(partials.Principessa, 'Principessa'),
      Principe: sanitizePartialActual_(partials.Principe, 'Principe')
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