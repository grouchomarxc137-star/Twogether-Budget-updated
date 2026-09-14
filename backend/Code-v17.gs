const STATE_KEY = 'TOGETHER_BUDGET_STATE_V1';
const MAX_AUDIT = 2;
const ACTORS = ['Principessa', 'Principe'];
const MONEY_FIELDS = ['accom','groceries','eat','travel','fuel','tolls','other'];
const SHARED_EXPENSE_KEYS = ['accom','travel'];

function defaultState_() {
  return {
    version: 18,
    trips: [],
    plans: [],
    finances: {Principessa:[], Principe:[]},
    financeProfiles: {
      Principessa:{bankAccounts:[],savingsTotal:'',savingsReserved:[],receivables:[],scenarios:[],wishlist:[],compareLab:{}},
      Principe:{bankAccounts:[],savingsTotal:'',savingsReserved:[],receivables:[],scenarios:[],wishlist:[],compareLab:{}}
    },
    sharedJar: defaultSharedJar_(),
    game: defaultGame_(),
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
      version: 18,
      trips: Array.isArray(parsed.trips) ? parsed.trips.map(migrateTrip_) : [],
      plans: Array.isArray(parsed.plans) ? parsed.plans.map(sanitizePlan_) : [],
      finances: sanitizeFinances_(parsed.finances),
      financeProfiles: sanitizeFinanceProfiles_(parsed.financeProfiles),
      sharedJar: sanitizeSharedJar_(parsed.sharedJar),
      game: sanitizeGame_(parsed.game),
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


function defaultGameProfile_() {
  return {
    lovis:0, twos:0, twosModel:'budget-v27', purchases:[], theme:'default', lastSeenAt:'',
    awards:{logs:[],tripConfirms:[],financeConfirms:[],expenses:[],compareSaves:[],compareCompletes:[],wishlistAdds:[],wishlistCheckouts:[],tripSettlements:[],financeSettlements:[]},
    packing:{}, planners:{}
  };
}

function defaultGame_() {
  return {Principessa:defaultGameProfile_(), Principe:defaultGameProfile_(), signals:[]};
}

function gameStringList_(value, maxItems) {
  const arr = Array.isArray(value) ? value.map(function(x){ return cleanText_(x, 180); }).filter(Boolean) : [];
  return Array.from(new Set(arr)).slice(-(maxItems || 500));
}

function sanitizeGameProfile_(value) {
  const s = value && typeof value === 'object' ? value : {};
  const awards = s.awards && typeof s.awards === 'object' ? s.awards : {};
  const packing = {};
  const planners = {};
  if (s.packing && typeof s.packing === 'object') Object.keys(s.packing).slice(0,100).forEach(function(id){
    const key=cleanText_(id,80); if(!key)return;
    packing[key]=(Array.isArray(s.packing[id])?s.packing[id]:[]).slice(0,100).map(function(x){return {text:cleanText_(x&&x.text,120),done:!!(x&&x.done)};}).filter(function(x){return !!x.text;});
  });
  if (s.planners && typeof s.planners === 'object') Object.keys(s.planners).slice(0,100).forEach(function(id){
    const key=cleanText_(id,80),p=s.planners[id]||{}; if(!key)return;
    planners[key]={stay:cleanText_(p.stay,160),transport:cleanText_(p.transport,160),booking:cleanText_(p.booking,160),notes:cleanText_(p.notes,1200)};
  });
  const v27 = String(s.twosModel||'') === 'budget-v27';
  return {
    lovis:Math.max(0, Number(s.lovis != null ? s.lovis : s.tokens) || 0),
    twos:v27 ? (Number(s.twos)||0) : 0,
    twosModel:'budget-v27',
    purchases:gameStringList_(s.purchases,100),
    theme:['default','cozy','night'].indexOf(String(s.theme||''))>=0?String(s.theme):'default',
    lastSeenAt:cleanText_(s.lastSeenAt,40),
    awards:{
      logs:gameStringList_(awards.logs,500), tripConfirms:gameStringList_(awards.tripConfirms,300), financeConfirms:gameStringList_(awards.financeConfirms,300),
      expenses:gameStringList_(awards.expenses,800), compareSaves:gameStringList_(awards.compareSaves,400), compareCompletes:gameStringList_(awards.compareCompletes,300),
      wishlistAdds:gameStringList_(awards.wishlistAdds,500), wishlistCheckouts:gameStringList_(awards.wishlistCheckouts,500),
      tripSettlements:gameStringList_(awards.tripSettlements,400), financeSettlements:gameStringList_(awards.financeSettlements,400)
    }, packing:packing, planners:planners
  };
}

function sanitizeGame_(value) {
  const g=value&&typeof value==='object'?value:{};
  const signals=(Array.isArray(g.signals)?g.signals:[]).slice(-40).map(function(x){
    const from=cleanActor_(x&&x.from),to=cleanActor_(x&&x.to); if(from==='Unknown'||to==='Unknown'||from===to)return null;
    const type=String(x&&x.type)==='note'?'note':'heart';
    return {id:cleanText_(x&&x.id,80)||Utilities.getUuid(),from:from,to:to,type:type,text:type==='note'?cleanText_(x&&x.text,160):'',createdAt:cleanText_(x&&x.createdAt,40)||new Date().toISOString(),seenAt:cleanText_(x&&x.seenAt,40)};
  }).filter(Boolean);
  return {Principessa:sanitizeGameProfile_(g.Principessa),Principe:sanitizeGameProfile_(g.Principe),signals:signals};
}

function mergeGameLists_(a,b,maxItems){return gameStringList_((a||[]).concat(b||[]),maxItems||500);}
function gameCatalog_(){return {
  'date-night-jar':{currency:'lovis',cost:35},'flying-heart':{currency:'lovis',cost:40},'trip-countdown':{currency:'lovis',cost:50},
  'flying-note':{currency:'lovis',cost:55},'theme-pack':{currency:'lovis',cost:60},'packing-list':{currency:'lovis',cost:70},
  'travel-passport':{currency:'lovis',cost:80},'world-map':{currency:'lovis',cost:120}
};}
function gameResponse_(state, extra){return Object.assign({ok:true,game:sanitizeGame_(state.game)},extra||{});}

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
    sharedExpenses: sanitizeSharedExpenses_(trip && trip.sharedExpenses),
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
  state.version = 18;
  state.updatedAt = new Date().toISOString();
  state.audit = Array.isArray(state.audit) ? state.audit.slice(-MAX_AUDIT) : [];
  state.plans = Array.isArray(state.plans) ? state.plans.map(sanitizePlan_) : [];
  state.trips = Array.isArray(state.trips) ? state.trips.map(sanitizeTripRecord_) : [];
  state.finances = sanitizeFinances_(state.finances);
  state.financeProfiles = sanitizeFinanceProfiles_(state.financeProfiles);
  state.sharedJar = sanitizeSharedJar_(state.sharedJar);
  state.game = sanitizeGame_(state.game);
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
    if (action === 'ping') return output_({ok:true, version: 18, now:new Date().toISOString()}, callback);
    if (action === 'state') return output_({ok:true, state:readState_()}, callback);
    return output_({ok:false, error:'Unknown action'}, callback);
  } catch (err) {
    return output_({ok:false, error:String(err && err.message || err)}, callback);
  }
}

function handlePost_(e) {
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
        const lockedTrip=state.trips.find(t=>t.id===plan.linkedTripId);
        if(lockedTrip && isTripLocked_(lockedTrip))throw new Error('This trip is already confirmed by both of you');
        if (payload.meta && actor === plan.createdBy) {
          plan.meta = sanitizePlanMeta_(payload.meta);
        }
      } else {
        const meta = sanitizePlanMeta_(payload.meta || {});
        if (!meta.location || !meta.city || !meta.start || !meta.end) {
          throw new Error('Add the trip location, city and dates first');
        }
        plan = sanitizePlan_({
          id: Utilities.getUuid(),
          meta: meta,
          budgets: {Principessa:'', Principe:''},
          partials: {Principessa:null, Principe:null},
          sharedExpenses: {},
          prep: defaultTripPrep_(),
          linkedTripId: '',
          createdAt: now,
          createdBy: actor,
          updatedAt: now,
          updatedBy: actor
        });
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


    if (action === 'saveAccommodationExpense') {
      const planId = cleanText_(payload.planId, 80);
      const planIdx = state.plans.findIndex(function(x){ return x.id === planId; });
      if (planIdx < 0) throw new Error('Budget plan not found');
      const plan = sanitizePlan_(state.plans[planIdx]);
      const linkedTrip = plan.linkedTripId ? state.trips.find(function(t){ return t.id === plan.linkedTripId; }) : null;
      if (linkedTrip && isTripLocked_(linkedTrip)) throw new Error('This trip is already confirmed by both of you');
      const total = cleanMoney_(payload.total);
      if (total === '') throw new Error('Enter the total Airbnb/accommodation cost');
      const paymentType = String(payload.paymentType || '') === 'solo' ? 'solo' : (String(payload.paymentType || '') === 'shared' ? 'shared' : '');
      if (!paymentType) throw new Error('Choose whether you are paying this yourself or sharing it');
      const paidUpfront = paymentType === 'shared' && payload.paidUpfront === true;
      const useJar = payload.useJar === true;
      const other = actor === 'Principessa' ? 'Principe' : 'Principessa';
      state.sharedJar = sanitizeSharedJar_(state.sharedJar);
      const oldTx = state.sharedJar.transactions.find(function(x){ return x.planId === planId; });
      const availableBefore = money2_(Number(state.sharedJar.balance || 0) + Number(oldTx && oldTx.amount || 0));
      const jarContribution = useJar ? money2_(Number(total) * .2) : 0;
      if (jarContribution > availableBefore + .005) throw new Error('The Shared Jar only has €' + availableBefore.toFixed(2) + ' available');
      state.sharedJar.transactions = state.sharedJar.transactions.filter(function(x){ return x.planId !== planId; });
      if (jarContribution > 0) state.sharedJar.transactions.push({planId:planId,amount:jarContribution,actor:actor,at:new Date().toISOString()});
      state.sharedJar = sanitizeSharedJar_(state.sharedJar);

      const remaining = money2_(Number(total) - jarContribution);
      const shareEach = paymentType === 'shared' ? money2_(remaining / 2) : remaining;
      const current = sanitizeSharedExpense_(plan.sharedExpenses && plan.sharedExpenses.accom);
      const previousRepayment = current.accommodation && current.accommodation.repayment || {};
      let repayment = {debtor:'',creditor:'',amount:'',status:'none',confirmedAt:''};
      current.total = total;
      current.totalUncertain = false;
      current.totalKnownBy = actor;
      current.totals.Principessa = total;
      current.totals.Principe = total;
      current.unknown.Principessa = false;
      current.unknown.Principe = false;
      if (paymentType === 'solo') {
        current.mode[actor] = 'full'; current.mode[other] = '';
        current.paid[actor] = remaining; current.paid[other] = '';
      } else if (paidUpfront) {
        current.mode.Principessa = 'shared'; current.mode.Principe = 'shared';
        current.paid[actor] = remaining; current.paid[other] = 0;
        const keepConfirmed = previousRepayment.status === 'confirmed' && previousRepayment.creditor === actor && previousRepayment.debtor === other && Math.abs(Number(previousRepayment.amount || 0) - shareEach) < .005;
        repayment = {debtor:other,creditor:actor,amount:shareEach,status:keepConfirmed?'confirmed':'pending',confirmedAt:keepConfirmed?cleanText_(previousRepayment.confirmedAt,40):''};
      } else {
        current.mode.Principessa = 'shared'; current.mode.Principe = 'shared';
        current.paid.Principessa = shareEach; current.paid.Principe = shareEach;
      }
      current.accommodation = {
        useJar:useJar,
        jarContribution:jarContribution,
        jarBalanceAfter:state.sharedJar.balance,
        remaining:remaining,
        paymentType:paymentType,
        paidUpfront:paidUpfront,
        upfrontBy:paidUpfront?actor:'',
        shareEach:paymentType==='shared'?shareEach:'',
        repayment:repayment
      };
      current.updatedAt = new Date().toISOString();
      current.updatedBy = actor;
      plan.sharedExpenses.accom = current;
      plan.updatedAt = current.updatedAt;
      plan.updatedBy = actor;
      syncSharedExpenseIntoPlanAndTrip_(state, plan, 'accom');
      state.plans[planIdx] = plan;
      addAudit_(state, actor, 'saveAccommodationExpense', plan.id);
      saveState_(state);
      return output_({ok:true,planId:plan.id,sharedExpense:plan.sharedExpenses.accom,sharedJar:state.sharedJar});
    }

    if (action === 'confirmAccommodationRepayment') {
      const planId = cleanText_(payload.planId, 80);
      const planIdx = state.plans.findIndex(function(x){ return x.id === planId; });
      if (planIdx < 0) throw new Error('Budget plan not found');
      const plan = sanitizePlan_(state.plans[planIdx]);
      const current = sanitizeSharedExpense_(plan.sharedExpenses && plan.sharedExpenses.accom);
      const repayment = current.accommodation && current.accommodation.repayment;
      if (!repayment || repayment.status === 'none' || !repayment.debtor) throw new Error('There is no accommodation repayment to confirm');
      if (repayment.debtor !== actor) throw new Error('Only the person who owes this repayment can confirm it');
      repayment.status = payload.paidBack === true ? 'confirmed' : 'pending';
      repayment.confirmedAt = repayment.status === 'confirmed' ? new Date().toISOString() : '';
      current.accommodation.repayment = repayment;
      current.updatedAt = new Date().toISOString(); current.updatedBy = actor;
      plan.sharedExpenses.accom = current; plan.updatedAt = current.updatedAt; plan.updatedBy = actor;
      syncSharedExpenseIntoPlanAndTrip_(state, plan, 'accom');
      state.plans[planIdx] = plan;
      addAudit_(state, actor, 'accommodationRepayment:' + repayment.status, plan.id);
      saveState_(state);
      return output_({ok:true,sharedExpense:plan.sharedExpenses.accom,sharedJar:sanitizeSharedJar_(state.sharedJar)});
    }

    if (action === 'saveTripPrep') {
      const planId = cleanText_(payload.planId, 80);
      const planIdx = state.plans.findIndex(function(x){ return x.id === planId; });
      if (planIdx < 0) throw new Error('Budget plan not found');
      const plan = sanitizePlan_(state.plans[planIdx]);
      plan.prep = sanitizeTripPrep_(payload.prep || {});
      plan.prep.updatedAt = new Date().toISOString(); plan.prep.updatedBy = actor;
      plan.updatedAt = plan.prep.updatedAt; plan.updatedBy = actor;
      state.plans[planIdx] = plan;
      addAudit_(state, actor, 'saveTripPrep', plan.id);
      saveState_(state);
      return output_({ok:true,prep:plan.prep});
    }

    if (action === 'saveSharedExpense') {
      const planId = cleanText_(payload.planId, 80);
      const key = cleanText_(payload.key, 20);
      if (SHARED_EXPENSE_KEYS.indexOf(key) < 0) throw new Error('This shared expense category is not supported yet');
      const planIdx = state.plans.findIndex(x => x.id === planId);
      if (planIdx < 0) throw new Error('Budget plan not found');
      const plan = sanitizePlan_(state.plans[planIdx]);
      const linkedTrip = plan.linkedTripId ? state.trips.find(t => t.id === plan.linkedTripId) : null;
      if (linkedTrip && isTripLocked_(linkedTrip)) throw new Error('This trip is already confirmed by both of you');

      const current = sanitizeSharedExpense_(plan.sharedExpenses && plan.sharedExpenses[key]);
      let total = cleanMoney_(payload.total);
      if(payload.expectedTotal!==undefined && String(payload.expectedTotal)!==String(current.total))throw new Error('The total changed while you were editing. Reopen this expense and review the latest total.');
      if(payload.total!=='' && payload.total!=null && total==='')throw new Error('Enter a valid non-negative total');
      const mode = cleanSharedMode_(payload.mode);
      const paid = cleanMoney_(payload.paid);
      const unknown = payload.unknown === true;
      const totalUncertain = payload.totalUncertain === true;
      if (!mode) throw new Error('Choose whether this was fully paid by you or shared');
      if (paid === '') throw new Error('Enter how much you paid');
      if (mode === 'full' && total === '') total = paid;

      if (mode === 'full' && Math.abs(Number(total)-Number(paid)) > .005) throw new Error('Fully paid must equal the total bill');
      const other=actor==='Principessa'?'Principe':'Principessa';
      if (mode === 'full') {
        if(Number(current.paid[other])>0) throw new Error('Your partner has recorded a payment. Reconcile that payment before marking this fully paid by you.');
        current.mode[other]='';current.paid[other]=0;current.unknown[other]=false;
      } else if(current.mode[other]==='full') {
        current.mode[other]='shared';
      }
      current.mode[actor] = mode;
      current.paid[actor] = paid;
      current.unknown[actor] = unknown;
      if (total !== '') {
        current.totals[actor]=total;
        current.total = total;
        current.totalUncertain = totalUncertain;
        current.totalKnownBy = actor;
      } else if (current.total === '' && unknown) {
        current.total = '';
        current.totalUncertain = true;
      }
      current.updatedAt = new Date().toISOString();
      current.updatedBy = actor;
      plan.sharedExpenses[key] = current;
      syncSharedExpenseIntoPlanAndTrip_(state, plan, key);
      plan.updatedAt = current.updatedAt;
      plan.updatedBy = actor;
      state.plans[planIdx] = plan;
      addAudit_(state, actor, 'saveSharedExpense:' + key, plan.id);
      saveState_(state);
      return output_({ok:true, planId:plan.id, sharedExpense:plan.sharedExpenses[key]});
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
      applySharedTotalsToDraft_(plan, merged);
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
        trip = sanitizeTripRecord_({
          id: Utilities.getUuid(),
          budget: '',
          submissions: {Principessa:null, Principe:null},
          sharedExpenses: plan.sharedExpenses,
          confirmed: {Principessa:false, Principe:false},
          createdAt: now,
          createdBy: actor,
          updatedAt: now,
          updatedBy: actor
        });
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
      applySharedTotalsToDraft_(plan, submitted);
      const merged = Object.assign({}, submitted, plan.meta || {});
      const incoming = sanitizeSubmission_(merged, actor);
      const wasExisting = !!trip.submissions[actor];
      incoming.submittedAt = now;
      incoming.submittedBy = actor;
      trip.submissions[actor] = incoming;
      trip.sharedExpenses = sanitizeSharedExpenses_(plan.sharedExpenses);
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
        trip = sanitizeTripRecord_({
          id: Utilities.getUuid(),
          budget: cleanMoney_(payload.budget),
          submissions: {Principessa:null, Principe:null},
          sharedExpenses: {},
          confirmed: {Principessa:false, Principe:false},
          createdAt: now,
          createdBy: actor,
          updatedAt: now,
          updatedBy: actor
        });
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
      if (!sharedExpensesResolved_(trip.sharedExpenses)) {
        throw new Error('Accommodation or Flights / Train still has an unknown total. Add the total before confirming the trip.');
      }
      if (!submissionsMatch_(trip.submissions.Principessa, trip.submissions.Principe)) {
        throw new Error('Your versions still differ. Edit them until they match first.');
      }
      const warnings=reconciliationWarnings_(trip);
      if(warnings.length)throw new Error(warnings.join(' '));
      const alreadyConfirmed = !!trip.confirmed[actor];
      trip.confirmed[actor] = true;
      trip.updatedAt = new Date().toISOString();
      trip.updatedBy = actor;
      state.trips[idx] = trip;
      let twosDelta = 0;
      if (!alreadyConfirmed) {
        state.game = sanitizeGame_(state.game);
        const pstate = state.game[actor];
        const planForTrip = state.plans.map(sanitizePlan_).find(function(p){ return p.linkedTripId === trip.id; });
        const budgetRaw = planForTrip && planForTrip.budgets && planForTrip.budgets[actor] !== '' ? planForTrip.budgets[actor] : trip.budget;
        const actualRaw = trip.submissions[actor] && trip.submissions[actor].paid;
        if (budgetRaw !== '' && actualRaw !== '' && isFinite(Number(budgetRaw)) && isFinite(Number(actualRaw))) {
          const settleKey='trip:'+actor+':'+trip.id;
          if (pstate.awards.tripSettlements.indexOf(settleKey) < 0) {
            twosDelta = Math.round((Number(budgetRaw)-Number(actualRaw))*100)/100;
            pstate.twos += twosDelta;
            pstate.awards.tripSettlements.push(settleKey);
          }
        }
        state.game[actor]=sanitizeGameProfile_(pstate);
      }
      addAudit_(state, actor, 'confirmTrip', trip.id);
      saveState_(state);
      return output_({ok:true,twosDelta:twosDelta,game:sanitizeGame_(state.game)});
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
      let trip = idx >= 0 ? sanitizeTripRecord_(state.trips[idx]) : sanitizeTripRecord_({
        id: Utilities.getUuid(), budget:'', submissions:{Principessa:null,Principe:null}, sharedExpenses:{},
        confirmed:{Principessa:false,Principe:false}, createdAt:now, createdBy:actor, updatedAt:now, updatedBy:actor
      });
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
      let twosDelta = 0;
      if (monthData.finalized) {
        state.game=sanitizeGame_(state.game);
        const pstate=state.game[actor],settleKey='month:'+actor+':'+monthData.month;
        if (pstate.awards.financeSettlements.indexOf(settleKey) < 0) {
          const income=(monthData.incomes||[]).reduce(function(sum,x){return sum+Number(x.amount||0);},0);
          const outflow=(monthData.expenses||[]).reduce(function(sum,x){return sum+Number(x.amount||0);},0)+(monthData.extraSpends||[]).reduce(function(sum,x){return sum+Number(x.amount||0);},0);
          twosDelta=Math.round((income-outflow)*100)/100;
          pstate.twos+=twosDelta;
          pstate.awards.financeSettlements.push(settleKey);
        }
        state.game[actor]=sanitizeGameProfile_(pstate);
      }
      saveState_(state);
      return output_({ok:true, month:monthData.month,twosDelta:twosDelta,game:sanitizeGame_(state.game)});
    }


    if (action === 'saveFinancePlanning') {
      const month = cleanText_(payload.month, 10);
      if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Choose a valid month');
      state.finances = sanitizeFinances_(state.finances);
      const list = state.finances[actor] || [];
      let idx = list.findIndex(function(x){ return x.month === month; });
      let record = idx >= 0 ? sanitizeFinanceMonth_(list[idx], actor) : sanitizeFinanceMonth_({month:month}, actor);
      if (record.finalized) throw new Error('This month is final and locked');
      const planning = sanitizeFinancePlanning_(payload.planning || {});
      record.planning = planning;
      planning.items.forEach(function(item){
        const name = String(item.name || '').trim(); if (!name) return;
        const lower = name.toLowerCase();
        if (item.kind === 'income') {
          record.incomes = (record.incomes || []).filter(function(x){ return String(x.name || '').trim().toLowerCase() !== lower; });
          if (item.actual !== '') record.incomes.push({name:name,amount:item.actual});
        } else {
          record.expenses = (record.expenses || []).filter(function(x){
            const isFixedExtra = x.group === 'extra' && String(x.name || '').trim().toLowerCase() === 'extra';
            return isFixedExtra || String(x.name || '').trim().toLowerCase() !== lower;
          });
          if (item.actual !== '') record.expenses.push({group:item.group||'other',name:name,amount:item.actual});
        }
      });
      record.updatedAt = new Date().toISOString(); record.updatedBy = actor;
      record = sanitizeFinanceMonth_(record, actor);
      if (idx >= 0) list[idx] = record; else list.push(record);
      list.sort(function(a,b){ return String(a.month).localeCompare(String(b.month)); });
      state.finances[actor] = list;
      addAudit_(state, actor, 'saveFinancePlanning', month);
      saveState_(state);
      return output_({ok:true,month:month,planning:record.planning,monthData:record});
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
      const before = sanitizeFinanceProfile_(state.financeProfiles[actor] || {}, actor);
      const profile = sanitizeFinanceProfile_(payload.profile || {}, actor);
      profile.updatedAt = new Date().toISOString();
      profile.updatedBy = actor;
      state.game=sanitizeGame_(state.game);
      const pstate=state.game[actor],oldIds=new Set((before.wishlist||[]).map(function(x){return x.id;}));
      let wishlistAwarded=0;
      (profile.wishlist||[]).forEach(function(item){
        const key='wish:'+actor+':'+item.id;
        if(!oldIds.has(item.id) && pstate.awards.wishlistAdds.indexOf(key)<0){pstate.awards.wishlistAdds.push(key);pstate.lovis+=3;wishlistAwarded+=3;}
      });
      state.game[actor]=sanitizeGameProfile_(pstate);
      state.financeProfiles[actor] = profile;
      saveState_(state);
      return output_(gameResponse_(state,{wishlistAwarded:wishlistAwarded}));
    }

    if (action === 'wishlistCheckout') {
      state.financeProfiles=sanitizeFinanceProfiles_(state.financeProfiles);state.game=sanitizeGame_(state.game);
      const ids=(Array.isArray(payload.ids)?payload.ids:[]).slice(0,20).map(function(x){return cleanText_(x,80);}).filter(Boolean);
      const profile=sanitizeFinanceProfile_(state.financeProfiles[actor]||{},actor),now=new Date().toISOString();
      const selected=(profile.wishlist||[]).filter(function(x){return ids.indexOf(x.id)>=0&&!x.unlockedAt&&x.price!=='';});
      if(!selected.length)throw new Error('Add a priced Wishlist item to the cart first');
      const total=Math.round(selected.reduce(function(sum,x){return sum+Number(x.price||0);},0)*100)/100,pstate=state.game[actor];
      if(Number(pstate.twos)<total)throw new Error('You need '+(total-Number(pstate.twos)).toFixed(2)+' more Twos');
      pstate.twos-=total;
      const selectedIds=new Set(selected.map(function(x){return x.id;}));
      profile.wishlist=profile.wishlist.map(function(x){if(selectedIds.has(x.id)){x.unlockedAt=now;x.unlockedBy=actor;}return x;});
      const checkoutKey='checkout:'+actor+':'+selected.map(function(x){return x.id;}).sort().join('|');
      if(pstate.awards.wishlistCheckouts.indexOf(checkoutKey)<0){pstate.awards.wishlistCheckouts.push(checkoutKey);pstate.lovis+=5;}
      state.game[actor]=sanitizeGameProfile_(pstate);state.financeProfiles[actor]=sanitizeFinanceProfile_(profile,actor);saveState_(state);
      return output_(gameResponse_(state,{spentTwos:total,profile:state.financeProfiles[actor]}));
    }

    if (action === 'saveCompareLab') {
      state.financeProfiles=sanitizeFinanceProfiles_(state.financeProfiles);state.game=sanitizeGame_(state.game);
      const profile=sanitizeFinanceProfile_(state.financeProfiles[actor]||{},actor),lab=sanitizeCompareLab_(payload.lab||{}),side=String(payload.side||'').toUpperCase();
      if(!lab.id||(['A','B'].indexOf(side)<0))throw new Error('Invalid comparison');
      profile.compareLab=lab;profile.updatedAt=new Date().toISOString();profile.updatedBy=actor;
      const pstate=state.game[actor],saveKey='compare:'+actor+':'+lab.id+':'+side;let awarded=0,compareCompleteAwarded=false;
      if(pstate.awards.compareSaves.indexOf(saveKey)<0){pstate.awards.compareSaves.push(saveKey);pstate.lovis+=4;awarded+=4;}
      const complete=(lab.rowsA||[]).some(function(x){return x.amount!=='';})&&(lab.rowsB||[]).some(function(x){return x.amount!=='';});
      const completeKey='compare-complete:'+actor+':'+lab.id;
      if(complete&&pstate.awards.compareCompletes.indexOf(completeKey)<0){pstate.awards.compareCompletes.push(completeKey);pstate.lovis+=6;awarded+=6;compareCompleteAwarded=true;}
      state.game[actor]=sanitizeGameProfile_(pstate);state.financeProfiles[actor]=sanitizeFinanceProfile_(profile,actor);saveState_(state);
      return output_(gameResponse_(state,{awarded:awarded,compareCompleteAwarded:compareCompleteAwarded,compareLab:lab}));
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


    if (action === 'shopSync') {
      state.game = sanitizeGame_(state.game);
      const current = state.game[actor], incoming = sanitizeGameProfile_(payload.local || {});
      current.lovis = Math.max(current.lovis, incoming.lovis);
      current.twos = Number(current.twos) || 0;
      current.purchases = mergeGameLists_(current.purchases, incoming.purchases, 100);
      Object.keys(current.awards).forEach(function(k){ current.awards[k]=mergeGameLists_(current.awards[k], incoming.awards[k], k==='expenses'?800:500); });
      current.packing = Object.assign({}, incoming.packing || {}, current.packing || {});
      current.planners = Object.assign({}, incoming.planners || {}, current.planners || {});
      if(current.theme==='default' && incoming.theme!=='default') current.theme=incoming.theme;
      current.lastSeenAt = new Date().toISOString();
      state.game[actor]=sanitizeGameProfile_(current); saveState_(state);
      return output_(gameResponse_(state,{profile:state.game[actor]}));
    }

    if (action === 'shopAward') {
      state.game = sanitizeGame_(state.game);
      const rules={log:{bucket:'logs',currency:'lovis',amount:5},tripConfirm:{bucket:'tripConfirms',currency:'lovis',amount:10},financeConfirm:{bucket:'financeConfirms',currency:'lovis',amount:15},expense:{bucket:'expenses',currency:'lovis',amount:2}};
      const kind=cleanText_(payload.kind,30),key=cleanText_(payload.key,180),rule=rules[kind];
      if(!rule||!key)throw new Error('Invalid shop reward');
      const pstate=state.game[actor]; let awarded=0;
      if(pstate.awards[rule.bucket].indexOf(key)<0){pstate.awards[rule.bucket].push(key);pstate.awards[rule.bucket]=gameStringList_(pstate.awards[rule.bucket],rule.bucket==='expenses'?800:500);pstate[rule.currency]+=rule.amount;awarded=rule.amount;}
      pstate.lastSeenAt=new Date().toISOString(); state.game[actor]=sanitizeGameProfile_(pstate); saveState_(state);
      return output_(gameResponse_(state,{awarded:awarded,currency:rule.currency,profile:state.game[actor]}));
    }

    if (action === 'shopPurchase') {
      state.game=sanitizeGame_(state.game); const id=cleanText_(payload.id,60),item=gameCatalog_()[id]; if(!item)throw new Error('Unknown shop reward');
      const pstate=state.game[actor]; if(pstate.purchases.indexOf(id)<0){if(Number(pstate[item.currency])<item.cost)throw new Error('Not enough '+(item.currency==='lovis'?'Lovis':'Twos'));pstate[item.currency]-=item.cost;pstate.purchases.push(id);}state.game[actor]=sanitizeGameProfile_(pstate);saveState_(state);return output_(gameResponse_(state,{profile:state.game[actor]}));
    }

    if (action === 'shopSetTheme') {
      state.game=sanitizeGame_(state.game);const pstate=state.game[actor];if(pstate.purchases.indexOf('theme-pack')<0)throw new Error('Unlock the theme pack first');const theme=cleanText_(payload.theme,20);pstate.theme=['default','cozy','night'].indexOf(theme)>=0?theme:'default';state.game[actor]=sanitizeGameProfile_(pstate);saveState_(state);return output_(gameResponse_(state));
    }

    if (action === 'shopSavePacking') {
      state.game=sanitizeGame_(state.game);const pstate=state.game[actor];if(pstate.purchases.indexOf('packing-list')<0)throw new Error('Unlock Packing List first');const id=cleanText_(payload.id,80);if(!id)throw new Error('Trip not found');pstate.packing[id]=(Array.isArray(payload.list)?payload.list:[]).slice(0,100).map(function(x){return {text:cleanText_(x&&x.text,120),done:!!(x&&x.done)};}).filter(function(x){return !!x.text;});state.game[actor]=sanitizeGameProfile_(pstate);saveState_(state);return output_(gameResponse_(state));
    }

    if (action === 'shopSavePlanner') {
      state.game=sanitizeGame_(state.game);const pstate=state.game[actor];if(pstate.purchases.indexOf('trip-planner-plus')<0)throw new Error('Unlock Trip Planner+ first');const id=cleanText_(payload.id,80),p=payload.planner||{};if(!id)throw new Error('Trip not found');pstate.planners[id]={stay:cleanText_(p.stay,160),transport:cleanText_(p.transport,160),booking:cleanText_(p.booking,160),notes:cleanText_(p.notes,1200)};state.game[actor]=sanitizeGameProfile_(pstate);saveState_(state);return output_(gameResponse_(state));
    }

    if (action === 'shopSendSignal') {
      state.game=sanitizeGame_(state.game);const type=String(payload.type)==='note'?'note':'heart',need=type==='note'?'flying-note':'flying-heart',pstate=state.game[actor];if(pstate.purchases.indexOf(need)<0)throw new Error('Unlock '+(type==='note'?'Flying Note':'Flying Heart')+' first');const to=actor==='Principessa'?'Principe':'Principessa';state.game.signals.push({id:Utilities.getUuid(),from:actor,to:to,type:type,text:type==='note'?cleanText_(payload.text,160):'',createdAt:new Date().toISOString(),seenAt:''});state.game.signals=state.game.signals.slice(-40);saveState_(state);return output_(gameResponse_(state));
    }

    if (action === 'shopMarkSignalsSeen') {
      state.game=sanitizeGame_(state.game);const now=new Date().toISOString();state.game.signals.forEach(function(x){if(x.to===actor&&!x.seenAt)x.seenAt=now;});saveState_(state);return output_(gameResponse_(state));
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

function cleanSharedMode_(value) {
  const mode = String(value || '');
  return mode === 'full' || mode === 'shared' ? mode : '';
}


function money2_(value) { return Math.round((Number(value) || 0) * 100) / 100; }
function defaultSharedJar_() { return {initialBalance:870,balance:870,transactions:[]}; }
function sanitizeSharedJar_(value) {
  const source = value && typeof value === 'object' ? value : {};
  let initialBalance = cleanMoney_(source.initialBalance); if (initialBalance === '') initialBalance = 870;
  const byPlan = {};
  (Array.isArray(source.transactions) ? source.transactions : []).slice(-300).forEach(function(x){
    const planId = cleanText_(x && x.planId, 80), amount = cleanMoney_(x && x.amount);
    if (!planId || amount === '' || Number(amount) <= 0) return;
    byPlan[planId] = {planId:planId,amount:money2_(amount),actor:cleanActor_(x && x.actor),at:cleanText_(x && x.at,40)};
  });
  const transactions = Object.keys(byPlan).map(function(k){ return byPlan[k]; });
  const used = transactions.reduce(function(sum,x){ return sum + Number(x.amount || 0); },0);
  return {initialBalance:initialBalance,balance:money2_(Math.max(0,Number(initialBalance)-used)),transactions:transactions};
}
function defaultAccommodationMeta_(){return {useJar:false,jarContribution:0,jarBalanceAfter:870,remaining:'',paymentType:'',paidUpfront:false,upfrontBy:'',shareEach:'',repayment:{debtor:'',creditor:'',amount:'',status:'none',confirmedAt:''}};}
function sanitizeAccommodationMeta_(value){
  const s=value&&typeof value==='object'?value:{},r=s.repayment&&typeof s.repayment==='object'?s.repayment:{};
  const paymentType=String(s.paymentType||''); const status=['none','pending','confirmed'].indexOf(String(r.status||''))>=0?String(r.status):'none';
  const upfrontBy=cleanActor_(s.upfrontBy)==='Unknown'?'':cleanActor_(s.upfrontBy),debtor=cleanActor_(r.debtor)==='Unknown'?'':cleanActor_(r.debtor),creditor=cleanActor_(r.creditor)==='Unknown'?'':cleanActor_(r.creditor);
  return {useJar:s.useJar===true,jarContribution:cleanMoney_(s.jarContribution)===''?0:cleanMoney_(s.jarContribution),jarBalanceAfter:cleanMoney_(s.jarBalanceAfter)===''?870:cleanMoney_(s.jarBalanceAfter),remaining:cleanMoney_(s.remaining),paymentType:paymentType==='solo'||paymentType==='shared'?paymentType:'',paidUpfront:s.paidUpfront===true,upfrontBy:upfrontBy,shareEach:cleanMoney_(s.shareEach),repayment:{debtor:debtor,creditor:creditor,amount:cleanMoney_(r.amount),status:status,confirmedAt:cleanText_(r.confirmedAt,40)}};
}
function prepItem_(x){return {id:cleanText_(x&&x.id,80)||Utilities.getUuid(),text:cleanText_(x&&x.text,160),done:!!(x&&x.done)};}
function defaultTripPrep_(){return {packing:[],reminders:[],updatedAt:'',updatedBy:'Unknown'};}
function sanitizeTripPrep_(value){const s=value&&typeof value==='object'?value:{};return {packing:(Array.isArray(s.packing)?s.packing:[]).slice(0,120).map(prepItem_).filter(function(x){return !!x.text;}),reminders:(Array.isArray(s.reminders)?s.reminders:[]).slice(0,120).map(prepItem_).filter(function(x){return !!x.text;}),updatedAt:cleanText_(s.updatedAt,40),updatedBy:cleanActor_(s.updatedBy)};}

function emptySharedExpense_() {
  return {
    total:'', totalUncertain:false, totalKnownBy:'', totals:{Principessa:'',Principe:''},
    mode:{Principessa:'',Principe:''},
    paid:{Principessa:'',Principe:''},
    unknown:{Principessa:false,Principe:false},
    accommodation:defaultAccommodationMeta_(),
    updatedAt:'', updatedBy:'Unknown'
  };
}

function sanitizeSharedExpense_(item) {
  const source = item && typeof item === 'object' ? item : {};
  const out = emptySharedExpense_();
  out.total = cleanMoney_(source.total);
  out.totalUncertain = !!source.totalUncertain;
  out.totalKnownBy = cleanActor_(source.totalKnownBy) === 'Unknown' ? '' : cleanActor_(source.totalKnownBy);
  ACTORS.forEach(function(name){
    out.totals[name] = cleanMoney_(source.totals && source.totals[name]);
    out.mode[name] = cleanSharedMode_(source.mode && source.mode[name]);
    out.paid[name] = cleanMoney_(source.paid && source.paid[name]);
    out.unknown[name] = !!(source.unknown && source.unknown[name]);
  });
  out.accommodation = sanitizeAccommodationMeta_(source.accommodation);
  out.updatedAt = cleanText_(source.updatedAt,40);
  out.updatedBy = cleanActor_(source.updatedBy);
  return out;
}

function sanitizeSharedExpenses_(source) {
  const obj = source && typeof source === 'object' ? source : {};
  return {
    accom: sanitizeSharedExpense_(obj.accom),
    travel: sanitizeSharedExpense_(obj.travel)
  };
}

function applySharedTotalsToDraft_(plan, draft) {
  draft.uncertain = Object.assign({}, draft.uncertain || {});
  SHARED_EXPENSE_KEYS.forEach(function(key){
    const meta = sanitizeSharedExpense_(plan && plan.sharedExpenses && plan.sharedExpenses[key]);
    const hasAnyMode = !!(meta.mode.Principessa || meta.mode.Principe);
    if (!hasAnyMode) return;
    if (meta.total !== '') {
      draft[key] = meta.total;
      if (meta.totalUncertain) draft.uncertain[key] = true;
      else if (draft.uncertain[key] === undefined) draft.uncertain[key] = false;
    } else {
      draft[key] = 0;
      draft.uncertain[key] = true;
    }
  });
}

function syncSharedExpenseIntoPlanAndTrip_(state, plan, key) {
  const meta = sanitizeSharedExpense_(plan.sharedExpenses && plan.sharedExpenses[key]);
  plan.sharedExpenses[key] = meta;
  if (meta.total !== '') {
    ACTORS.forEach(function(name){
      if (plan.partials && plan.partials[name]) {
        plan.partials[name][key] = meta.total;
        plan.partials[name].uncertain = Object.assign({}, plan.partials[name].uncertain || {});
        plan.partials[name].uncertain[key] = !!meta.totalUncertain;
      }
    });
  }
  if (!plan.linkedTripId) return;
  const idx = state.trips.findIndex(function(t){ return t.id === plan.linkedTripId; });
  if (idx < 0) return;
  const trip = sanitizeTripRecord_(state.trips[idx]);
  trip.sharedExpenses = sanitizeSharedExpenses_(plan.sharedExpenses);
  if (meta.total !== '') {
    ACTORS.forEach(function(name){
      if (trip.submissions[name]) {
        trip.submissions[name][key] = meta.total;
        trip.submissions[name].uncertain = Object.assign({}, trip.submissions[name].uncertain || {});
        trip.submissions[name].uncertain[key] = !!meta.totalUncertain;
      }
    });
  }
  trip.confirmed = {Principessa:false,Principe:false};
  trip.updatedAt = new Date().toISOString();
  trip.updatedBy = plan.updatedBy;
  state.trips[idx] = trip;
}

function sharedExpensesResolved_(source) {
  const all = sanitizeSharedExpenses_(source);
  return SHARED_EXPENSE_KEYS.every(function(key){
    const m = all[key];
    const used = !!(m.mode.Principessa || m.mode.Principe);
    return !used || m.total !== '';
  });
}

function isTripLocked_(trip) {
  return !!(trip && trip.confirmed && trip.confirmed.Principessa && trip.confirmed.Principe);
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

function sanitizeFinanceExtraSpend_(item) {
  const sourceRaw = String(item && item.source || '');
  const source = sourceRaw === 'creditcard' || sourceRaw === 'savings' || sourceRaw === 'main' ? sourceRaw : '';
  return {
    id: cleanText_(item && item.id, 80) || Utilities.getUuid(),
    source: source,
    amount: cleanMoney_(item && item.amount)
  };
}


function sanitizeFinancePlanningItem_(item){
  const s=item&&typeof item==='object'?item:{},frequency=['one-time','monthly','yearly'].indexOf(String(s.frequency||''))>=0?String(s.frequency):'one-time',paymentTiming=['upfront','later'].indexOf(String(s.paymentTiming||''))>=0?String(s.paymentTiming):'';
  const kind=String(s.kind||'')==='income'?'income':'expense';
  const allowed=['medical','subscriptions','rent','transport','groceries','extra','savings','investments','other']; let group=String(s.group||'other'); if(allowed.indexOf(group)<0)group='other';
  const planner=cleanMoney_(s.planner),actual=cleanMoney_(s.actual); let reserveMonthly='';
  if(frequency==='yearly'&&paymentTiming==='later'&&planner!=='')reserveMonthly=money2_(Number(planner)/12);
  return {id:cleanText_(s.id,80)||Utilities.getUuid(),name:cleanText_(s.name,120),kind:kind,group:group,planner:planner,actual:actual,frequency:frequency,paymentTiming:paymentTiming,reserveMonthly:reserveMonthly,notes:cleanText_(s.notes,240),custom:s.custom===true};
}
function sanitizeFinancePlanning_(value){const s=value&&typeof value==='object'?value:{};return {items:(Array.isArray(s.items)?s.items:[]).slice(0,120).map(sanitizeFinancePlanningItem_).filter(function(x){return !!x.name;}),openingSavings:cleanMoney_(s.openingSavings),updatedAt:cleanText_(s.updatedAt,40)};}

function sanitizeFinanceMonth_(record, actor) {
  const incomes = Array.isArray(record && record.incomes) ? record.incomes.slice(0,40).map(sanitizeFinanceIncome_).filter(x => x.name && x.amount !== '') : [];
  let expenses = Array.isArray(record && record.expenses) ? record.expenses.slice(0,100).map(sanitizeFinanceExpense_).filter(x => x.name && x.amount !== '') : [];
  const rawBudget = cleanMoney_(record && record.extraBudget);
  const extraBudget = rawBudget === '' ? 250 : rawBudget;
  let foundFixedExtra = false;
  expenses = expenses.filter(function(x){
    if (x.group === 'extra' && String(x.name || '').trim().toLowerCase() === 'extra') {
      if (foundFixedExtra) return false;
      foundFixedExtra = true;
      x.amount = extraBudget;
    }
    return true;
  });
  if (!foundFixedExtra) expenses.push({group:'extra', name:'Extra', amount:extraBudget});

  let extraSpends = Array.isArray(record && record.extraSpends) ? record.extraSpends.slice(0,60).map(sanitizeFinanceExtraSpend_).filter(function(x){ return x.source && x.amount !== '' && Number(x.amount) > 0; }) : [];
  if (!extraSpends.length) {
    const legacySourceRaw = String(record && record.extraOverspendSource || '');
    const legacySource = legacySourceRaw === 'creditcard' || legacySourceRaw === 'savings' || legacySourceRaw === 'main' ? legacySourceRaw : '';
    const legacyAmount = cleanMoney_(record && record.extraOverspendAmount);
    if (legacySource && legacyAmount !== '' && Number(legacyAmount) > 0) extraSpends.push({id:Utilities.getUuid(),source:legacySource,amount:legacyAmount});
  }
  const legacyTotal = extraSpends.reduce(function(sum,x){ return sum + Number(x.amount || 0); },0);
  return {
    month: cleanText_(record && record.month, 10),
    incomes: incomes,
    expenses: expenses,
    extraBudget: extraBudget,
    extraSpends: extraSpends,
    extraOverspendSource: extraSpends.length ? extraSpends[0].source : '',
    extraOverspendAmount: legacyTotal,
    investmentTotal: cleanMoney_(record && record.investmentTotal),
    sisterInvestments: cleanMoney_(record && record.sisterInvestments),
    planning: sanitizeFinancePlanning_(record && record.planning),
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

function sanitizeFinanceRepayment_(item) {
  return {
    id: cleanText_(item && item.id, 80) || Utilities.getUuid(),
    month: cleanText_(item && item.month, 10),
    amount: cleanMoney_(item && item.amount),
    at: cleanText_(item && item.at, 40)
  };
}

function sanitizeFinanceReceivable_(item) {
  const principal = cleanMoney_(item && (item.principal != null ? item.principal : item.amount));
  return {
    id: cleanText_(item && item.id, 80) || Utilities.getUuid(),
    person: cleanText_(item && item.person, 100),
    reason: cleanText_(item && item.reason, 180),
    principal: principal,
    repayments: Array.isArray(item && item.repayments) ? item.repayments.slice(-120).map(sanitizeFinanceRepayment_).filter(function(x){ return /^\d{4}-\d{2}$/.test(x.month) && x.amount !== ''; }) : []
  };
}

function sanitizeFinanceScenario_(item) {
  return {
    id: cleanText_(item && item.id, 80) || Utilities.getUuid(),
    name: cleanText_(item && item.name, 140),
    upfront: cleanMoney_(item && item.upfront),
    monthly: cleanMoney_(item && item.monthly)
  };
}

function sanitizeFinanceWishlistItem_(item) {
  const priority=Math.min(5,Math.max(1,Number(item&&item.priority)||3));
  return {
    id: cleanText_(item && item.id, 80) || Utilities.getUuid(),
    name: cleanText_(item && item.name, 160),
    price: cleanMoney_(item && item.price),
    note: cleanText_(item && item.note, 500),
    priority: priority,
    createdAt: cleanText_(item && item.createdAt, 40),
    unlockedAt: cleanText_(item && item.unlockedAt, 40),
    unlockedBy: cleanActor_(item && item.unlockedBy)==='Unknown'?'':cleanActor_(item && item.unlockedBy)
  };
}
function sanitizeCompareRow_(item){return {id:cleanText_(item&&item.id,80)||Utilities.getUuid(),name:cleanText_(item&&item.name,120)||'Cost',amount:cleanMoney_(item&&item.amount)};}
function sanitizeCompareLab_(value){
  const v=value&&typeof value==='object'?value:{};
  if(!Object.keys(v).length)return {};
  return {id:cleanText_(v.id,80)||Utilities.getUuid(),titleA:cleanText_(v.titleA,120)||'Scenario A',titleB:cleanText_(v.titleB,120)||'Scenario B',rowsA:(Array.isArray(v.rowsA)?v.rowsA:[]).slice(0,30).map(sanitizeCompareRow_),rowsB:(Array.isArray(v.rowsB)?v.rowsB:[]).slice(0,30).map(sanitizeCompareRow_),updatedAt:cleanText_(v.updatedAt,40)||new Date().toISOString()};
}

function sanitizeFinanceProfile_(profile, actor) {
  const source = profile && typeof profile === 'object' ? profile : {};
  return {
    bankAccounts: Array.isArray(source.bankAccounts) ? source.bankAccounts.slice(0,30).map(sanitizeFinanceBank_).filter(x => x.name && x.balance !== '') : [],
    savingsTotal: cleanMoney_(source.savingsTotal),
    savingsReserved: Array.isArray(source.savingsReserved) ? source.savingsReserved.slice(0,40).map(sanitizeFinanceHold_).filter(x => x.name && x.amount !== '') : [],
    receivables: Array.isArray(source.receivables) ? source.receivables.slice(0,60).map(sanitizeFinanceReceivable_).filter(x => x.person && x.reason && x.principal !== '') : [],
    scenarios: Array.isArray(source.scenarios) ? source.scenarios.slice(0,40).map(sanitizeFinanceScenario_).filter(x => x.name && x.upfront !== '') : [],
    wishlist: Array.isArray(source.wishlist) ? source.wishlist.slice(0,100).map(sanitizeFinanceWishlistItem_).filter(x => x.name) : [],
    compareLab: source.compareLab && typeof source.compareLab === 'object' ? sanitizeCompareLab_(source.compareLab) : {},
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
    sharedExpenses: sanitizeSharedExpenses_(plan && plan.sharedExpenses),
    prep: sanitizeTripPrep_(plan && plan.prep),
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
    sharedExpenses: sanitizeSharedExpenses_(t && t.sharedExpenses),
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


function doPost(e) {
  const response=handlePost_(e);
  if(!e || !e.parameter || !e.parameter.requestId)return response;
  const message={type:'twogether:saved',requestId:String(e.parameter.requestId),result:JSON.parse(response.getContent())};
  const safe=JSON.stringify(message).replace(/</g,'\\u003c');
  return HtmlService.createHtmlOutput('<script>window.top.postMessage('+safe+',"*");</script>').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function reconciliationWarnings_(trip) {
  const warnings=[];
  const shared=sanitizeSharedExpenses_(trip.sharedExpenses);
  SHARED_EXPENSE_KEYS.forEach(function(key){
    const m=shared[key];if(!m.mode.Principessa&&!m.mode.Principe)return;
    if(ACTORS.every(name=>m.totals[name]!=='') && Math.abs(Number(m.totals.Principessa)-Number(m.totals.Principe))>.005)warnings.push(key+' total bills differ between profiles.');
    if(m.total===''||m.totalUncertain){warnings.push(key+' total needs resolving.');return;}
    const full=ACTORS.some(name=>m.mode[name]==='full');
    if(!full && ACTORS.some(name=>m.paid[name]==='')){warnings.push(key+' is waiting for both payments.');return;}
    const jar=key==='accom'?Number(m.accommodation&&m.accommodation.jarContribution||0):0;
    const paid=Number(m.paid.Principessa||0)+Number(m.paid.Principe||0)+jar;
    if(Math.abs(paid-Number(m.total))>.005)warnings.push(key+' payments differ from the bill by €'+Math.abs(paid-Number(m.total)).toFixed(2)+'.');
  });
  const a=trip.submissions.Principessa,b=trip.submissions.Principe;
  if(a&&b){const total=MONEY_FIELDS.reduce((sum,key)=>sum+Number(a[key]||0),0);const shared=sanitizeSharedExpenses_(trip.sharedExpenses);const jar=Number(shared.accom&&shared.accom.accommodation&&shared.accom.accommodation.jarContribution||0);const paid=Number(a.paid||0)+Number(b.paid||0)+jar;if(Math.abs(total-paid)>.005)warnings.push('Total payments do not match trip expenses (difference €'+Math.abs(total-paid).toFixed(2)+').');}
  return warnings;
}
