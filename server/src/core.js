let stateStore = null;

function randomUuid_() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const Utilities = { getUuid: randomUuid_ };
const MAX_AUDIT = 2;
const ACTORS = ['Principessa', 'Principe'];
const MONEY_FIELDS = ['accom','groceries','eat','travel','fuel','tolls','other'];
const SHARED_EXPENSE_KEYS = ['accom','travel'];

function defaultState_() {
  return {
    version: 18,
    trips: [],
    plans: [],
    stayFavorites: [],
    tripPrepDefaults: defaultTripPrepDefaults_(),
    finances: {Principessa:[], Principe:[]},
    financeProfiles: {
      Principessa:{bankAccounts:[],savingsTotal:'',savingsReserved:[],receivables:[],scenarios:[],wishlist:[],compareLab:{},customCategories:[],customCategoryCleanupV1:true},
      Principe:{bankAccounts:[],savingsTotal:'',savingsReserved:[],receivables:[],scenarios:[],wishlist:[],compareLab:{},customCategories:[],customCategoryCleanupV1:true}
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
  if (!stateStore) throw new Error('Database is not configured');
  try {
    const parsed = stateStore.read();
    const base = defaultState_();
    const plans = Array.isArray(parsed.plans) ? parsed.plans.map(sanitizePlan_) : [];
    const state = {
      version: 18,
      trips: Array.isArray(parsed.trips) ? parsed.trips.map(migrateTrip_) : [],
      plans: plans,
      stayFavorites: collectStayFavorites_(parsed.stayFavorites, plans),
      tripPrepDefaults: sanitizeTripPrepDefaults_(parsed.tripPrepDefaults),
      finances: sanitizeFinances_(parsed.finances),
      financeProfiles: sanitizeFinanceProfiles_(parsed.financeProfiles),
      sharedJar: sanitizeSharedJar_(parsed.sharedJar),
      game: sanitizeGame_(parsed.game),
      compare: Object.assign(base.compare, parsed.compare || {}),
      audit: Array.isArray(parsed.audit) ? parsed.audit.slice(-MAX_AUDIT) : [],
      updatedAt: parsed.updatedAt || ''
    };

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
  state.stayFavorites = collectStayFavorites_(state.stayFavorites, state.plans);
  state.tripPrepDefaults = sanitizeTripPrepDefaults_(state.tripPrepDefaults);
  state.finances = sanitizeFinances_(state.finances);
  state.financeProfiles = sanitizeFinanceProfiles_(state.financeProfiles);
  state.sharedJar = sanitizeSharedJar_(state.sharedJar);
  state.game = sanitizeGame_(state.game);
  if (!stateStore) throw new Error('Database is not configured');
  stateStore.write(state);
}

function output_(obj) { return obj; }

function handleAction_(actionValue, payloadValue, actorValue) {
  const action = String(actionValue || '');
  const actor = cleanActor_(actorValue);
  const payload = payloadValue && typeof payloadValue === 'object' ? payloadValue : {};

  if (actor === 'Unknown') return output_({ok:false, error:'Choose Principessa or Principe first'});

  try {
    const state = readState_();

    if (action === 'savePlan') {
      const id = cleanText_(payload.id, 80);
      const now = new Date().toISOString();
      let idx = id ? state.plans.findIndex(x => x.id === id) : -1;
      const creatingPlan = idx < 0;
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
        if (!meta.location || (!meta.city && meta.location !== 'Italy') || !meta.start || !meta.end) {
          throw new Error(meta.location === 'Italy' ? 'Add the trip location and dates first' : 'Add the trip location, city and dates first');
        }
        plan = sanitizePlan_({
          id: Utilities.getUuid(),
          meta: meta,
          budgets: {Principessa:'', Principe:''},
          partials: {Principessa:null, Principe:null},
          sharedExpenses: {},
          prep: tripPrepForNewPlan_(state.tripPrepDefaults, actor, now),
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
      if (budget !== '') {
        plan.budgets[actor] = budget;
        addAudit_(state, actor, 'setIndividualBudget', plan.id);
      } else if (!creatingPlan) {
        throw new Error('Enter your individual budget');
      } else {
        addAudit_(state, actor, 'createTripPlan', plan.id);
      }
      plan.updatedAt = now;
      plan.updatedBy = actor;
      state.plans[idx] = plan;
      resetPlanTripConfirmations_(state, plan);
      saveState_(state);
      return output_({ok:true, planId:plan.id});
    }


    if (action === 'saveStaySearchPreferences') {
      const planId = cleanText_(payload.planId, 80);
      const planIdx = state.plans.findIndex(function(x){ return x.id === planId; });
      if (planIdx < 0) throw new Error('Budget plan not found');
      const plan = sanitizePlan_(state.plans[planIdx]);
      plan.stayTracker.area = cleanText_(payload.area,120) || plan.stayTracker.area || 'lake-garda';
      plan.stayTracker.preferences = sanitizeStayPreferences_(payload.preferences);
      plan.updatedAt = new Date().toISOString();
      plan.updatedBy = actor;
      state.plans[planIdx] = plan;
      saveState_(state);
      return output_({ok:true,planId:plan.id,stayTracker:plan.stayTracker});
    }

    if (action === 'saveStayFavorite') {
      const planId = cleanText_(payload.planId, 80);
      const contextPlan = planId ? state.plans.find(function(x){ return x.id === planId; }) : null;
      if (planId && !contextPlan) throw new Error('Trip not found');
      state.stayFavorites = collectStayFavorites_(state.stayFavorites, state.plans);
      const incoming = sanitizeStayFavorite_(payload.favorite || {});
      if (!incoming.url) throw new Error('Add the accommodation link first');
      if (incoming.source !== 'airbnb') throw new Error('Our Stays only accepts Airbnb links now');
      const urlKey = stayUrlKey_(incoming.url);
      let favoriteIdx = state.stayFavorites.findIndex(function(item){ return stayUrlKey_(item.url) === urlKey; });
      const now = new Date().toISOString();
      const favorite = favoriteIdx >= 0 ? state.stayFavorites[favoriteIdx] : sanitizeStayFavorite_({
        id: Utilities.getUuid(), source:'airbnb', createdAt: now
      });
      favorite.source = 'airbnb';
      favorite.url = incoming.url;
      favorite.name = incoming.name || favorite.name || 'Airbnb stay';
      favorite.city = incoming.city || favorite.city;
      favorite.area = incoming.area || favorite.area;
      favorite.image = incoming.image || favorite.image;
      if (payload.favorite && Object.prototype.hasOwnProperty.call(payload.favorite,'note')) favorite.note = incoming.note;
      favorite.updatedAt = now;
      if (!favorite.createdAt) favorite.createdAt = now;
      const price = cleanMoney_(payload.price);
      if (price !== '') {
        const safeContext = contextPlan ? sanitizePlan_(contextPlan) : null;
        favorite.history.push(sanitizeStayFavoritePrice_({
          price: price,
          checkedAt: cleanText_(payload.checkedAt,40) || now,
          planId: safeContext ? safeContext.id : '',
          start: safeContext ? safeContext.meta.start : '',
          end: safeContext ? safeContext.meta.end : ''
        }));
        favorite.history = favorite.history.slice(-200);
      }
      if (favoriteIdx >= 0) state.stayFavorites[favoriteIdx] = favorite;
      else state.stayFavorites.push(favorite);
      addAudit_(state, actor, 'saveStayFavorite', favorite.id);
      saveState_(state);
      return output_({ok:true,favorite:favorite,ownerPlanId:''});
    }

    if (action === 'updateStayFavoriteDetails') {
      const favoriteId = cleanText_(payload.favoriteId,80);
      state.stayFavorites = collectStayFavorites_(state.stayFavorites, state.plans);
      const favoriteIdx = state.stayFavorites.findIndex(function(item){ return item.id === favoriteId; });
      if (favoriteIdx < 0) throw new Error('Accommodation not found');
      const favorite = state.stayFavorites[favoriteIdx];
      favorite.note = cleanText_(payload.note,500);
      favorite.updatedAt = new Date().toISOString();
      state.stayFavorites[favoriteIdx] = favorite;
      addAudit_(state, actor, 'updateStayFavoriteDetails', favorite.id);
      saveState_(state);
      return output_({ok:true,favorite:favorite,ownerPlanId:''});
    }

    if (action === 'updateStayFavoritePrice') {
      const favoriteId = cleanText_(payload.favoriteId,80);
      const contextPlanId = cleanText_(payload.contextPlanId,80);
      const contextPlan = contextPlanId ? state.plans.find(function(x){ return x.id === contextPlanId; }) : null;
      if (contextPlanId && !contextPlan) throw new Error('Trip not found');
      state.stayFavorites = collectStayFavorites_(state.stayFavorites, state.plans);
      const favoriteIdx = state.stayFavorites.findIndex(function(item){ return item.id === favoriteId; });
      if (favoriteIdx < 0) throw new Error('Accommodation not found');
      const price = cleanMoney_(payload.price);
      if (price === '') throw new Error('Enter the current total price');
      const safeContext = contextPlan ? sanitizePlan_(contextPlan) : null;
      const now = cleanText_(payload.checkedAt,40) || new Date().toISOString();
      const favorite = state.stayFavorites[favoriteIdx];
      favorite.history.push(sanitizeStayFavoritePrice_({
        price:price,
        status:'available',
        checkedAt:now,
        planId:safeContext ? safeContext.id : '',
        start:safeContext ? safeContext.meta.start : '',
        end:safeContext ? safeContext.meta.end : ''
      }));
      favorite.history = favorite.history.slice(-200);
      favorite.updatedAt = now;
      state.stayFavorites[favoriteIdx] = favorite;
      addAudit_(state, actor, 'updateStayFavoritePrice', favorite.id);
      saveState_(state);
      return output_({ok:true,favorite:favorite,ownerPlanId:''});
    }

    if (action === 'markStayFavoriteUnavailable') {
      const favoriteId = cleanText_(payload.favoriteId,80);
      const contextPlanId = cleanText_(payload.contextPlanId,80);
      const contextPlan = state.plans.find(function(x){ return x.id === contextPlanId; });
      if (!contextPlan) throw new Error('Trip not found');
      state.stayFavorites = collectStayFavorites_(state.stayFavorites, state.plans);
      const favoriteIdx = state.stayFavorites.findIndex(function(item){ return item.id === favoriteId; });
      if (favoriteIdx < 0) throw new Error('Accommodation not found');
      const safeContext = sanitizePlan_(contextPlan);
      const now = cleanText_(payload.checkedAt,40) || new Date().toISOString();
      const favorite = state.stayFavorites[favoriteIdx];
      favorite.history.push(sanitizeStayFavoritePrice_({
        price:'',
        status:'unavailable',
        checkedAt:now,
        planId:safeContext.id,
        start:safeContext.meta.start,
        end:safeContext.meta.end
      }));
      favorite.history = favorite.history.slice(-200);
      favorite.updatedAt = now;
      state.stayFavorites[favoriteIdx] = favorite;
      addAudit_(state, actor, 'markStayFavoriteUnavailable', favorite.id);
      saveState_(state);
      return output_({ok:true,favorite:favorite,ownerPlanId:''});
    }

    if (action === 'deleteStayFavorite') {
      const favoriteId = cleanText_(payload.favoriteId,80);
      state.stayFavorites = collectStayFavorites_(state.stayFavorites, state.plans);
      const before = state.stayFavorites.length;
      state.stayFavorites = state.stayFavorites.filter(function(item){ return item.id !== favoriteId; });
      state.plans = state.plans.map(function(rawPlan){
        const plan = sanitizePlan_(rawPlan);
        plan.stayTracker.saved = plan.stayTracker.saved.filter(function(item){ return item.id !== favoriteId; });
        const selected = plan.stayTracker && plan.stayTracker.selected || {};
        if (selected.favoriteId === favoriteId) plan.stayTracker.selected = sanitizeStaySelection_({});
        return plan;
      });
      if (before === state.stayFavorites.length) throw new Error('Accommodation not found');
      addAudit_(state, actor, 'deleteStayFavorite', favoriteId);
      saveState_(state);
      return output_({ok:true});
    }

    if (action === 'selectStayForTrip') {
      const planId = cleanText_(payload.planId,80);
      const ownerPlanId = cleanText_(payload.ownerPlanId,80);
      const favoriteId = cleanText_(payload.favoriteId,80);
      const planIdx = state.plans.findIndex(function(x){ return x.id === planId; });
      if (planIdx < 0) throw new Error('Trip not found');

      const plan = sanitizePlan_(state.plans[planIdx]);
      const linkedTrip = plan.linkedTripId ? state.trips.find(function(t){ return t.id === plan.linkedTripId; }) : null;
      if (linkedTrip && isTripLocked_(linkedTrip)) throw new Error('This trip is already confirmed by both of you');

      const existingEntry = plan.expenseEntries.find(function(item){ return item.category === 'accommodation'; });
      const legacyAccom = sanitizeSharedExpense_(plan.sharedExpenses && plan.sharedExpenses.accom);
      if (existingEntry || legacyAccom.total !== '' || legacyAccom.accommodation.paymentType) {
        throw new Error('This trip already has an accommodation expense');
      }

      state.stayFavorites = collectStayFavorites_(state.stayFavorites, state.plans);
      let favorite = state.stayFavorites.find(function(item){ return item.id === favoriteId; }) || null;
      if (!favorite && ownerPlanId) {
        const owner = state.plans.find(function(item){ return item.id === ownerPlanId; });
        favorite = owner && sanitizePlan_(owner).stayTracker.saved.find(function(item){ return item.id === favoriteId; });
      }
      if (!favorite) throw new Error('Saved accommodation not found');
      const tripChecks = (Array.isArray(favorite.history) ? favorite.history : [])
        .filter(function(item){
          return item.planId ? item.planId === plan.id : (item.start === plan.meta.start && item.end === plan.meta.end);
        })
        .slice().sort(function(a,b){ return String(a.checkedAt).localeCompare(String(b.checkedAt)); });
      const latestCheck = tripChecks[tripChecks.length - 1] || null;
      if (latestCheck && latestCheck.status === 'unavailable') throw new Error('This accommodation is unavailable for this trip');
      const latestPrice = tripChecks.filter(function(item){ return item.status !== 'unavailable' && cleanMoney_(item.price) !== ''; }).pop() || null;
      const total = cleanMoney_(latestPrice && latestPrice.price);
      if (total === '') throw new Error('Update this accommodation price for these trip dates before selecting it');

      const now = new Date().toISOString();
      const expense = sanitizeTripExpense_({
        id:Utilities.getUuid(),
        category:'accommodation',
        amount:total,
        paidBy:'both',
        split:'shared',
        forActor:'',
        date:now.slice(0,10),
        note:favorite.name || 'Airbnb accommodation',
        uncertain:false,
        useJar:false,
        loggedBy:actor,
        createdAt:now,
        updatedAt:now
      },actor);
      plan.expenseEntries.push(expense);

      plan.stayTracker.selected = {
        ownerPlanId:'',
        favoriteId:favoriteId,
        selectedAt:now,
        priceAtSelection:total,
        expenseId:expense.id
      };
      plan.updatedAt = now;
      plan.updatedBy = actor;
      state.plans[planIdx] = plan;
      resetPlanTripConfirmations_(state,plan);
      addAudit_(state, actor, 'selectStayForTrip', plan.id);
      saveState_(state);
      return output_({ok:true,planId:plan.id,expense:expense,selected:plan.stayTracker.selected});
    }

    if (action === 'unselectStayForTrip') {
      const planId = cleanText_(payload.planId,80);
      const planIdx = state.plans.findIndex(function(x){ return x.id === planId; });
      if (planIdx < 0) throw new Error('Trip not found');
      const plan = sanitizePlan_(state.plans[planIdx]);
      const linkedTrip = plan.linkedTripId ? state.trips.find(function(t){ return t.id === plan.linkedTripId; }) : null;
      if (linkedTrip && isTripLocked_(linkedTrip)) throw new Error('This trip is already confirmed by both of you');

      const selected = plan.stayTracker && plan.stayTracker.selected || {};
      if (!selected.favoriteId) throw new Error('No accommodation is selected for this trip');

      const expenseId = cleanText_(selected.expenseId,80);
      if (expenseId) {
        const expenseIdx = plan.expenseEntries.findIndex(function(item){ return item.id === expenseId; });
        if (expenseIdx >= 0) plan.expenseEntries.splice(expenseIdx,1);
        state.sharedJar = sanitizeSharedJar_(state.sharedJar);
        state.sharedJar.transactions = state.sharedJar.transactions.filter(function(x){
          return !(x.planId === planId && x.expenseId === expenseId);
        });
        state.sharedJar = sanitizeSharedJar_(state.sharedJar);
      } else {
        // Backward compatibility for stays selected before Our Stays began using normal trip expenses.
        state.sharedJar = sanitizeSharedJar_(state.sharedJar);
        state.sharedJar.transactions = state.sharedJar.transactions.filter(function(x){
          return !(x.planId === planId && !x.expenseId);
        });
        state.sharedJar = sanitizeSharedJar_(state.sharedJar);
        plan.sharedExpenses.accom = emptySharedExpense_();
        ACTORS.forEach(function(name){
          if (plan.partials && plan.partials[name]) {
            plan.partials[name].accom = 0;
            plan.partials[name].uncertain = Object.assign({}, plan.partials[name].uncertain || {});
            plan.partials[name].uncertain.accom = false;
          }
        });
        if (plan.linkedTripId) {
          const tripIdx = state.trips.findIndex(function(t){ return t.id === plan.linkedTripId; });
          if (tripIdx >= 0) {
            const trip = sanitizeTripRecord_(state.trips[tripIdx]);
            trip.sharedExpenses.accom = emptySharedExpense_();
            ACTORS.forEach(function(name){
              if (trip.submissions[name]) {
                trip.submissions[name].accom = 0;
                trip.submissions[name].uncertain = Object.assign({}, trip.submissions[name].uncertain || {});
                trip.submissions[name].uncertain.accom = false;
              }
            });
            trip.confirmed = {Principessa:false,Principe:false};
            trip.updatedAt = new Date().toISOString();
            trip.updatedBy = actor;
            state.trips[tripIdx] = trip;
          }
        }
      }

      const now = new Date().toISOString();
      plan.stayTracker.selected = sanitizeStaySelection_({});
      plan.updatedAt = now;
      plan.updatedBy = actor;
      state.plans[planIdx] = plan;
      resetPlanTripConfirmations_(state,plan);
      addAudit_(state, actor, 'unselectStayForTrip', plan.id);
      saveState_(state);
      return output_({ok:true,planId:plan.id,selected:plan.stayTracker.selected,sharedJar:state.sharedJar});
    }

    if (action === 'saveStayTrackerSnapshot') {
      const planId = cleanText_(payload.planId, 80);
      const planIdx = state.plans.findIndex(function(x){ return x.id === planId; });
      if (planIdx < 0) throw new Error('Budget plan not found');
      const plan = sanitizePlan_(state.plans[planIdx]);
      const checkedAt = cleanText_(payload.checkedAt, 40) || new Date().toISOString();
      const rows = (Array.isArray(payload.results) ? payload.results : []).slice(0,60).map(function(item){
        return sanitizeStayTrackerSnapshot_(Object.assign({}, item, {checkedAt:cleanText_(item && item.checkedAt,40) || checkedAt}));
      }).filter(function(item){ return item.accommodationId && item.price !== ''; });
      plan.stayTracker.area = ['lake-garda','bergamo'].indexOf(String(payload.area || '')) >= 0 ? String(payload.area) : plan.stayTracker.area;
      const existing = Array.isArray(plan.stayTracker.history) ? plan.stayTracker.history : [];
      const seen = new Set(existing.map(function(item){ return item.accommodationId+'|'+item.checkedAt; }));
      rows.forEach(function(item){
        const key=item.accommodationId+'|'+item.checkedAt;
        if(!seen.has(key)){existing.push(item);seen.add(key);}
      });
      plan.stayTracker.history = existing.slice(-800);
      plan.stayTracker.lastCheckedAt = checkedAt;
      plan.updatedAt = new Date().toISOString();
      plan.updatedBy = actor;
      state.plans[planIdx] = plan;
      addAudit_(state, actor, 'saveStayTrackerSnapshot', plan.id);
      saveState_(state);
      return output_({ok:true,planId:plan.id,stayTracker:plan.stayTracker});
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
      const oldTx = state.sharedJar.transactions.find(function(x){ return x.planId === planId && !x.expenseId; });
      const availableBefore = money2_(Number(state.sharedJar.balance || 0) + Number(oldTx && oldTx.amount || 0));
      const jarContribution = useJar ? money2_(Number(total) * .2) : 0;
      if (jarContribution > availableBefore + .005) throw new Error('The Shared Jar only has ' + formatMoney_(availableBefore) + ' available');
      state.sharedJar.transactions = state.sharedJar.transactions.filter(function(x){ return !(x.planId === planId && !x.expenseId); });
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

    if (action === 'updateSharedJarBalance') {
      state.sharedJar = sanitizeSharedJar_(state.sharedJar);
      const balance = cleanMoney_(payload.balance);
      if (balance === '') throw new Error('Enter a valid Shared Jar balance');
      const used = state.sharedJar.transactions.reduce(function(sum, x){ return sum + Number(x.amount || 0); }, 0);
      state.sharedJar.initialBalance = money2_(Number(balance) + used);
      state.sharedJar = sanitizeSharedJar_(state.sharedJar);
      addAudit_(state, actor, 'updateSharedJarBalance', '');
      saveState_(state);
      return output_({ok:true, sharedJar:state.sharedJar});
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

    if (action === 'saveTripPrepDefaults') {
      const previous = sanitizeTripPrepDefaults_(state.tripPrepDefaults);
      const incoming = payload.prep && typeof payload.prep === 'object' ? payload.prep : {};
      const source = Object.assign({}, incoming);
      if(!Object.prototype.hasOwnProperty.call(source,'notes'))source.notes=previous.notes;
      if(!Object.prototype.hasOwnProperty.call(source,'packingSections'))source.packingSections=previous.packingSections;
      const next = sanitizeTripPrepDefaults_(source);
      const now = new Date().toISOString();
      next.notes=next.notes.map(function(note){return Object.assign({},note,{createdAt:note.createdAt||now});});
      next.updatedAt = now;
      next.updatedBy = actor;
      const updatedPlans = syncRecurrentPrepIntoUpcomingPlans_(state, previous, next, actor, now);
      state.tripPrepDefaults = next;
      addAudit_(state, actor, 'saveTripPrepDefaults', 'trip-prep-defaults');
      saveState_(state);
      return output_({ok:true,prep:state.tripPrepDefaults,updatedPlans:updatedPlans});
    }

    if (action === 'saveTripNotes') {
      const current = sanitizeTripPrepDefaults_(state.tripPrepDefaults);
      const now = new Date().toISOString();
      current.notes=(Array.isArray(payload.notes)?payload.notes:[]).slice(0,120).map(prepNote_).filter(function(note){return !!note.text;}).map(function(note){
        return Object.assign({},note,{createdAt:note.createdAt||now});
      });
      current.updatedAt=now;
      current.updatedBy=actor;
      state.tripPrepDefaults=current;
      addAudit_(state,actor,'saveTripNotes','trip-notes');
      saveState_(state);
      return output_({ok:true,notes:current.notes,prep:current});
    }

    if (action === 'saveTripPrep') {
      const planId = cleanText_(payload.planId, 80);
      const planIdx = state.plans.findIndex(function(x){ return x.id === planId; });
      if (planIdx < 0) throw new Error('Budget plan not found');

      const previousPlan = sanitizePlan_(state.plans[planIdx]);
      const previousDefaults = sanitizeTripPrepDefaults_(state.tripPrepDefaults);
      const promoted = promoteNewTripPrepItemsToDefaults_(previousPlan.prep, payload.prep || {}, previousDefaults, actor);
      const plan = sanitizePlan_(state.plans[planIdx]);
      const now = new Date().toISOString();

      plan.prep = sanitizeTripPrep_(promoted.prep);
      plan.prep.updatedAt = now; plan.prep.updatedBy = actor;
      plan.updatedAt = now; plan.updatedBy = actor;
      state.plans[planIdx] = plan;

      let updatedPlans = 0;
      if (promoted.changed) {
        const nextDefaults = sanitizeTripPrepDefaults_(promoted.defaults);
        nextDefaults.updatedAt = now;
        nextDefaults.updatedBy = actor;
        updatedPlans = syncRecurrentPrepIntoUpcomingPlans_(state, previousDefaults, nextDefaults, actor, now);
        state.tripPrepDefaults = nextDefaults;
        addAudit_(state, actor, 'autoAddTripPrepDefault', plan.id);
      }

      addAudit_(state, actor, 'saveTripPrep', plan.id);
      saveState_(state);
      const savedPlan = sanitizePlan_(state.plans[planIdx]);
      return output_({
        ok:true,
        prep:savedPlan.prep,
        tripPrepDefaults:sanitizeTripPrepDefaults_(state.tripPrepDefaults),
        recurrentUpdated:promoted.changed,
        updatedPlans:updatedPlans
      });
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

    if (action === 'saveTripExpense') {
      const planId=cleanText_(payload.planId,80),idx=state.plans.findIndex(x=>x.id===planId);if(idx<0)throw new Error('Budget plan not found');const plan=sanitizePlan_(state.plans[idx]),linkedTrip=plan.linkedTripId?state.trips.find(x=>x.id===plan.linkedTripId):null;if(linkedTrip&&isTripLocked_(linkedTrip))throw new Error('This trip is already confirmed by both of you');const raw=payload.expense||{},id=cleanText_(raw.id,80),at=id?plan.expenseEntries.findIndex(x=>x.id===id):-1,prev=at>=0?plan.expenseEntries[at]:null,now=new Date().toISOString(),expense=sanitizeTripExpense_(Object.assign({},raw,{id:id||Utilities.getUuid(),loggedBy:prev&&prev.loggedBy||actor,createdAt:prev&&prev.createdAt||now,updatedAt:now}),actor);
      if(expense.amount===''||Number(expense.amount)<=0)throw new Error('Enter a valid expense amount');if(!expense.paidBy)throw new Error('Choose who paid');if(expense.split==='personal'&&expense.paidBy==='both')throw new Error('Choose one payer for a personal expense');if(expense.split==='personal'&&!expense.forActor)expense.forActor=actor;if(!expense.date)expense.date=now.slice(0,10);
      state.sharedJar=sanitizeSharedJar_(state.sharedJar);const old=state.sharedJar.transactions.find(x=>x.planId===planId&&x.expenseId===expense.id),available=money2_(Number(state.sharedJar.balance||0)+Number(old&&old.amount||0)),jar=expense.useJar?money2_(Number(expense.amount)*.2):0;if(jar>available+.005)throw new Error('The Shared Jar only has '+formatMoney_(available)+' available');expense.jarContribution=jar;state.sharedJar.transactions=state.sharedJar.transactions.filter(x=>!(x.planId===planId&&x.expenseId===expense.id));if(jar>0)state.sharedJar.transactions.push({planId:planId,expenseId:expense.id,amount:jar,actor:actor,at:now});state.sharedJar=sanitizeSharedJar_(state.sharedJar);
      if(at>=0)plan.expenseEntries[at]=expense;else plan.expenseEntries.push(expense);if(plan.stayTracker&&plan.stayTracker.selected&&plan.stayTracker.selected.expenseId===expense.id&&expense.category!=='accommodation')plan.stayTracker.selected=sanitizeStaySelection_({});plan.updatedAt=now;plan.updatedBy=actor;state.plans[idx]=plan;resetPlanTripConfirmations_(state,plan);addAudit_(state,actor,at>=0?'updateTripExpense':'addTripExpense',plan.id);saveState_(state);return output_({ok:true,planId:plan.id,expense:expense,sharedJar:state.sharedJar});
    }
    if (action === 'deleteTripExpense') {
      const planId=cleanText_(payload.planId,80),expenseId=cleanText_(payload.expenseId,80),idx=state.plans.findIndex(x=>x.id===planId);if(idx<0)throw new Error('Budget plan not found');const plan=sanitizePlan_(state.plans[idx]),linkedTrip=plan.linkedTripId?state.trips.find(x=>x.id===plan.linkedTripId):null;if(linkedTrip&&isTripLocked_(linkedTrip))throw new Error('Confirmed trip expenses cannot be deleted');const at=plan.expenseEntries.findIndex(x=>x.id===expenseId);if(at<0)throw new Error('Expense not found');plan.expenseEntries.splice(at,1);if(plan.stayTracker&&plan.stayTracker.selected&&plan.stayTracker.selected.expenseId===expenseId)plan.stayTracker.selected=sanitizeStaySelection_({});state.sharedJar=sanitizeSharedJar_(state.sharedJar);state.sharedJar.transactions=state.sharedJar.transactions.filter(x=>!(x.planId===planId&&x.expenseId===expenseId));state.sharedJar=sanitizeSharedJar_(state.sharedJar);plan.updatedAt=new Date().toISOString();plan.updatedBy=actor;state.plans[idx]=plan;resetPlanTripConfirmations_(state,plan);addAudit_(state,actor,'deleteTripExpense',plan.id);saveState_(state);return output_({ok:true,planId:plan.id,sharedJar:state.sharedJar});
    }

    if (action === 'saveTripRepayment') {
      const planId = cleanText_(payload.planId, 80);
      const planIdx = state.plans.findIndex(function(x){ return x.id === planId; });
      if (planIdx < 0) throw new Error('Budget plan not found');
      const plan = sanitizePlan_(state.plans[planIdx]);
      const linkedTrip = plan.linkedTripId ? state.trips.find(function(t){ return t.id === plan.linkedTripId; }) : null;
      if (linkedTrip && isTripLocked_(linkedTrip)) throw new Error('This trip is already confirmed by both of you');

      const settlement = tripSettlement_(plan);
      if (!settlement.debtor || settlement.debtor !== actor || settlement.amount <= .005) throw new Error('You do not owe anything on this trip right now');

      const amount = cleanMoney_(payload.amount);
      if (amount === '' || Number(amount) <= 0) throw new Error('Enter how much you paid back');
      if (Number(amount) > settlement.amount + .005) throw new Error('You only owe ' + formatMoney_(settlement.amount));

      const category = sanitizeTripRepayment_({category:payload.category}, actor).category;
      if (!category) throw new Error('Choose what this repayment is for');
      const categoryOwed = Number(tripCategoryOwedBreakdown_(plan, actor)[category] || 0);
      if (categoryOwed <= .005) {
        throw new Error('You do not owe anything for ' + tripRepaymentCategoryLabel_(category) + ' right now');
      }
      if (Number(amount) > categoryOwed + .005) {
        throw new Error('You only owe ' + formatMoney_(categoryOwed) + ' for ' + tripRepaymentCategoryLabel_(category));
      }

      const now = new Date().toISOString();
      const repayment = sanitizeTripRepayment_({
        id: Utilities.getUuid(),
        from: actor,
        to: settlement.creditor,
        amount: amount,
        date: payload.date || now.slice(0,10),
        category: category,
        note: payload.note,
        createdAt: now
      }, actor);
      plan.repayments.push(repayment);
      plan.updatedAt = now;
      plan.updatedBy = actor;
      state.plans[planIdx] = plan;
      resetPlanTripConfirmations_(state, plan);

      const nextSettlement = tripSettlement_(plan);
      addAudit_(state, actor, 'saveTripRepayment', plan.id);
      saveState_(state);
      return output_({ok:true,planId:plan.id,repayment:repayment,settlement:nextSettlement});
    }

    if (action === 'deleteCurrentTrip') {
      const kind = String(payload.kind || '');
      const id = cleanText_(payload.id, 80);
      if (!id || (kind !== 'plan' && kind !== 'trip')) throw new Error('Trip not found');

      let linkedTripId = '';
      if (kind === 'plan') {
        const planIdx = state.plans.findIndex(function(x){ return x.id === id; });
        if (planIdx < 0) throw new Error('Trip not found');
        const plan = sanitizePlan_(state.plans[planIdx]);
        linkedTripId = cleanText_(plan.linkedTripId, 80);
        const linkedIdx = linkedTripId ? state.trips.findIndex(function(t){ return t.id === linkedTripId; }) : -1;
        if (linkedIdx >= 0 && isTripLocked_(state.trips[linkedIdx])) throw new Error('Confirmed trips cannot be deleted');
        state.plans.splice(planIdx, 1);
        if (linkedIdx >= 0) state.trips.splice(linkedIdx, 1);

        state.sharedJar = sanitizeSharedJar_(state.sharedJar);
        state.sharedJar.transactions = state.sharedJar.transactions.filter(function(x){ return x.planId !== id; });
        state.sharedJar = sanitizeSharedJar_(state.sharedJar);
      } else {
        const tripIdx = state.trips.findIndex(function(t){ return t.id === id; });
        if (tripIdx < 0) throw new Error('Trip not found');
        const trip = sanitizeTripRecord_(state.trips[tripIdx]);
        if (isTripLocked_(trip)) throw new Error('Confirmed trips cannot be deleted');
        if (state.plans.some(function(p){ return p.linkedTripId === id; })) throw new Error('This trip is linked to a plan and must be deleted from that trip card');
        state.trips.splice(tripIdx, 1);
      }

      state.game = sanitizeGame_(state.game);
      ACTORS.forEach(function(name){
        const profile = state.game[name];
        [id, linkedTripId].filter(Boolean).forEach(function(key){
          if (profile.packing) delete profile.packing[key];
          if (profile.planners) delete profile.planners[key];
        });
        state.game[name] = sanitizeGameProfile_(profile);
      });

      addAudit_(state, actor, 'deleteCurrentTrip', id);
      saveState_(state);
      return output_({ok:true,kind:kind,id:id,deletedTripId:linkedTripId,sharedJar:sanitizeSharedJar_(state.sharedJar)});
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

    if (action === 'confirmPlanTrip') {
      const planId = cleanText_(payload.planId, 80);
      const planIdx = state.plans.findIndex(function(x){ return x.id === planId; });
      if (planIdx < 0) throw new Error('Budget plan not found');
      const rawPlan = state.plans[planIdx];
      const paymentMismatches = planPaymentMismatchDetails_(rawPlan);
      if (paymentMismatches.length) {
        throw new Error('Fix payment assignment before confirming: ' + paymentMismatches.map(function(item){ return item.name + ' (' + formatMoney_(item.amount) + ' unassigned)'; }).join(', ') + '.');
      }
      const plan = sanitizePlan_(rawPlan);
      const today = new Date().toISOString().slice(0,10);
      if (!plan.meta.end || plan.meta.end >= today) throw new Error('This trip can be confirmed after it has ended');
      const outstandingSettlement = tripSettlement_(plan);
      if (outstandingSettlement.amount > .005) throw new Error('Pay back all owed money before confirming this trip.');

      let tripIdx = plan.linkedTripId ? state.trips.findIndex(function(t){ return t.id === plan.linkedTripId; }) : -1;
      let trip = tripIdx >= 0 ? sanitizeTripRecord_(state.trips[tripIdx]) : sanitizeTripRecord_({
        id: Utilities.getUuid(),
        budget: '',
        submissions: {Principessa:null, Principe:null},
        sharedExpenses: {},
        confirmed: {Principessa:false, Principe:false},
        createdAt: new Date().toISOString(),
        createdBy: actor,
        updatedAt: '',
        updatedBy: actor
      });
      if (isTripLocked_(trip)) return output_({ok:true,tripId:trip.id,confirmed:trip.confirmed,locked:true});

      const now = new Date().toISOString();
      const hasCurrentEntries = (Array.isArray(plan.expenseEntries) && plan.expenseEntries.length > 0) || (Array.isArray(plan.repayments) && plan.repayments.length > 0);
      if (!hasCurrentEntries && trip.submissions.Principessa && trip.submissions.Principe) {
        if (!sharedExpensesResolved_(trip.sharedExpenses)) throw new Error('Accommodation or Flights / Train still has an unknown total. Add the total before confirming the trip.');
        if (!submissionsMatch_(trip.submissions.Principessa, trip.submissions.Principe)) throw new Error('Your versions still differ. Edit them until they match first.');
        const warnings = reconciliationWarnings_(trip);
        if (warnings.length) throw new Error(warnings.join(' '));
      } else {
        trip.submissions.Principessa = planTripSnapshotSubmission_(plan, 'Principessa', now);
        trip.submissions.Principe = planTripSnapshotSubmission_(plan, 'Principe', now);
        const a = trip.submissions.Principessa, b = trip.submissions.Principe;
        const expenseTotal = MONEY_FIELDS.reduce(function(sum,key){ return sum + Number(a && a[key] || 0); }, 0);
        const accountedTotal = Number(a && a.paid || 0) + Number(b && b.paid || 0);
        const paymentDifference = money2_(Math.abs(expenseTotal - accountedTotal));
        if (paymentDifference > .005) {
          throw new Error('Payment totals do not match trip expenses. ' + formatMoney_(paymentDifference) + ' is still unassigned. Fix it before confirming the trip.');
        }
      }
      trip.sharedExpenses = sanitizeSharedExpenses_(plan.sharedExpenses);
      const pBudget = plan.budgets && plan.budgets.Principessa !== '' ? Number(plan.budgets.Principessa) : 0;
      const qBudget = plan.budgets && plan.budgets.Principe !== '' ? Number(plan.budgets.Principe) : 0;
      trip.budget = cleanMoney_(pBudget + qBudget);
      trip.confirmed[actor] = true;
      trip.updatedAt = now;
      trip.updatedBy = actor;

      if (tripIdx >= 0) state.trips[tripIdx] = trip;
      else { state.trips.push(trip); tripIdx = state.trips.length - 1; }
      plan.linkedTripId = trip.id;
      plan.updatedAt = now;
      plan.updatedBy = actor;
      state.plans[planIdx] = plan;

      let twosDelta = 0;
      state.game = sanitizeGame_(state.game);
      const pstate = state.game[actor];
      const settleKey = 'trip:' + actor + ':' + trip.id;
      const ownBudget = plan.budgets && plan.budgets[actor];
      const actual = trip.submissions[actor] && trip.submissions[actor].paid;
      if (pstate.awards.tripSettlements.indexOf(settleKey) < 0 && ownBudget !== '' && actual !== '' && isFinite(Number(ownBudget)) && isFinite(Number(actual))) {
        twosDelta = Math.round((Number(ownBudget)-Number(actual))*100)/100;
        pstate.twos += twosDelta;
        pstate.awards.tripSettlements.push(settleKey);
      }
      state.game[actor] = sanitizeGameProfile_(pstate);

      addAudit_(state, actor, 'confirmTrip', trip.id);
      saveState_(state);
      return output_({ok:true,tripId:trip.id,confirmed:trip.confirmed,locked:isTripLocked_(trip),twosDelta:twosDelta,game:sanitizeGame_(state.game)});
    }

    if (action === 'confirmTrip') {
      const id = cleanText_(payload.id, 80);
      const idx = state.trips.findIndex(t => t.id === id);
      if (idx < 0) throw new Error('Trip not found');
      const trip = sanitizeTripRecord_(state.trips[idx]);
      const planForTrip = state.plans.map(sanitizePlan_).find(function(p){ return p.linkedTripId === trip.id; });
      if (planForTrip && tripSettlement_(planForTrip).amount > .005) {
        throw new Error('Pay back all owed money before confirming this trip.');
      }
      if (!trip.submissions.Principessa || !trip.submissions.Principe) {
        throw new Error('Both versions must be logged before confirming');
      }
      if (!sharedExpensesResolved_(trip.sharedExpenses)) {
        throw new Error('Accommodation or Flights / Train still has an unknown total. Add the total before confirming the trip.');
      }
      if (!submissionsMatch_(trip.submissions.Principessa, trip.submissions.Principe)) {
        throw new Error('Your versions still differ. Edit them until they match first.');
      }
      const warnings=reconciliationWarnings_(trip, planForTrip);
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

    if (action === 'confirmFutureBill') {
      const billId=cleanText_(payload.billId,80);
      const dueDate=cleanFinanceDate_(payload.dueDate);
      const paidDate=cleanFinanceDate_(payload.paidDate||payload.dueDate);
      if(!billId||!dueDate||!paidDate||paidDate.slice(0,7)!==dueDate.slice(0,7))throw new Error('Choose a valid date in the bill month');
      state.financeProfiles=sanitizeFinanceProfiles_(state.financeProfiles);
      state.finances=sanitizeFinances_(state.finances);
      const profile=sanitizeFinanceProfile_(state.financeProfiles[actor],actor);
      const bill=profile.futureBills.find(function(item){return item.id===billId;});
      if(!bill)throw new Error('Future bill not found');
      if(futureBillOccurrenceDate_(bill,Number(dueDate.slice(0,4)))!==dueDate)throw new Error('The bill is not scheduled for that date');
      const month=dueDate.slice(0,7);
      const list=state.finances[actor]||[];
      const index=list.findIndex(function(item){return item.month===month;});
      const existing=index>=0?sanitizeFinanceMonth_(list[index],actor):null;
      if(existing&&existing.finalized)throw new Error('This month is final and locked');
      const record=existing||sanitizeFinanceMonth_({month:month,partialOnly:true,incomes:[],expenses:[]},actor);
      const duplicate=record.expenses.some(function(item){return item.futureBillId===billId&&item.futureBillDueDate===dueDate;});

      if(duplicate)return output_({ok:true,alreadyPaid:true,monthData:record,financeProfile:profile});
      const amount=payload.amount==null?bill.amount:cleanMoney_(payload.amount);
      if(amount===''||!Number.isFinite(Number(amount))||Number(amount)<=0)throw new Error('Enter a valid bill amount');
      record.expenses.push({id:Utilities.getUuid(),name:bill.name,amount:amount,date:paidDate,group:bill.group,paidFrom:'personal',futureBillId:billId,futureBillDueDate:dueDate});
      const saved=sanitizeFinanceMonth_(record,actor);
      saved.updatedAt=new Date().toISOString();
      saved.updatedBy=actor;
      if(index>=0)list[index]=saved;else list.push(saved);
      list.sort(function(a,b){return a.month.localeCompare(b.month);});
      state.finances[actor]=list;
      profile.updatedAt=saved.updatedAt;
      profile.updatedBy=actor;
      state.financeProfiles[actor]=sanitizeFinanceProfile_(profile,actor);
      addAudit_(state,actor,'confirmFutureBill',billId);
      saveState_(state);
      return output_({ok:true,monthData:saved,financeProfile:state.financeProfiles[actor]});
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
      syncFinanceSharedJarTransactions_(state,actor,monthData,now);
      state.financeProfiles = sanitizeFinanceProfiles_(state.financeProfiles);
      const financeProfile = sanitizeFinanceProfile_(state.financeProfiles[actor] || {}, actor);
      const savingsUsed = function(record) {
        return (record && Array.isArray(record.extraSpends) ? record.extraSpends : []).filter(function(x){ return x.source === 'savings'; }).reduce(function(sum,x){ return sum + Number(x.amount || 0); },0);
      };
      const previousSavingsUsed = savingsUsed(existing);
      const nextSavingsUsed = savingsUsed(monthData);
      const savingsDelta = money2_(nextSavingsUsed - previousSavingsUsed);
      if (Math.abs(savingsDelta) > .005) {
        const currentSavings = financeProfile.savingsTotal === '' ? 0 : Number(financeProfile.savingsTotal || 0);
        if (savingsDelta > currentSavings + .005) throw new Error('Saved up only has ' + formatMoney_(currentSavings) + ' available');
        financeProfile.savingsTotal = money2_(Math.max(0, currentSavings - savingsDelta));
        financeProfile.updatedAt = now;
        financeProfile.updatedBy = actor;
        state.financeProfiles[actor] = financeProfile;
      }
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
          const outflow=(monthData.expenses||[]).filter(financeExpenseCountsAsOutflow_).reduce(function(sum,x){return sum+Number(x.amount||0);},0)+(monthData.extraSpends||[]).filter(financeExtraSpendCountsAsOutflow_).reduce(function(sum,x){return sum+Number(x.amount||0);},0);
          twosDelta=Math.round((income-outflow)*100)/100;
          pstate.twos+=twosDelta;
          pstate.awards.financeSettlements.push(settleKey);
        }
        state.game[actor]=sanitizeGameProfile_(pstate);
      }
      saveState_(state);
      return output_({ok:true,month:monthData.month,monthData:monthData,twosDelta:twosDelta,game:sanitizeGame_(state.game),financeProfile:sanitizeFinanceProfile_(state.financeProfiles[actor] || {}, actor),sharedJar:sanitizeSharedJar_(state.sharedJar)});
    }


    if (action === 'confirmFinanceCreditCard') {
      const month = cleanText_(payload.month, 10);
      const extraSpendId = cleanText_(payload.extraSpendId, 80);
      if (!/^\d{4}-\d{2}$/.test(month) || !extraSpendId) throw new Error('Choose a valid credit card charge');
      state.finances = sanitizeFinances_(state.finances);
      const list = state.finances[actor] || [];
      const idx = list.findIndex(function(x){ return x.month === month; });
      if (idx < 0) throw new Error('Finance month not found');
      const record = sanitizeFinanceMonth_(list[idx], actor);
      if (record.finalized) throw new Error('This month is final and locked');
      const spend = (record.extraSpends || []).find(function(x){ return x.id === extraSpendId; });
      if (!spend || spend.source !== 'creditcard') throw new Error('Credit card charge not found');
      if (spend.status !== 'pending') return output_({ok:true,monthData:record});
      spend.status = 'confirmed';
      spend.pendingCounts = true;
      record.updatedAt = new Date().toISOString();
      record.updatedBy = actor;
      list[idx] = sanitizeFinanceMonth_(record, actor);
      state.finances[actor] = list;
      addAudit_(state, actor, 'confirmFinanceCreditCard', month + ':' + extraSpendId);
      saveState_(state);
      return output_({ok:true,monthData:list[idx]});
    }

    if (action === 'saveFinancePlanning') {
      const month = cleanText_(payload.month, 10);
      if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Choose a valid month');
      state.finances = sanitizeFinances_(state.finances);
      const list = state.finances[actor] || [];
      let idx = list.findIndex(function(x){ return x.month === month; });
      let record = idx >= 0 ? sanitizeFinanceMonth_(list[idx], actor) : sanitizeFinanceMonth_({month:month}, actor);
      if (record.finalized) throw new Error('This month is final and locked');
      const previousPlanning = sanitizeFinancePlanning_(record.planning || {});
      const planning = sanitizeFinancePlanning_(payload.planning || {});
      const nextNames = planning.items.map(function(x){ return String(x.name || '').trim().toLowerCase(); });
      previousPlanning.items.filter(function(x){ return x.custom === true && nextNames.indexOf(String(x.name || '').trim().toLowerCase()) < 0; }).forEach(function(item){
        const removed = String(item.name || '').trim().toLowerCase();
        record.incomes = (record.incomes || []).filter(function(x){ return String(x.name || '').trim().toLowerCase() !== removed; });
        record.expenses = (record.expenses || []).filter(function(x){ return String(x.name || '').trim().toLowerCase() !== removed; });
      });
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
      syncFinanceSharedJarTransactions_(state,actor,record,record.updatedAt);
      if (idx >= 0) list[idx] = record; else list.push(record);
      list.sort(function(a,b){ return String(a.month).localeCompare(String(b.month)); });
      state.finances[actor] = list;
      addAudit_(state, actor, 'saveFinancePlanning', month);
      saveState_(state);
      return output_({ok:true,month:month,planning:record.planning,monthData:record});
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
      if(Number(pstate.twos)<total)throw new Error('You need '+formatNumber_(total-Number(pstate.twos),2)+' more Twos');
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

    if (action === 'shopSendSignal') {
      state.game=sanitizeGame_(state.game);const type=String(payload.type)==='note'?'note':'heart',need=type==='note'?'flying-note':'flying-heart',pstate=state.game[actor];if(pstate.purchases.indexOf(need)<0)throw new Error('Unlock '+(type==='note'?'Flying Note':'Flying Heart')+' first');const to=actor==='Principessa'?'Principe':'Principessa';state.game.signals.push({id:Utilities.getUuid(),from:actor,to:to,type:type,text:type==='note'?cleanText_(payload.text,160):'',createdAt:new Date().toISOString(),seenAt:''});state.game.signals=state.game.signals.slice(-40);saveState_(state);return output_(gameResponse_(state));
    }

    if (action === 'shopMarkSignalsSeen') {
      state.game=sanitizeGame_(state.game);const now=new Date().toISOString();state.game.signals.forEach(function(x){if(x.to===actor&&!x.seenAt)x.seenAt=now;});saveState_(state);return output_(gameResponse_(state));
    }

    return output_({ok:false, error:'Unknown action'});
  } catch (err) {
    return output_({ok:false, error:String(err && err.message || err)});
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
function formatNumber_(value, maximumFractionDigits) {
  const amount = Number(value) || 0;
  const max = maximumFractionDigits == null ? 2 : maximumFractionDigits;
  const whole = Math.abs(amount - Math.round(amount)) < .005;
  return amount.toLocaleString('nl-NL', {
    minimumFractionDigits: whole ? 0 : Math.min(2, max),
    maximumFractionDigits: max
  });
}
function formatMoney_(value) { return '€' + formatNumber_(value, 2); }
function defaultSharedJar_() { return {initialBalance:870,balance:870,transactions:[]}; }
function sanitizeSharedJar_(value) {
  const source=value&&typeof value==='object'?value:{};
  let initialBalance=cleanMoney_(source.initialBalance);
  if(initialBalance==='')initialBalance=870;
  const byKey={};

  (Array.isArray(source.transactions)?source.transactions:[]).slice(-500).forEach(function(raw){
    const x=raw&&typeof raw==='object'?raw:{};
    const amount=cleanMoney_(x.amount);
    if(amount===''||Number(amount)<=0)return;

    if(String(x.source||'')==='finance'){
      const financeActor=cleanActor_(x.actor);
      const month=cleanText_(x.month,10);
      const expenseId=cleanText_(x.expenseId,80);
      if(financeActor==='Unknown'||!/^\d{4}-\d{2}$/.test(month)||!expenseId)return;
      const key='finance::'+financeActor+'::'+month+'::'+expenseId;
      byKey[key]={
        source:'finance',
        planId:'',
        expenseId:expenseId,
        month:month,
        name:cleanText_(x.name,100),
        category:cleanFinanceGroup_(x.category),
        date:cleanFinanceDate_(x.date),
        amount:money2_(amount),
        actor:financeActor,
        at:cleanText_(x.at,40)
      };
      return;
    }

    const planId=cleanText_(x.planId,80);
    const expenseId=cleanText_(x.expenseId,80);
    if(!planId)return;
    const key=expenseId?planId+'::'+expenseId:planId;
    byKey[key]={
      source:'trip',
      planId:planId,
      expenseId:expenseId,
      amount:money2_(amount),
      actor:cleanActor_(x.actor),
      at:cleanText_(x.at,40)
    };
  });

  const transactions=Object.keys(byKey).map(function(k){return byKey[k];});
  const used=transactions.reduce(function(sum,x){return sum+Number(x.amount||0);},0);
  return {
    initialBalance:initialBalance,
    balance:money2_(Math.max(0,Number(initialBalance)-used)),
    transactions:transactions
  };
}
function defaultAccommodationMeta_(){return {useJar:false,jarContribution:0,jarBalanceAfter:870,remaining:'',paymentType:'',paidUpfront:false,upfrontBy:'',shareEach:'',repayment:{debtor:'',creditor:'',amount:'',status:'none',confirmedAt:''}};}
function sanitizeAccommodationMeta_(value){
  const s=value&&typeof value==='object'?value:{},r=s.repayment&&typeof s.repayment==='object'?s.repayment:{};
  const paymentType=String(s.paymentType||''); const status=['none','pending','confirmed'].indexOf(String(r.status||''))>=0?String(r.status):'none';
  const upfrontBy=cleanActor_(s.upfrontBy)==='Unknown'?'':cleanActor_(s.upfrontBy),debtor=cleanActor_(r.debtor)==='Unknown'?'':cleanActor_(r.debtor),creditor=cleanActor_(r.creditor)==='Unknown'?'':cleanActor_(r.creditor);
  return {useJar:s.useJar===true,jarContribution:cleanMoney_(s.jarContribution)===''?0:cleanMoney_(s.jarContribution),jarBalanceAfter:cleanMoney_(s.jarBalanceAfter)===''?870:cleanMoney_(s.jarBalanceAfter),remaining:cleanMoney_(s.remaining),paymentType:paymentType==='solo'||paymentType==='shared'?paymentType:'',paidUpfront:s.paidUpfront===true,upfrontBy:upfrontBy,shareEach:cleanMoney_(s.shareEach),repayment:{debtor:debtor,creditor:creditor,amount:cleanMoney_(r.amount),status:status,confirmedAt:cleanText_(r.confirmedAt,40)}};
}
function prepAddedBy_(value){const who=cleanActor_(value);return ACTORS.includes(who)?who:'';}
function prepNotifyAt_(value){
  const raw=cleanText_(value,40);
  if(!raw)return '';
  const stamp=Date.parse(raw);
  return Number.isFinite(stamp)?new Date(stamp).toISOString():'';
}
function prepCreatedAt_(value){
  const raw=cleanText_(value,40);
  if(!raw)return '';
  const stamp=Date.parse(raw);
  return Number.isFinite(stamp)?new Date(stamp).toISOString():'';
}
function prepPersonalFor_(value){const who=cleanActor_(value);return ACTORS.includes(who)?who:'';}
function prepSection_(value){
  return cleanText_(value,80).toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,80);
}
function defaultPackingSections_(){
  return [
    {id:'clothes',label:'Clothes'},
    {id:'toiletries',label:'Toiletries & care'},
    {id:'electronics',label:'Electronics'},
    {id:'documents',label:'Documents & money'},
    {id:'health',label:'Health'},
    {id:'food',label:'Food & drinks'},
    {id:'other',label:'Other'}
  ];
}
function prepPackingSections_(value){
  const source=Array.isArray(value)?value:defaultPackingSections_();
  const out=[],seen={};
  source.slice(0,20).forEach(function(raw){
    const id=prepSection_(raw&&(raw.id||raw.key));
    const label=cleanText_(raw&&raw.label,48).trim();
    if(!id||!label||seen[id])return;
    seen[id]=true;
    out.push({id:id,label:label});
  });
  if(!seen.other)out.push({id:'other',label:'Other'});
  return out;
}
function normalizePackingItemSections_(item,sections){
  const next=prepItem_(item),valid={};
  prepPackingSections_(sections).forEach(function(section){valid[section.id]=true;});
  if(next.section&&!valid[next.section])next.section='other';
  const personal=prepPersonal_(next.personal);
  ACTORS.forEach(function(name){
    const entry=personal[name];
    if(entry&&entry.section&&!valid[entry.section])entry.section='other';
  });
  next.personal=personal;
  return next;
}
function prepPersonalEntry_(value){
  const s=value&&typeof value==='object'?value:{},out={};
  if(Object.prototype.hasOwnProperty.call(s,'text'))out.text=cleanText_(s.text,160);
  if(Object.prototype.hasOwnProperty.call(s,'done'))out.done=!!s.done;
  if(Object.prototype.hasOwnProperty.call(s,'hidden'))out.hidden=!!s.hidden;
  if(Object.prototype.hasOwnProperty.call(s,'notifyAt'))out.notifyAt=prepNotifyAt_(s.notifyAt);
  if(Object.prototype.hasOwnProperty.call(s,'section'))out.section=prepSection_(s.section);
  if(Number.isFinite(Number(s.order)))out.order=Math.max(0,Math.min(9999,Number(s.order)));
  return out;
}
function prepPersonal_(value){
  const s=value&&typeof value==='object'?value:{},out={};
  ACTORS.forEach(function(name){
    const entry=prepPersonalEntry_(s[name]);
    if(Object.keys(entry).length)out[name]=entry;
  });
  return out;
}
function mergePrepPersonalDefaults_(previousDefault,nextDefault,tripValue){
  const previous=prepPersonal_(previousDefault),next=prepPersonal_(nextDefault),trip=prepPersonal_(tripValue),out={};
  ACTORS.forEach(function(name){
    const prevEntry=previous[name]||{},nextEntry=next[name]||{},tripEntry=trip[name]||{};
    const merged={};
    const keys={};
    Object.keys(prevEntry).forEach(function(key){keys[key]=true;});
    Object.keys(nextEntry).forEach(function(key){keys[key]=true;});
    Object.keys(tripEntry).forEach(function(key){keys[key]=true;});
    Object.keys(keys).forEach(function(key){
      const tripHas=Object.prototype.hasOwnProperty.call(tripEntry,key);
      const prevHas=Object.prototype.hasOwnProperty.call(prevEntry,key);
      const nextHas=Object.prototype.hasOwnProperty.call(nextEntry,key);
      if(tripHas&&(!prevHas||tripEntry[key]!==prevEntry[key]))merged[key]=tripEntry[key];
      else if(nextHas)merged[key]=nextEntry[key];
      else if(tripHas&&!prevHas)merged[key]=tripEntry[key];
    });
    if(Object.keys(merged).length)out[name]=merged;
  });
  return out;
}
function prepItem_(x){return {id:cleanText_(x&&x.id,80)||Utilities.getUuid(),recurrentId:cleanText_(x&&x.recurrentId,80),text:cleanText_(x&&x.text,160),done:!!(x&&x.done),section:prepSection_(x&&x.section),addedBy:prepAddedBy_(x&&x.addedBy),personalFor:prepPersonalFor_(x&&x.personalFor),notifyAt:prepNotifyAt_(x&&x.notifyAt),personal:prepPersonal_(x&&x.personal)};}
function prepNote_(x){return {id:cleanText_(x&&x.id,80)||Utilities.getUuid(),text:cleanText_(x&&x.text,160),addedBy:prepAddedBy_(x&&x.addedBy),personalFor:prepPersonalFor_(x&&x.personalFor),personal:prepPersonal_(x&&x.personal),createdAt:prepCreatedAt_(x&&x.createdAt)};}
function defaultTripPrep_(){return {packing:[],reminders:[],updatedAt:'',updatedBy:'Unknown'};}
function defaultTripPrepDefaults_(){
  return {
    packingSections:defaultPackingSections_(),
    packing:[
      {id:'default-packing-1',text:'Toothbrushes',done:false},
      {id:'default-packing-2',text:'Slippers',done:false},
      {id:'default-packing-3',text:'Hair brush',done:false},
      {id:'default-packing-4',text:'Shampoo',done:false},
      {id:'default-packing-5',text:'Conditioner',done:false},
      {id:'default-packing-6',text:'Shower gel',done:false},
      {id:'default-packing-7',text:'Dishwasher detergent',done:false}
    ],
    reminders:[
      {id:'default-reminder-1',text:"Don't forget to put fuel",done:false},
      {id:'default-reminder-2',text:"Don't forget to ask mom to make work sandwich",done:false},
      {id:'default-reminder-3',text:"Don't forget to take pictures of the Airbnb when you arrive",done:false}
    ],
    notes:[],
    updatedAt:'',
    updatedBy:'Unknown'
  };
}
function sanitizeTripPrep_(value){const s=value&&typeof value==='object'?value:{};return {packing:(Array.isArray(s.packing)?s.packing:[]).slice(0,120).map(prepItem_).filter(function(x){return !!x.text;}),reminders:(Array.isArray(s.reminders)?s.reminders:[]).slice(0,120).map(prepItem_).filter(function(x){return !!x.text;}),updatedAt:cleanText_(s.updatedAt,40),updatedBy:cleanActor_(s.updatedBy)};}
function sanitizeTripPrepDefaults_(value){
  if(!value||typeof value!=='object')return defaultTripPrepDefaults_();
  const out=sanitizeTripPrep_(value);
  out.packingSections=prepPackingSections_(value.packingSections);
  out.packing=out.packing.map(function(item){
    const normalized=normalizePackingItemSections_(item,out.packingSections);
    return {id:normalized.id,text:normalized.text,done:false,section:normalized.section,addedBy:normalized.addedBy,personalFor:normalized.personalFor,personal:normalized.personal};
  });
  out.reminders=out.reminders.map(function(item){return {id:item.id,text:item.text,done:false,addedBy:item.addedBy,personalFor:item.personalFor,personal:prepPersonal_(item.personal)};});
  out.notes=(Array.isArray(value.notes)?value.notes:[]).slice(0,120).map(prepNote_).filter(function(item){return !!item.text;});
  return out;
}
function tripPrepForNewPlan_(value,actor,now){
  const source=sanitizeTripPrepDefaults_(value);
  return {
    packing:source.packing.map(function(item){return {id:Utilities.getUuid(),recurrentId:item.id,text:item.text,done:false,section:item.section,addedBy:item.addedBy,personalFor:item.personalFor,personal:prepPersonal_(item.personal)};}),
    reminders:source.reminders.map(function(item){return {id:Utilities.getUuid(),recurrentId:item.id,text:item.text,done:false,addedBy:item.addedBy,personalFor:item.personalFor,personal:prepPersonal_(item.personal)};}),
    updatedAt:now||new Date().toISOString(),
    updatedBy:actor
  };
}

function normalizedPrepText_(value){return cleanText_(value,160).trim().toLowerCase();}
function promoteNewTripPrepItemsToDefaults_(previousPrep,nextPrep,defaults,actor){
  const previous=sanitizeTripPrep_(previousPrep);
  const next=sanitizeTripPrep_(nextPrep);
  const nextDefaults=sanitizeTripPrepDefaults_(defaults);
  let changed=false;

  ['packing','reminders'].forEach(function(kind){
    const previousIds={};
    previous[kind].forEach(function(item){if(item&&item.id)previousIds[item.id]=true;});

    const defaultByText={};
    nextDefaults[kind].forEach(function(item){
      const key=prepPersonalFor_(item&&item.personalFor)+'|'+normalizedPrepText_(item&&item.text);
      if(key&&!defaultByText[key])defaultByText[key]=item;
    });

    const linkedDefaultIds={};
    next[kind].forEach(function(item){
      const recurrentId=cleanText_(item&&item.recurrentId,80);
      if(recurrentId)linkedDefaultIds[recurrentId]=true;
    });

    next[kind].forEach(function(item){
      if(!item||previousIds[item.id])return;
      if(prepAddedBy_(item.addedBy)!==actor)return;
      const personalFor=prepPersonalFor_(item.personalFor);
      if(personalFor&&personalFor!==actor)return;
      if(cleanText_(item.recurrentId,80))return;
      const textKey=normalizedPrepText_(item.text);
      if(!textKey)return;
      const key=personalFor+'|'+textKey;

      const existingDefault=defaultByText[key];
      if(existingDefault){
        if(!linkedDefaultIds[existingDefault.id]){
          item.recurrentId=existingDefault.id;
          linkedDefaultIds[existingDefault.id]=true;
        }
        return;
      }

      const recurrent={
        id:Utilities.getUuid(),
        text:item.text,
        done:false,
        section:item.section,
        addedBy:actor,
        personalFor:personalFor,
        personal:prepPersonal_(item.personal)
      };
      nextDefaults[kind].push(recurrent);
      defaultByText[key]=recurrent;
      linkedDefaultIds[recurrent.id]=true;
      item.recurrentId=recurrent.id;
      changed=true;
    });
  });

  return {prep:next,defaults:nextDefaults,changed:changed};
}
function mergeRecurrentPrepKind_(existingItems,previousDefaults,nextDefaults){
  const existing=Array.isArray(existingItems)?existingItems.map(prepItem_):[];
  const previous=Array.isArray(previousDefaults)?previousDefaults.map(prepItem_):[];
  const next=Array.isArray(nextDefaults)?nextDefaults.map(prepItem_):[];
  const previousById={};
  const nextById={};
  previous.forEach(function(item){if(item&&item.id)previousById[item.id]=item;});
  next.forEach(function(item){if(item&&item.id)nextById[item.id]=item;});
  const matchedByDefaultId={};
  const custom=[];
  const usedPrevious={};

  existing.forEach(function(item){
    let recurrentId=cleanText_(item.recurrentId,80);
    if(recurrentId && (previousById[recurrentId] || nextById[recurrentId])){
      matchedByDefaultId[recurrentId]=item;
      if(previousById[recurrentId])usedPrevious[recurrentId]=true;
      return;
    }
    const text=normalizedPrepText_(item.text);
    const personalFor=prepPersonalFor_(item.personalFor);
    const legacy=previous.find(function(candidate){
      return candidate && candidate.id && !usedPrevious[candidate.id] &&
        prepPersonalFor_(candidate.personalFor)===personalFor && normalizedPrepText_(candidate.text)===text;
    });
    if(legacy){
      item.recurrentId=legacy.id;
      matchedByDefaultId[legacy.id]=item;
      usedPrevious[legacy.id]=true;
      return;
    }
    custom.push(item);
  });

  const recurrent=[];
  next.forEach(function(item){
    const prior=matchedByDefaultId[item.id];
    if(prior){
      const previousDefault=previousById[item.id]||{};
      recurrent.push({
        id:prior.id,recurrentId:item.id,text:item.text,done:!!prior.done,section:prior.section||item.section,addedBy:item.addedBy,
        personalFor:item.personalFor,notifyAt:prior.notifyAt||'',
        personal:mergePrepPersonalDefaults_(previousDefault.personal,item.personal,prior.personal)
      });
      return;
    }
    // A recurrent item that already existed but is absent from this trip was removed from this trip on purpose.
    if(previousById[item.id])return;
    recurrent.push({
      id:Utilities.getUuid(),recurrentId:item.id,text:item.text,done:false,section:item.section,addedBy:item.addedBy,
      personalFor:item.personalFor,personal:prepPersonal_(item.personal)
    });
  });
  return recurrent.concat(custom);
}
function syncRecurrentPrepIntoUpcomingPlans_(state,previousDefaults,nextDefaults,actor,now){
  const today=new Date().toISOString().slice(0,10);
  let updated=0;
  state.plans=(Array.isArray(state.plans)?state.plans:[]).map(function(rawPlan){
    const plan=sanitizePlan_(rawPlan);
    const start=cleanText_(plan.meta&&plan.meta.start,20);
    if(!start || start<today)return plan;
    const linked=plan.linkedTripId?state.trips.find(function(item){return item.id===plan.linkedTripId;}):null;
    if(linked&&isTripLocked_(linked))return plan;
    plan.prep.packing=mergeRecurrentPrepKind_(plan.prep.packing,previousDefaults.packing,nextDefaults.packing)
      .map(function(item){return normalizePackingItemSections_(item,nextDefaults.packingSections);});
    plan.prep.reminders=mergeRecurrentPrepKind_(plan.prep.reminders,previousDefaults.reminders,nextDefaults.reminders);
    plan.prep.updatedAt=now;
    plan.prep.updatedBy=actor;
    plan.updatedAt=now;
    plan.updatedBy=actor;
    updated+=1;
    return plan;
  });
  return updated;
}

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

function resetPlanTripConfirmations_(state, plan) {
  if (!plan || !plan.linkedTripId) return;
  const idx = state.trips.findIndex(function(t){ return t.id === plan.linkedTripId; });
  if (idx < 0) return;
  const trip = sanitizeTripRecord_(state.trips[idx]);
  if (isTripLocked_(trip)) return;
  if (!trip.confirmed.Principessa && !trip.confirmed.Principe) return;
  trip.confirmed = {Principessa:false, Principe:false};
  trip.updatedAt = new Date().toISOString();
  trip.updatedBy = plan.updatedBy;
  state.trips[idx] = trip;
}

function planTripSnapshotSubmission_(plan, name, now) {
  const meta = sanitizePlanMeta_(plan && plan.meta || {});
  const out = {
    location:meta.location, otherLocation:meta.otherLocation, city:meta.city,
    start:meta.start, end:meta.end,
    accom:0, groceries:0, eat:0, travel:0, fuel:0, tolls:0, other:0,
    otherNote:'', paid:0, uncertain:{}, submittedAt:now, submittedBy:name
  };
  const notes = [];
  (Array.isArray(plan && plan.expenseEntries) ? plan.expenseEntries : []).forEach(function(raw){
    const entry = sanitizeTripExpense_(raw, raw && raw.loggedBy);
    const amount = Number(entry.amount || 0);
    if (!amount) return;
    const jarContribution = Math.min(amount, Math.max(0, Number(entry.jarContribution || 0)));
    const spentAmount = Math.max(0, amount - jarContribution);
    let key = 'other';
    if (entry.category === 'accommodation') key = 'accom';
    else if (entry.category === 'food') key = entry.foodType === 'groceries' ? 'groceries' : 'eat';
    else if (entry.category === 'transport') {
      if (entry.transportType === 'fuel') key = 'fuel';
      else if (entry.transportType === 'tolls' || entry.transportType === 'parking-tolls') key = 'tolls';
      else key = 'travel';
    }
    out[key] = money2_(Number(out[key] || 0) + spentAmount);
    if (entry.uncertain) out.uncertain[key] = true;
    if (key === 'other') {
      const note = cleanText_(entry.note || entry.name || (entry.category === 'activities' ? 'Activities' : ''), 80);
      if (note && notes.indexOf(note) < 0) notes.push(note);
    }
    const remaining = spentAmount;
    if (entry.paidBy === 'both') out.paid += remaining / 2;
    else if (entry.paidBy === name) out.paid += remaining;
  });
  (Array.isArray(plan && plan.repayments) ? plan.repayments : []).forEach(function(raw){
    const repayment = sanitizeTripRepayment_(raw, raw && raw.from);
    const amount = Number(repayment.amount || 0);
    if (repayment.from === name) out.paid += amount;
    if (repayment.to === name) out.paid -= amount;
  });
  out.paid = money2_(Math.max(0, out.paid));
  out.otherNote = cleanText_(notes.join(' · '), 200);
  return sanitizeSubmission_(out, name);
}

function cleanFinanceDate_(value) {
  const text = cleanText_(value, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return '';
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? text : '';
}

function cleanRecurringDay_(value) {
  if (value === '' || value == null) return '';
  const day = Number(value);
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : '';
}

function sanitizeFinanceIncome_(item) {
  return {name:cleanText_(item && item.name, 100), amount:cleanMoney_(item && item.amount), date:cleanFinanceDate_(item && item.date)};
}

function cleanFinanceGroup_(value) {
  const allowed = ['fixed','medical','subscriptions','rent','transport','groceries','variable','extra','savings','investments','other'];
  let group = String(value || 'other').toLowerCase();
  if (group === 'health') group = 'medical';
  if (group === 'living') group = 'rent';
  if (group === 'transport') group = 'subscriptions';
  if (allowed.indexOf(group) >= 0) return group;
  if (/^custom-[a-z0-9-]{1,64}$/.test(group)) return group;
  return 'other';
}

function sanitizeFinanceExpense_(item) {
  const paidFrom=String(item&&item.paidFrom||'')==='sharedJar'?'sharedJar':'personal';
  return {
    id:cleanText_(item&&item.id,80)||(paidFrom==='sharedJar'?Utilities.getUuid():''),
    group:cleanFinanceGroup_(item && item.group),
    name:cleanText_(item && item.name, 100),
    amount:cleanMoney_(item && item.amount),
    date:cleanFinanceDate_(item && item.date),
    paidFrom:paidFrom,
    futureBillId:cleanText_(item&&item.futureBillId,80),
    futureBillDueDate:cleanFinanceDate_(item&&item.futureBillDueDate)
  };
}

function sanitizeFinanceReserved_(item) {
  return {name:cleanText_(item && item.name, 100), amount:cleanMoney_(item && item.amount)};
}

function sanitizeFinanceExtraSpend_(item) {
  const sourceRaw = String(item && item.source || '');
  const source = sourceRaw === 'creditcard' || sourceRaw === 'savings' || sourceRaw === 'main' ? sourceRaw : '';
  const rawStatus = String(item && item.status || '');
  return {
    id: cleanText_(item && item.id, 80) || Utilities.getUuid(),
    source: source,
    amount: cleanMoney_(item && item.amount),
    date: cleanFinanceDate_(item && item.date),
    status: source === 'creditcard' ? (rawStatus === 'pending' ? 'pending' : 'confirmed') : 'confirmed',
    pendingCounts: source === 'creditcard' && item && item.pendingCounts === true
  };
}
function financeExpenseCountsAsOutflow_(item) {
  return !(item&&item.paidFrom==='sharedJar');
}
function financeExtraSpendCountsAsOutflow_(item) {
  if (!item || item.source !== 'creditcard') return true;
  if (item.status !== 'pending') return true;
  return item.pendingCounts === true;
}

function syncFinanceSharedJarTransactions_(state,actor,monthData,now) {
  state.sharedJar=sanitizeSharedJar_(state.sharedJar);
  const month=cleanText_(monthData&&monthData.month,10);
  const previousByExpenseId={};
  state.sharedJar.transactions.forEach(function(tx){
    if(tx.source==='finance'&&tx.actor===actor&&tx.month===month&&tx.expenseId){
      previousByExpenseId[tx.expenseId]=tx;
    }
  });

  const retained=state.sharedJar.transactions.filter(function(tx){
    return !(tx.source==='finance'&&tx.actor===actor&&tx.month===month);
  });
  const next=(monthData.expenses||[]).filter(function(item){
    return item&&item.paidFrom==='sharedJar'&&item.id&&Number(item.amount||0)>0;
  }).map(function(item){
    const previous=previousByExpenseId[item.id];
    return {
      source:'finance',
      expenseId:item.id,
      month:month,
      name:item.name,
      category:item.group,
      date:item.date,
      amount:money2_(item.amount),
      actor:actor,
      at:previous&&previous.at?previous.at:now
    };
  });

  const retainedUsed=retained.reduce(function(sum,tx){return sum+Number(tx.amount||0);},0);
  const nextUsed=next.reduce(function(sum,tx){return sum+Number(tx.amount||0);},0);
  const available=money2_(Math.max(0,Number(state.sharedJar.initialBalance||0)-retainedUsed));
  if(nextUsed>available+.005)throw new Error('The Shared Jar only has '+formatMoney_(available)+' available');

  state.sharedJar=sanitizeSharedJar_({
    initialBalance:state.sharedJar.initialBalance,
    transactions:retained.concat(next)
  });
}


function sanitizeFinancePlanningItem_(item){
  const s=item&&typeof item==='object'?item:{},frequency=['one-time','monthly','yearly'].indexOf(String(s.frequency||''))>=0?String(s.frequency):'one-time',paymentTiming=['upfront','later'].indexOf(String(s.paymentTiming||''))>=0?String(s.paymentTiming):'';
  const kind=String(s.kind||'')==='income'?'income':'expense';
  const group=cleanFinanceGroup_(s.group);
  const planner=cleanMoney_(s.planner),actual=cleanMoney_(s.actual); let reserveMonthly='';
  if(frequency==='yearly'&&paymentTiming==='later'&&planner!=='')reserveMonthly=money2_(Number(planner)/12);
  return {id:cleanText_(s.id,80)||Utilities.getUuid(),name:cleanText_(s.name,120),kind:kind,group:group,planner:planner,actual:actual,frequency:frequency,paymentTiming:paymentTiming,reserveMonthly:reserveMonthly,notes:cleanText_(s.notes,240),custom:s.custom===true};
}
function sanitizeFinancePlanning_(value){const s=value&&typeof value==='object'?value:{};return {items:(Array.isArray(s.items)?s.items:[]).slice(0,120).map(sanitizeFinancePlanningItem_).filter(function(x){return !!x.name;}),openingSavings:cleanMoney_(s.openingSavings),updatedAt:cleanText_(s.updatedAt,40)};}

function sanitizeFinanceMonth_(record, actor) {
  const month = cleanText_(record && record.month, 10);
  const incomes = Array.isArray(record && record.incomes) ? record.incomes.slice(0,40).map(sanitizeFinanceIncome_).filter(x => x.name && x.amount !== '') : [];
  let expenses = Array.isArray(record && record.expenses) ? record.expenses.slice(0,100).map(sanitizeFinanceExpense_).filter(x => x.name && x.amount !== '') : [];
  if (/^\d{4}-\d{2}$/.test(month)) {
    incomes.forEach(function(x){ if (x.date && x.date.slice(0,7) !== month) x.date = ''; });
    expenses.forEach(function(x){ if (x.date && x.date.slice(0,7) !== month) x.date = ''; });
  }
  const usesExtraBudget = actor !== 'Principe';
  const rawBudget = cleanMoney_(record && record.extraBudget);
  const extraBudget = usesExtraBudget ? (rawBudget === '' ? 250 : rawBudget) : '';
  let foundFixedExtra = false;
  expenses = expenses.filter(function(x){
    if (x.group === 'extra' && String(x.name || '').trim().toLowerCase() === 'extra') {
      if (!usesExtraBudget) return false;
      if (foundFixedExtra) return false;
      foundFixedExtra = true;
      x.amount = extraBudget;
      x.date = '';
      x.paidFrom = 'personal';
    }
    return true;
  });
  const partialOnly = !!(record && record.partialOnly === true);
  if (usesExtraBudget && !partialOnly && !foundFixedExtra) expenses.push({id:'',group:'extra',name:'Extra',amount:extraBudget,date:'',paidFrom:'personal'});
  if (partialOnly) expenses = expenses.filter(function(x){ return !(x.group === 'extra' && String(x.name || '').trim().toLowerCase() === 'extra'); });

  const allowedExtraSources = actor === 'Principe' ? ['savings','main'] : ['creditcard','savings','main'];
  const hasExplicitExtraSpends = Array.isArray(record && record.extraSpends);
  let extraSpends = hasExplicitExtraSpends ? record.extraSpends.slice(0,60).map(sanitizeFinanceExtraSpend_).filter(function(x){ return allowedExtraSources.indexOf(x.source) >= 0 && x.amount !== '' && Number(x.amount) > 0; }) : [];
  if (/^\d{4}-\d{2}$/.test(month)) {
    extraSpends.forEach(function(x){ if (x.date && x.date.slice(0,7) !== month) x.date = ''; });
  }
  if (!hasExplicitExtraSpends && !extraSpends.length) {
    const legacySourceRaw = String(record && record.extraOverspendSource || '');
    const legacySource = allowedExtraSources.indexOf(legacySourceRaw) >= 0 ? legacySourceRaw : '';
    const legacyAmount = cleanMoney_(record && record.extraOverspendAmount);
    if (legacySource && legacyAmount !== '' && Number(legacyAmount) > 0) extraSpends.push({id:Utilities.getUuid(),source:legacySource,amount:legacyAmount,date:'',status:'confirmed',pendingCounts:false});
  }
  const legacyTotal = extraSpends.reduce(function(sum,x){ return sum + Number(x.amount || 0); },0);
  return {
    month: month,
    incomes: incomes,
    expenses: expenses,
    extraBudget: extraBudget,
    extraSpends: extraSpends,
    extraOverspendSource: extraSpends.length ? extraSpends[0].source : '',
    extraOverspendAmount: legacyTotal,
    investmentTotal: cleanMoney_(record && record.investmentTotal),
    sisterInvestments: cleanMoney_(record && record.sisterInvestments),
    planning: sanitizeFinancePlanning_(record && record.planning),
    partialOnly: !!(record && record.partialOnly === true),
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
    date: cleanFinanceDate_(item && item.date),
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

function sanitizeRecurringIncome_(item) {
  return {
    id: cleanText_(item && item.id, 80) || Utilities.getUuid(),
    name: cleanText_(item && item.name, 100),
    amount: cleanMoney_(item && item.amount),
    day: cleanRecurringDay_(item && item.day)
  };
}

function sanitizeRecurringExpense_(item) {
  return {
    id: cleanText_(item && item.id, 80) || Utilities.getUuid(),
    group: cleanFinanceGroup_(item && item.group),
    name: cleanText_(item && item.name, 100),
    amount: cleanMoney_(item && item.amount),
    day: cleanRecurringDay_(item && item.day)
  };
}

function sanitizeFinanceRecurring_(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    custom: source.custom === true,
    incomes: Array.isArray(source.incomes) ? source.incomes.slice(0,40).map(sanitizeRecurringIncome_).filter(function(x){ return x.name && x.amount !== ''; }) : [],
    expenses: Array.isArray(source.expenses) ? source.expenses.slice(0,100).map(sanitizeRecurringExpense_).filter(function(x){ return x.name && x.amount !== ''; }) : []
  };
}

function sanitizeFinanceReminder_(item) {
  const source=item&&typeof item==='object'?item:{};
  const rawKind=String(source.kind||'');
  const kind=rawKind==='income'?'income':rawKind==='investment-snapshot'?'investment-snapshot':'expense';
  return {
    id: cleanText_(source.id,180) || Utilities.getUuid(),
    kind: kind,
    name: cleanText_(source.name,120),
    group: kind==='expense'||kind==='investment-snapshot' ? cleanText_(source.group,40) : '',
    amount: cleanMoney_(source.amount),
    month: cleanText_(source.month,10),
    date: cleanFinanceDate_(source.date),
    createdAt: cleanText_(source.createdAt,40)
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

function cleanFinanceCategoryColor_(value, fallback) {
  const text=String(value || '');
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : fallback;
}

function sanitizeFinanceCustomCategory_(item) {
  const source=item&&typeof item==='object'?item:{};
  const key=cleanText_(source.key,72).toLowerCase();
  if(!/^custom-[a-z0-9-]{1,64}$/.test(key))return null;
  const label=cleanText_(source.label,50);
  if(!label)return null;
  return {
    key:key,
    label:label,
    background:cleanFinanceCategoryColor_(source.background,'#eee8f7'),
    border:cleanFinanceCategoryColor_(source.border,'#d8cbea'),
    accent:cleanFinanceCategoryColor_(source.accent,'#78649a')
  };
}

function sanitizeFutureBill_(item) {
  const s=item&&typeof item==='object'?item:{};
  const amount=cleanMoney_(s.amount);
  const date=cleanFinanceDate_(s.date);
  return {
    id:cleanText_(s.id,80)||Utilities.getUuid(),
    name:cleanText_(s.name,100),
    amount:amount,
    date:date,
    group:cleanFinanceGroup_(s.group),
    repeat:s.repeat==='yearly'?'yearly':'none'
  };
}

function futureBillOccurrenceDate_(bill,year) {
  const initial=cleanFinanceDate_(bill.date);
  if(!initial||!Number.isInteger(year))return '';
  const firstYear=Number(initial.slice(0,4));
  if(year<firstYear||(bill.repeat!=='yearly'&&year!==firstYear))return '';
  const month=Number(initial.slice(5,7)),day=Number(initial.slice(8,10));
  const lastDay=new Date(Date.UTC(year,month,0)).getUTCDate();
  return year+'-'+initial.slice(5,7)+'-'+String(Math.min(day,lastDay)).padStart(2,'0');
}

function sanitizeFinanceProfile_(profile, actor) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const cleanupDone=source.customCategoryCleanupV1===true;
  let customCategories=Array.isArray(source.customCategories) ? source.customCategories.slice(0,30).map(sanitizeFinanceCustomCategory_).filter(Boolean) : [];
  let recurring=sanitizeFinanceRecurring_(source.recurring);
  if(!cleanupDone){
    const removeLabels=new Set(['pets','test']);
    const removedKeys=new Set();
    customCategories=customCategories.filter(function(category){
      if(removeLabels.has(String(category.label||'').trim().toLowerCase())){
        removedKeys.add(category.key);
        return false;
      }
      return true;
    });
    if(removedKeys.size){
      recurring.expenses=recurring.expenses.map(function(item){
        if(removedKeys.has(item.group)) item.group='other';
        return item;
      });
    }
  }
  return {
    bankAccounts: Array.isArray(source.bankAccounts) ? source.bankAccounts.slice(0,30).map(sanitizeFinanceBank_).filter(x => x.name && x.balance !== '') : [],
    savingsTotal: cleanMoney_(source.savingsTotal),
    savingsReserved: Array.isArray(source.savingsReserved) ? source.savingsReserved.slice(0,40).map(sanitizeFinanceHold_).filter(x => x.name && x.amount !== '') : [],
    receivables: Array.isArray(source.receivables) ? source.receivables.slice(0,60).map(sanitizeFinanceReceivable_).filter(x => x.person && x.reason && x.principal !== '') : [],
    scenarios: Array.isArray(source.scenarios) ? source.scenarios.slice(0,40).map(sanitizeFinanceScenario_).filter(x => x.name && x.upfront !== '') : [],
    wishlist: Array.isArray(source.wishlist) ? source.wishlist.slice(0,100).map(sanitizeFinanceWishlistItem_).filter(x => x.name) : [],
    compareLab: source.compareLab && typeof source.compareLab === 'object' ? sanitizeCompareLab_(source.compareLab) : {},
    customCategories: customCategories,
    customCategoryCleanupV1: true,
    recurring: recurring,
    futureBills:Array.isArray(source.futureBills)?source.futureBills.slice(0,120).map(sanitizeFutureBill_).filter(function(b){return b.name&&b.amount!==''&&Number(b.amount)>0&&b.date;}):[],
    financeReminders: Array.isArray(source.financeReminders) ? source.financeReminders.slice(0,160).map(sanitizeFinanceReminder_).filter(function(x){ return x.name && (x.kind==='investment-snapshot' || x.amount !== '') && x.month && x.date; }) : [],
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

function sanitizeTripExpense_(item, fallbackActor) {
  const s=item&&typeof item==='object'?item:{},cats=['accommodation','transport','food','activities','other'],category=cats.includes(String(s.category||''))?String(s.category):'other',foodTypes=['groceries','eating-out','other'],foodType=category==='food'&&foodTypes.includes(String(s.foodType||''))?String(s.foodType):'',transportTypes=['flights-trains','fuel','parking-tolls','tolls','other'],transportType=category==='transport'&&transportTypes.includes(String(s.transportType||''))?String(s.transportType):'',amount=cleanMoney_(s.amount),paidRaw=String(s.paidBy||''),paidBy=ACTORS.includes(paidRaw)||paidRaw==='both'?paidRaw:'',split=String(s.split||'')==='personal'?'personal':'shared',fa=cleanActor_(s.forActor),fallback=cleanActor_(fallbackActor),forActor=fa==='Unknown'?(paidBy==='both'?(fallback==='Unknown'?'':fallback):paidBy):fa,useJar=category==='accommodation'&&s.useJar===true,logged=cleanActor_(s.loggedBy||fallbackActor);
  return {id:cleanText_(s.id,80)||Utilities.getUuid(),category:category,foodType:foodType,transportType:transportType,name:cleanText_(s.name,120),amount:amount,paidBy:paidBy,split:split,forActor:ACTORS.includes(forActor)?forActor:'',date:cleanFinanceDate_(s.date),note:cleanText_(s.note,180),uncertain:s.uncertain===true,useJar:useJar,jarContribution:useJar&&amount!==''?money2_(Number(amount)*.2):0,loggedBy:logged==='Unknown'?'':logged,createdAt:cleanText_(s.createdAt,40),updatedAt:cleanText_(s.updatedAt,40)};
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

function sanitizeTripRepayment_(item, fallbackActor) {
  const s = item && typeof item === 'object' ? item : {};
  const fallback = cleanActor_(fallbackActor);
  const fromRaw = cleanActor_(s.from || fallbackActor);
  const from = fromRaw === 'Unknown' ? (fallback === 'Unknown' ? '' : fallback) : fromRaw;
  const toRaw = cleanActor_(s.to);
  const to = toRaw === 'Unknown' ? (from === 'Principessa' ? 'Principe' : from === 'Principe' ? 'Principessa' : '') : toRaw;
  const categories = ['stay','transport','car','groceries','eating-out','activities','other'];
  const category = categories.indexOf(String(s.category || '')) >= 0 ? String(s.category) : '';
  return {
    id: cleanText_(s.id,80) || Utilities.getUuid(),
    from: ACTORS.includes(from) ? from : '',
    to: ACTORS.includes(to) ? to : '',
    amount: cleanMoney_(s.amount),
    date: cleanFinanceDate_(s.date),
    category: category,
    note: cleanText_(s.note,180),
    createdAt: cleanText_(s.createdAt,40)
  };
}

function tripExpenseCategoryKey_(entry) {
  if (entry && entry.category === 'accommodation') return 'stay';
  if (entry && entry.category === 'transport') return entry.transportType === 'fuel' ? 'car' : 'transport';
  if (entry && entry.category === 'food') return entry.foodType === 'groceries' ? 'groceries' : 'eating-out';
  if (entry && entry.category === 'activities') return 'activities';
  return 'other';
}

function tripCategorySettlement_(plan, category) {
  const safe = plan && plan.expenseEntries ? plan : sanitizePlan_(plan);
  const paid = {Principessa:0,Principe:0};
  const share = {Principessa:0,Principe:0};
  (safe.expenseEntries || []).forEach(function(entry){
    if (tripExpenseCategoryKey_(entry) !== category) return;
    const remaining = Math.max(0, Number(entry.amount || 0) - Number(entry.jarContribution || 0));
    if (entry.paidBy === 'both') {
      paid.Principessa += remaining / 2;
      paid.Principe += remaining / 2;
    } else if (ACTORS.includes(entry.paidBy)) paid[entry.paidBy] += remaining;
    if (entry.split === 'personal') {
      const owner = ACTORS.includes(entry.forActor) ? entry.forActor : entry.paidBy;
      if (ACTORS.includes(owner)) share[owner] += remaining;
    } else {
      share.Principessa += remaining / 2;
      share.Principe += remaining / 2;
    }
  });
  (safe.repayments || []).forEach(function(repayment){
    if (repayment.category !== category) return;
    const amount = Number(repayment.amount || 0);
    if (repayment.from === 'Principessa' && repayment.to === 'Principe') {
      paid.Principessa += amount; paid.Principe -= amount;
    } else if (repayment.from === 'Principe' && repayment.to === 'Principessa') {
      paid.Principe += amount; paid.Principessa -= amount;
    }
  });
  const delta = money2_(paid.Principessa - share.Principessa);
  if (Math.abs(delta) < .005) return {debtor:'',creditor:'',amount:0,paid:paid,share:share};
  return {debtor:delta>0?'Principe':'Principessa',creditor:delta>0?'Principessa':'Principe',amount:money2_(Math.abs(delta)),paid:paid,share:share};
}

function tripCategoryOwedBreakdown_(plan, actor) {
  const safe = plan && plan.expenseEntries ? plan : sanitizePlan_(plan);
  const keys = ['stay','transport','car','groceries','eating-out','activities','other'];
  const balances = {}, opened = {};
  keys.forEach(function(key){ balances[key]=0; opened[key]=''; });
  let pendingPositive = 0, pendingNegative = 0;

  function sign_(value) { return value > .005 ? 1 : value < -.005 ? -1 : 0; }
  function applyDelta_(key, delta, stamp) {
    const before = Number(balances[key] || 0), beforeSign = sign_(before);
    balances[key] = before + Number(delta || 0);
    const afterSign = sign_(balances[key]);
    if (!afterSign) {
      balances[key] = 0;
      opened[key] = '';
    } else if (afterSign !== beforeSign) {
      opened[key] = stamp;
    }
  }
  function consumePending_(key, stamp) {
    if (balances[key] < -.005 && pendingPositive > .005) {
      const used = Math.min(pendingPositive,-balances[key]);
      applyDelta_(key,used,stamp);
      pendingPositive -= used;
    }
    if (balances[key] > .005 && pendingNegative > .005) {
      const used = Math.min(pendingNegative,balances[key]);
      applyDelta_(key,-used,stamp);
      pendingNegative -= used;
    }
  }
  function consumeLegacy_(effect, stamp) {
    const wantsNegative = effect > 0;
    let remaining = Math.abs(effect);
    const eligible = keys.filter(function(key){ return wantsNegative ? balances[key] < -.005 : balances[key] > .005; })
      .sort(function(a,b){
        const dateCompare = String(opened[a] || '').localeCompare(String(opened[b] || ''));
        return dateCompare || keys.indexOf(a)-keys.indexOf(b);
      });
    eligible.forEach(function(key){
      if (remaining <= .005) return;
      const due = wantsNegative ? -balances[key] : balances[key];
      const used = Math.min(remaining,due);
      applyDelta_(key,wantsNegative ? used : -used,stamp);
      remaining -= used;
    });
    if (remaining > .005) {
      if (wantsNegative) pendingPositive += remaining;
      else pendingNegative += remaining;
    }
  }
  function eventStamp_(item,index,kind) {
    const created = String(item && item.createdAt || '');
    const day = String(item && item.date || created.slice(0,10) || '9999-12-31');
    const time = created.indexOf('T') >= 0 ? created.slice(11) : (kind === 'expense' ? '00:00:00' : '23:59:59');
    return day+'T'+time+'|'+String(index).padStart(5,'0')+'|'+kind;
  }

  const events = (safe.expenseEntries || []).map(function(entry,index){
    return {kind:'expense',entry:entry,stamp:eventStamp_(entry,index,'expense')};
  }).concat((safe.repayments || []).map(function(repayment,index){
    return {kind:'repayment',repayment:repayment,stamp:eventStamp_(repayment,index,'repayment')};
  })).sort(function(a,b){ return a.stamp.localeCompare(b.stamp); });

  events.forEach(function(event){
    if (event.kind === 'expense') {
      const entry = event.entry, key = tripExpenseCategoryKey_(entry);
      const remaining = Math.max(0,Number(entry.amount || 0)-Number(entry.jarContribution || 0));
      const paidPrincipessa = entry.paidBy === 'both' ? remaining/2 : entry.paidBy === 'Principessa' ? remaining : 0;
      const owner = ACTORS.includes(entry.forActor) ? entry.forActor : entry.paidBy;
      const sharePrincipessa = entry.split === 'personal' ? (owner === 'Principessa' ? remaining : 0) : remaining/2;
      applyDelta_(key,paidPrincipessa-sharePrincipessa,event.stamp);
      consumePending_(key,event.stamp);
      return;
    }
    const repayment = event.repayment, value = Number(repayment.amount || 0);
    const effect = repayment.from === 'Principessa' && repayment.to === 'Principe'
      ? value
      : repayment.from === 'Principe' && repayment.to === 'Principessa'
        ? -value : 0;
    if (!effect) return;
    if (repayment.category && keys.indexOf(repayment.category) >= 0) {
      applyDelta_(repayment.category,effect,event.stamp);
    } else {
      consumeLegacy_(effect,event.stamp);
    }
  });

  if (pendingPositive > .005) applyDelta_('other',pendingPositive,'9999-12-31T23:59:59|legacy');
  if (pendingNegative > .005) applyDelta_('other',-pendingNegative,'9999-12-31T23:59:59|legacy');

  const overall = tripSettlement_(safe);
  const targetCents = overall.debtor === actor ? Math.max(0,Math.round(Number(overall.amount || 0)*100)) : 0;
  const out = {};
  keys.forEach(function(key){ out[key]=0; });
  if (!targetCents) return out;

  const wantsNegative = actor === 'Principessa';
  const debts = keys.map(function(key){
    return {
      key:key,
      cents:Math.max(0,Math.round((wantsNegative ? -balances[key] : balances[key])*100)),
      opened:opened[key] || '9999-12-31T23:59:59'
    };
  }).filter(function(item){ return item.cents > 0; });

  let excess = Math.max(0,debts.reduce(function(sum,item){ return sum+item.cents; },0)-targetCents);
  debts.sort(function(a,b){
    const dateCompare = a.opened.localeCompare(b.opened);
    return dateCompare || keys.indexOf(a.key)-keys.indexOf(b.key);
  });
  debts.forEach(function(item){
    const reduce = Math.min(excess,item.cents);
    item.cents -= reduce;
    excess -= reduce;
  });
  debts.forEach(function(item){ out[item.key]=money2_(item.cents/100); });
  const assigned = debts.reduce(function(sum,item){ return sum+item.cents; },0);
  if (assigned < targetCents) out.other = money2_(Number(out.other || 0)+(targetCents-assigned)/100);
  return out;
}
function tripRepaymentCategoryLabel_(category) {
  const labels = {stay:'Stay',transport:'Transport',car:'Car',groceries:'Groceries','eating-out':'Eating out',activities:'Activities',other:'Other'};
  return labels[category] || 'this category';
}

function planPaymentMismatchDetails_(plan) {
  const source = plan && typeof plan === 'object' ? plan : {};
  const rows = [];
  (Array.isArray(source.expenseEntries) ? source.expenseEntries : []).forEach(function(raw){
    const entry = sanitizeTripExpense_(raw, raw && raw.loggedBy);
    const amount = Math.max(0, Number(entry.amount || 0));
    if (amount <= .005) return;
    const jar = Math.min(amount, Math.max(0, Number(entry.jarContribution || 0)));
    const remaining = Math.max(0, amount - jar);
    const assigned = (ACTORS.includes(entry.paidBy) || entry.paidBy === 'both') ? remaining : 0;
    const missing = money2_(Math.max(0, amount - jar - assigned));
    if (missing <= .005) return;
    const label = cleanText_(entry.name || entry.note, 120) || (
      entry.category === 'accommodation' ? 'Stay' :
      entry.category === 'transport' ? (entry.transportType === 'fuel' ? 'Car' : 'Transport') :
      entry.category === 'food' ? (entry.foodType === 'groceries' ? 'Groceries' : 'Eating out') :
      entry.category === 'activities' ? 'Activities' : 'Other'
    );
    rows.push({id:entry.id,name:label,amount:missing});
  });
  return rows;
}

function planJarTotal_(plan) {
  return money2_((Array.isArray(plan && plan.expenseEntries) ? plan.expenseEntries : []).reduce(function(sum,raw){
    const entry=sanitizeTripExpense_(raw,raw&&raw.loggedBy);
    return sum+Math.max(0,Number(entry.jarContribution||0));
  },0));
}

function tripSettlement_(plan) {
  const safe = plan && plan.expenseEntries ? plan : sanitizePlan_(plan);
  const paid = {Principessa:0,Principe:0};
  const share = {Principessa:0,Principe:0};

  (safe.expenseEntries || []).forEach(function(entry){
    const remaining = Math.max(0, Number(entry.amount || 0) - Number(entry.jarContribution || 0));
    if (entry.paidBy === 'both') {
      paid.Principessa += remaining / 2;
      paid.Principe += remaining / 2;
    } else if (ACTORS.includes(entry.paidBy)) {
      paid[entry.paidBy] += remaining;
    }

    if (entry.split === 'personal') {
      const owner = ACTORS.includes(entry.forActor) ? entry.forActor : entry.paidBy;
      if (ACTORS.includes(owner)) share[owner] += remaining;
    } else {
      share.Principessa += remaining / 2;
      share.Principe += remaining / 2;
    }
  });

  (safe.repayments || []).forEach(function(repayment){
    const amount = Number(repayment.amount || 0);
    if (repayment.from === 'Principessa' && repayment.to === 'Principe') {
      paid.Principessa += amount;
      paid.Principe -= amount;
    } else if (repayment.from === 'Principe' && repayment.to === 'Principessa') {
      paid.Principe += amount;
      paid.Principessa -= amount;
    }
  });

  const delta = money2_(paid.Principessa - share.Principessa);
  if (Math.abs(delta) < .005) return {debtor:'',creditor:'',amount:0,paid:paid,share:share};
  return {
    debtor: delta > 0 ? 'Principe' : 'Principessa',
    creditor: delta > 0 ? 'Principessa' : 'Principe',
    amount: money2_(Math.abs(delta)),
    paid: paid,
    share: share
  };
}

function stayUrlKey_(value) {
  const text=cleanText_(value,900);
  try {
    const u=new URL(text);
    return (u.origin+u.pathname).replace(/\/$/,'').toLowerCase();
  } catch (_) {
    return text.split(/[?#]/)[0].replace(/\/$/,'').toLowerCase();
  }
}
function sanitizeStayPreferences_(value) {
  const source=value&&typeof value==='object'?value:{};
  const max=cleanMoney_(source.maxTotal);
  return {
    maxTotal:max,
    parking:source.parking===true,
    washingMachine:source.washingMachine===true,
    entirePlace:source.entirePlace!==false,
    bedrooms:Math.min(8,Math.max(0,Math.floor(Number(source.bedrooms)||0))),
    wifi:source.wifi===true,
    kitchen:source.kitchen===true,
    airConditioning:source.airConditioning===true,
    pool:source.pool===true
  };
}
function sanitizeStayFavoritePrice_(item) {
  const source=item&&typeof item==='object'?item:{};
  return {
    price:cleanMoney_(source.price),
    status:cleanText_(source.status,20)==='unavailable'?'unavailable':'available',
    checkedAt:cleanText_(source.checkedAt,40),
    planId:cleanText_(source.planId,80),
    start:cleanText_(source.start,20),
    end:cleanText_(source.end,20)
  };
}
function sanitizeStayFavorite_(item) {
  const source=item&&typeof item==='object'?item:{};
  const provider=String(source.source||'').toLowerCase()==='airbnb'?'airbnb':'booking';
  return {
    id:cleanText_(source.id,80)||Utilities.getUuid(),
    source:provider,
    url:cleanText_(source.url,900),
    name:cleanText_(source.name,180),
    city:cleanText_(source.city,160),
    area:cleanText_(source.area,120),
    image:cleanText_(source.image,900),
    note:cleanText_(source.note,500),
    requirements:sanitizeStayPreferences_(source.requirements),
    history:(Array.isArray(source.history)?source.history:[]).slice(-200).map(sanitizeStayFavoritePrice_).filter(function(x){return x.checkedAt&&(x.price!==''||x.status==='unavailable');}),
    createdAt:cleanText_(source.createdAt,40),
    updatedAt:cleanText_(source.updatedAt,40)
  };
}

function collectStayFavorites_(globalFavorites, plans) {
  const merged = [];
  const byKey = new Map();
  function add(raw) {
    const favorite = sanitizeStayFavorite_(raw);
    if (!favorite.url || !favorite.name || favorite.source !== 'airbnb') return;
    const key = stayUrlKey_(favorite.url) || favorite.id;
    const existing = byKey.get(key);
    if (!existing) {
      merged.push(favorite);
      byKey.set(key, favorite);
      return;
    }
    if (favorite.updatedAt && (!existing.updatedAt || favorite.updatedAt > existing.updatedAt)) {
      existing.name = favorite.name || existing.name;
      existing.image = favorite.image || existing.image;
      existing.note = favorite.note || existing.note;
      existing.city = favorite.city || existing.city;
      existing.area = favorite.area || existing.area;
      existing.updatedAt = favorite.updatedAt;
    }
    const histories = [...(existing.history || []), ...(favorite.history || [])];
    const seen = new Set();
    existing.history = histories.filter(function(row){
      const k=[row.price,row.checkedAt,row.planId,row.start,row.end].join('|');
      if(seen.has(k)) return false;
      seen.add(k); return true;
    }).sort(function(a,b){ return String(a.checkedAt).localeCompare(String(b.checkedAt)); }).slice(-200);
  }
  (Array.isArray(globalFavorites) ? globalFavorites : []).forEach(add);
  (Array.isArray(plans) ? plans : []).forEach(function(plan){
    (plan && plan.stayTracker && Array.isArray(plan.stayTracker.saved) ? plan.stayTracker.saved : []).forEach(add);
  });
  return merged.slice(0,240);
}

function sanitizeStaySelection_(item) {
  const source=item&&typeof item==='object'?item:{};
  return {
    ownerPlanId:cleanText_(source.ownerPlanId,80),
    favoriteId:cleanText_(source.favoriteId,80),
    selectedAt:cleanText_(source.selectedAt,40),
    priceAtSelection:cleanMoney_(source.priceAtSelection),
    expenseId:cleanText_(source.expenseId,80)
  };
}

function sanitizeStayTrackerSnapshot_(item) {
  const source=item&&typeof item==='object'?item:{};
  return {
    accommodationId:cleanText_(source.accommodationId,100),
    name:cleanText_(source.name,180),
    price:cleanMoney_(source.price),
    currency:cleanText_(source.currency,8)||'EUR',
    url:cleanText_(source.url,900),
    checkedAt:cleanText_(source.checkedAt,40)
  };
}
function sanitizeStayTracker_(value) {
  const source=value&&typeof value==='object'?value:{};
  const area=['lake-garda','bergamo'].indexOf(String(source.area||''))>=0?String(source.area):'lake-garda';
  return {
    area:area,
    preferences:sanitizeStayPreferences_(source.preferences),
    saved:(Array.isArray(source.saved)?source.saved:[]).slice(0,120).map(sanitizeStayFavorite_).filter(function(item){return item.url&&item.name;}),
    selected:sanitizeStaySelection_(source.selected),
    lastCheckedAt:cleanText_(source.lastCheckedAt,40),
    history:(Array.isArray(source.history)?source.history:[]).slice(-800).map(sanitizeStayTrackerSnapshot_).filter(function(item){return item.accommodationId&&item.price!==''&&item.checkedAt;})
  };
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
    expenseEntries:(Array.isArray(plan&&plan.expenseEntries)?plan.expenseEntries:[]).slice(-500).map(function(x){return sanitizeTripExpense_(x,x&&x.loggedBy);}).filter(function(x){return x.amount!==''&&!!x.paidBy;}),
    repayments:(Array.isArray(plan&&plan.repayments)?plan.repayments:[]).slice(-300).map(function(x){return sanitizeTripRepayment_(x,x&&x.from);}).filter(function(x){return x.amount!==''&&Number(x.amount)>0&&!!x.from&&!!x.to&&x.from!==x.to;}),
    prep: sanitizeTripPrep_(plan && plan.prep),
    stayTracker: sanitizeStayTracker_(plan && plan.stayTracker),
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

function reconciliationWarnings_(trip, plan) {
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
    if(Math.abs(paid-Number(m.total))>.005)warnings.push(key+' payments differ from the bill by '+formatMoney_(Math.abs(paid-Number(m.total)))+'.');
  });
  const a=trip.submissions.Principessa,b=trip.submissions.Principe;
  if(a&&b){
    const total=MONEY_FIELDS.reduce((sum,key)=>sum+Number(a[key]||0),0);
    const shared=sanitizeSharedExpenses_(trip.sharedExpenses);
    const legacyJar=Number(shared.accom&&shared.accom.accommodation&&shared.accom.accommodation.jarContribution||0);
    const planJar=plan&&Array.isArray(plan.expenseEntries)?planJarTotal_(plan):0;
    const jar=planJar>0?planJar:legacyJar;
    const paid=Number(a.paid||0)+Number(b.paid||0)+jar;
    if(Math.abs(total-paid)>.005)warnings.push('Total payments do not match trip expenses (difference '+formatMoney_(Math.abs(total-paid))+').');
  }
  return warnings;
}

export const SUPPORTED_ACTIONS = new Set([
  'savePlan', 'saveStaySearchPreferences', 'saveStayFavorite', 'updateStayFavoriteDetails', 'updateStayFavoritePrice', 'markStayFavoriteUnavailable', 'deleteStayFavorite', 'selectStayForTrip', 'unselectStayForTrip', 'saveStayTrackerSnapshot', 'saveAccommodationExpense', 'updateSharedJarBalance', 'confirmAccommodationRepayment',
  'saveTripPrep', 'saveTripPrepDefaults', 'saveTripNotes', 'saveSharedExpense', 'saveTripExpense', 'deleteTripExpense', 'saveTripRepayment', 'deleteCurrentTrip', 'savePlanPartial', 'savePlanSubmission',
  'saveSubmission', 'confirmTrip', 'confirmPlanTrip', 'saveFinanceMonth', 'confirmFinanceCreditCard', 'saveFinancePlanning',
  'saveFinanceProfile', 'confirmFutureBill', 'wishlistCheckout', 'saveCompareLab', 'updateCompare',
  'shopAward', 'shopPurchase', 'shopSetTheme', 'shopSavePacking',
  'shopSendSignal', 'shopMarkSignalsSeen',
]);

export function configureStateStore(store) {
  stateStore = store;
}

export function getState() {
  return readState_();
}

export function runAction(action, payload, actor) {
  if (!SUPPORTED_ACTIONS.has(String(action || ''))) {
    return { ok: false, error: 'Unknown action' };
  }
  return handleAction_(action, payload, actor);
}
