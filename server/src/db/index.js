import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const ACTORS = ['Principessa', 'Principe'];
const DEFAULT_COMPARE = {
  rent: 600, utilities: 120, condo: 0, stilltravel: 180, food: 250,
  carpay: 250, insurance: 90, tax: 45, carfuel: 120, maintenance: 50,
};
const DEFAULT_JAR = { initialBalance: 870, balance: 870, transactions: [] };
const DEFAULT_TRIP_PREP_DEFAULTS = {
  packing: [
    { id:'default-packing-1', text:'Toothbrushes', done:false },
    { id:'default-packing-2', text:'Slippers', done:false },
    { id:'default-packing-3', text:'Hair brush', done:false },
    { id:'default-packing-4', text:'Shampoo', done:false },
    { id:'default-packing-5', text:'Conditioner', done:false },
    { id:'default-packing-6', text:'Shower gel', done:false },
    { id:'default-packing-7', text:'Dishwasher detergent', done:false },
  ],
  reminders: [
    { id:'default-reminder-1', text:"Don't forget to put fuel", done:false },
    { id:'default-reminder-2', text:"Don't forget to ask mom to make work sandwich", done:false },
    { id:'default-reminder-3', text:"Don't forget to take pictures of the Airbnb when you arrive", done:false },
  ],
  updatedAt: '',
  updatedBy: 'Unknown',
};
const DEFAULT_FINANCE_PROFILE = {
  bankAccounts: [], savingsTotal: '', savingsReserved: [], receivables: [],
  scenarios: [], wishlist: [], compareLab: {},
};
const DEFAULT_GAME_PROFILE = {
  lovis: 0, twos: 0, twosModel: 'budget-v27', purchases: [], theme: 'default',
  lastSeenAt: '',
  awards: {
    logs: [], tripConfirms: [], financeConfirms: [], expenses: [],
    compareSaves: [], compareCompletes: [], wishlistAdds: [],
    wishlistCheckouts: [], tripSettlements: [], financeSettlements: [],
  },
  packing: {}, planners: {},
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const encode = (value) => JSON.stringify(value);
const decode = (value, fallback) => {
  try { return value == null ? clone(fallback) : JSON.parse(value); }
  catch { return clone(fallback); }
};

export function openDatabase(databasePath) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 10000');
  db.pragma('foreign_keys = ON');

  const migrationPath = fileURLToPath(new URL('./migrations/001_init.sql', import.meta.url));
  db.exec(readFileSync(migrationPath, 'utf8'));

  const putAppState = db.prepare('INSERT OR IGNORE INTO app_state (key, json) VALUES (?, ?)');
  putAppState.run('sharedJar', encode(DEFAULT_JAR));
  putAppState.run('tripPrepDefaults', encode(DEFAULT_TRIP_PREP_DEFAULTS));
  putAppState.run('compare', encode(DEFAULT_COMPARE));
  putAppState.run('gameSignals', '[]');
  putAppState.run('audit', '[]');
  putAppState.run('meta', encode({ version: 18, updatedAt: '' }));

  const putFinanceProfile = db.prepare('INSERT OR IGNORE INTO finance_profiles (actor, json) VALUES (?, ?)');
  const putGameProfile = db.prepare('INSERT OR IGNORE INTO game_profiles (actor, json) VALUES (?, ?)');
  for (const actor of ACTORS) {
    putFinanceProfile.run(actor, encode(DEFAULT_FINANCE_PROFILE));
    putGameProfile.run(actor, encode(DEFAULT_GAME_PROFILE));
  }

  const appValue = db.prepare('SELECT json FROM app_state WHERE key = ?');
  const selectTrips = db.prepare('SELECT json FROM trips ORDER BY rowid');
  const selectPlans = db.prepare('SELECT json FROM plans ORDER BY rowid');
  const selectMonths = db.prepare('SELECT actor, json FROM finance_months ORDER BY actor, month');
  const selectFinanceProfiles = db.prepare('SELECT actor, json FROM finance_profiles');
  const selectGameProfiles = db.prepare('SELECT actor, json FROM game_profiles');

  function read() {
    const meta = decode(appValue.get('meta')?.json, { version: 18, updatedAt: '' });
    const finances = { Principessa: [], Principe: [] };
    for (const row of selectMonths.all()) {
      if (ACTORS.includes(row.actor)) finances[row.actor].push(decode(row.json, {}));
    }

    const financeProfiles = {
      Principessa: clone(DEFAULT_FINANCE_PROFILE),
      Principe: clone(DEFAULT_FINANCE_PROFILE),
    };
    for (const row of selectFinanceProfiles.all()) {
      if (ACTORS.includes(row.actor)) financeProfiles[row.actor] = decode(row.json, DEFAULT_FINANCE_PROFILE);
    }

    const game = {
      Principessa: clone(DEFAULT_GAME_PROFILE),
      Principe: clone(DEFAULT_GAME_PROFILE),
      signals: decode(appValue.get('gameSignals')?.json, []),
    };
    for (const row of selectGameProfiles.all()) {
      if (ACTORS.includes(row.actor)) game[row.actor] = decode(row.json, DEFAULT_GAME_PROFILE);
    }

    return {
      version: Number(meta.version) || 18,
      trips: selectTrips.all().map((row) => decode(row.json, {})),
      plans: selectPlans.all().map((row) => decode(row.json, {})),
      finances,
      financeProfiles,
      sharedJar: decode(appValue.get('sharedJar')?.json, DEFAULT_JAR),
      tripPrepDefaults: decode(appValue.get('tripPrepDefaults')?.json, DEFAULT_TRIP_PREP_DEFAULTS),
      game,
      compare: decode(appValue.get('compare')?.json, DEFAULT_COMPARE),
      audit: decode(appValue.get('audit')?.json, []),
      updatedAt: String(meta.updatedAt || ''),
    };
  }

  const clearTrips = db.prepare('DELETE FROM trips');
  const clearPlans = db.prepare('DELETE FROM plans');
  const clearMonths = db.prepare('DELETE FROM finance_months');
  const insertTrip = db.prepare('INSERT INTO trips (id, json, updated_at) VALUES (?, ?, ?)');
  const insertPlan = db.prepare('INSERT INTO plans (id, json, linked_trip_id, updated_at) VALUES (?, ?, ?, ?)');
  const insertMonth = db.prepare('INSERT INTO finance_months (actor, month, json) VALUES (?, ?, ?)');
  const upsertFinanceProfile = db.prepare('INSERT INTO finance_profiles (actor, json) VALUES (?, ?) ON CONFLICT(actor) DO UPDATE SET json=excluded.json');
  const upsertGameProfile = db.prepare('INSERT INTO game_profiles (actor, json) VALUES (?, ?) ON CONFLICT(actor) DO UPDATE SET json=excluded.json');
  const upsertAppState = db.prepare('INSERT INTO app_state (key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json=excluded.json');

  const writeTransaction = db.transaction((state) => {
    clearTrips.run();
    for (const trip of state.trips || []) insertTrip.run(trip.id, encode(trip), trip.updatedAt || '');

    clearPlans.run();
    for (const plan of state.plans || []) insertPlan.run(plan.id, encode(plan), plan.linkedTripId || '', plan.updatedAt || '');

    clearMonths.run();
    for (const actor of ACTORS) {
      for (const month of state.finances?.[actor] || []) insertMonth.run(actor, month.month, encode(month));
      upsertFinanceProfile.run(actor, encode(state.financeProfiles?.[actor] || DEFAULT_FINANCE_PROFILE));
      upsertGameProfile.run(actor, encode(state.game?.[actor] || DEFAULT_GAME_PROFILE));
    }

    upsertAppState.run('sharedJar', encode(state.sharedJar || DEFAULT_JAR));
    upsertAppState.run('tripPrepDefaults', encode(state.tripPrepDefaults || DEFAULT_TRIP_PREP_DEFAULTS));
    upsertAppState.run('compare', encode(state.compare || DEFAULT_COMPARE));
    upsertAppState.run('gameSignals', encode(state.game?.signals || []));
    upsertAppState.run('audit', encode(state.audit || []));
    upsertAppState.run('meta', encode({ version: 18, updatedAt: state.updatedAt || '' }));
  });

  function reset() {
    writeTransaction({
      version: 18, trips: [], plans: [], finances: { Principessa: [], Principe: [] },
      financeProfiles: { Principessa: clone(DEFAULT_FINANCE_PROFILE), Principe: clone(DEFAULT_FINANCE_PROFILE) },
      sharedJar: clone(DEFAULT_JAR),
      tripPrepDefaults: clone(DEFAULT_TRIP_PREP_DEFAULTS),
      game: { Principessa: clone(DEFAULT_GAME_PROFILE), Principe: clone(DEFAULT_GAME_PROFILE), signals: [] },
      compare: clone(DEFAULT_COMPARE), audit: [], updatedAt: '',
    });
  }

  return {
    db,
    store: { read, write: (state) => writeTransaction(state), reset },
    close: () => db.close(),
  };
}
