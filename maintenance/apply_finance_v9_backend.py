from pathlib import Path

p=Path('backend/Code.gs')
s=p.read_text(encoding='utf-8')

# Version + state shape.
s=s.replace('    version: 8,\n    trips: [],\n    plans: [],\n    finances: {Principessa:[], Principe:[]},', "    version: 9,\n    trips: [],\n    plans: [],\n    finances: {Principessa:[], Principe:[]},\n    financeProfiles: {\n      Principessa:{bankAccounts:[],savingsTotal:'',savingsReserved:[],receivables:[]},\n      Principe:{bankAccounts:[],savingsTotal:'',savingsReserved:[],receivables:[]}\n    },", 1)
s=s.replace('      version: 8,\n      trips: Array.isArray(parsed.trips) ? parsed.trips.map(migrateTrip_) : [],\n      plans: Array.isArray(parsed.plans) ? parsed.plans.map(sanitizePlan_) : [],\n      finances: sanitizeFinances_(parsed.finances),', '      version: 9,\n      trips: Array.isArray(parsed.trips) ? parsed.trips.map(migrateTrip_) : [],\n      plans: Array.isArray(parsed.plans) ? parsed.plans.map(sanitizePlan_) : [],\n      finances: sanitizeFinances_(parsed.finances),\n      financeProfiles: sanitizeFinanceProfiles_(parsed.financeProfiles),', 1)
s=s.replace('  state.version = 8;', '  state.version = 9;', 1)
s=s.replace('  state.plans = Array.isArray(state.plans) ? state.plans.map(sanitizePlan_) : [];\n  PropertiesService', '  state.plans = Array.isArray(state.plans) ? state.plans.map(sanitizePlan_) : [];\n  state.financeProfiles = sanitizeFinanceProfiles_(state.financeProfiles);\n  PropertiesService', 1)
s=s.replace("if (action === 'ping') return output_({ok:true, version:8, now:new Date().toISOString()}, callback);", "if (action === 'ping') return output_({ok:true, version:9, now:new Date().toISOString()}, callback);", 1)

# Finance profile write action.
anchor="""    if (action === 'deleteFinanceMonth') {
      const month = cleanText_(payload.month, 10);
      state.finances = sanitizeFinances_(state.finances);
      state.finances[actor] = (state.finances[actor] || []).filter(x => x.month !== month);
      saveState_(state);
      return output_({ok:true});
    }

"""
insert=anchor+"""    if (action === 'saveFinanceProfile') {
      state.financeProfiles = sanitizeFinanceProfiles_(state.financeProfiles);
      const profile = sanitizeFinanceProfile_(payload.profile || {}, actor);
      profile.updatedAt = new Date().toISOString();
      profile.updatedBy = actor;
      state.financeProfiles[actor] = profile;
      saveState_(state);
      return output_({ok:true});
    }

"""
if anchor not in s: raise SystemExit('deleteFinanceMonth anchor missing')
s=s.replace(anchor,insert,1)

old="""function sanitizeFinanceExpense_(item) {
  const allowed = ['health','subscriptions','living','transport','groceries','extra','savings','investments','other'];
  const group = allowed.indexOf(String(item && item.group || '')) >= 0 ? String(item.group) : 'other';
  return {group:group, name:cleanText_(item && item.name, 100), amount:cleanMoney_(item && item.amount)};
}
"""
new="""function sanitizeFinanceExpense_(item) {
  const allowed = ['medical','subscriptions','rent','transport','groceries','extra','savings','investments','other'];
  let group = String(item && item.group || '');
  if (group === 'health') group = 'medical';
  if (group === 'living') group = 'rent';
  if (allowed.indexOf(group) < 0) group = 'other';
  return {group:group, name:cleanText_(item && item.name, 100), amount:cleanMoney_(item && item.amount)};
}
"""
if old not in s: raise SystemExit('finance expense sanitizer anchor missing')
s=s.replace(old,new,1)

old="""function sanitizeFinanceMonth_(record, actor) {
  const incomes = Array.isArray(record && record.incomes) ? record.incomes.slice(0,40).map(sanitizeFinanceIncome_).filter(x => x.name && x.amount !== '') : [];
  const expenses = Array.isArray(record && record.expenses) ? record.expenses.slice(0,100).map(sanitizeFinanceExpense_).filter(x => x.name && x.amount !== '') : [];
  const reserved = Array.isArray(record && record.reserved) ? record.reserved.slice(0,40).map(sanitizeFinanceReserved_).filter(x => x.name && x.amount !== '') : [];
  return {
    month: cleanText_(record && record.month, 10),
    incomes: incomes,
    expenses: expenses,
    extraBudget: cleanMoney_(record && record.extraBudget),
    reserved: reserved,
    updatedAt: cleanText_(record && record.updatedAt, 40),
    updatedBy: cleanActor_(record && record.updatedBy || actor)
  };
}
"""
new="""function sanitizeFinanceMonth_(record, actor) {
  const incomes = Array.isArray(record && record.incomes) ? record.incomes.slice(0,40).map(sanitizeFinanceIncome_).filter(x => x.name && x.amount !== '') : [];
  const expenses = Array.isArray(record && record.expenses) ? record.expenses.slice(0,100).map(sanitizeFinanceExpense_).filter(x => x.name && x.amount !== '') : [];
  return {
    month: cleanText_(record && record.month, 10),
    incomes: incomes,
    expenses: expenses,
    extraBudget: cleanMoney_(record && record.extraBudget),
    investmentTotal: cleanMoney_(record && record.investmentTotal),
    sisterInvestments: cleanMoney_(record && record.sisterInvestments),
    updatedAt: cleanText_(record && record.updatedAt, 40),
    updatedBy: cleanActor_(record && record.updatedBy || actor)
  };
}
"""
if old not in s: raise SystemExit('finance month sanitizer anchor missing')
s=s.replace(old,new,1)

anchor="""function sanitizeFinances_(finances) {
  const source = finances && typeof finances === 'object' ? finances : {};
  return {
    Principessa: sanitizeFinanceList_(source.Principessa, 'Principessa'),
    Principe: sanitizeFinanceList_(source.Principe, 'Principe')
  };
}

"""
add=anchor+"""function sanitizeFinanceBank_(item) {
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

"""
if anchor not in s: raise SystemExit('sanitizeFinances anchor missing')
s=s.replace(anchor,add,1)

p.write_text(s,encoding='utf-8')

# Fix/validate the front-end file currently on main.
f=Path('finances.js')
js=f.read_text(encoding='utf-8').replace("'&quot'", "'&quot;'", 1)
f.write_text(js,encoding='utf-8')
