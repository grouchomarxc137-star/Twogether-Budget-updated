from pathlib import Path

# --- Trip budget overview: active budgets + the most recent confirmed budget ---
p=Path('workflow.js')
s=p.read_text(encoding='utf-8')
old="""    const visiblePlans=plans.filter(plan=>!isLocked(tripForPlan(plan)));
    const a=actor();
    const emptyActive=visiblePlans.length?'':'<div class=\"budget-empty\">No active trip budgets right now. Your confirmed budgets stay inside their trip pages.</div>';
    root.innerHTML=emptyActive+plans.map(plan=>{
"""
new="""    const activePlans=plans.filter(plan=>!isLocked(tripForPlan(plan)));
    const lastConfirmed=plans.find(plan=>isLocked(tripForPlan(plan)))||null;
    const displayedPlans=lastConfirmed?[...activePlans,lastConfirmed]:activePlans;
    const a=actor();
    const emptyActive=activePlans.length?'':'<div class=\"budget-empty\">No active trip budgets right now. The most recent confirmed trip is still shown below.</div>';
    root.innerHTML=emptyActive+displayedPlans.map(plan=>{
"""
if old not in s: raise SystemExit('budget list anchor not found')
s=s.replace(old,new,1)
old="""      const status=trip?'Trip expenses in progress':anyPartial?'Some expenses logged':'Waiting for the trip';
"""
new="""      const status=locked?'Last confirmed trip':trip?'Trip expenses in progress':anyPartial?'Some expenses logged':'Waiting for the trip';
"""
if old not in s: raise SystemExit('budget status anchor not found')
s=s.replace(old,new,1)
s=s.replace("<article class=\"budget-plan-card ${locked?'hidden':''}\"", "<article class=\"budget-plan-card ${locked?'last-confirmed-budget':''}\"",1)
s=s.replace("<span class=\"budget-plan-status ${trip||anyPartial?'live':''}\">", "<span class=\"budget-plan-status ${locked?'done':trip||anyPartial?'live':''}\">",1)
p.write_text(s,encoding='utf-8')

# --- Backend version 8: per-person monthly finances ---
bp=Path('backend/Code.gs')
b=bp.read_text(encoding='utf-8')
b=b.replace("version: 7,\n    trips: [],\n    plans: [],", "version: 8,\n    trips: [],\n    plans: [],\n    finances: {Principessa:[], Principe:[]},",1)
b=b.replace("version: 7,\n      trips: Array.isArray(parsed.trips) ? parsed.trips.map(migrateTrip_) : [],\n      plans: Array.isArray(parsed.plans) ? parsed.plans.map(sanitizePlan_) : [],", "version: 8,\n      trips: Array.isArray(parsed.trips) ? parsed.trips.map(migrateTrip_) : [],\n      plans: Array.isArray(parsed.plans) ? parsed.plans.map(sanitizePlan_) : [],\n      finances: sanitizeFinances_(parsed.finances),",1)
b=b.replace("state.version = 7;\n  state.updatedAt", "state.version = 8;\n  state.updatedAt",1)
b=b.replace("state.plans = Array.isArray(state.plans) ? state.plans.map(sanitizePlan_) : [];\n  PropertiesService", "state.plans = Array.isArray(state.plans) ? state.plans.map(sanitizePlan_) : [];\n  state.finances = sanitizeFinances_(state.finances);\n  PropertiesService",1)
b=b.replace("if (action === 'ping') return output_({ok:true, version:7, now:new Date().toISOString()}, callback);", "if (action === 'ping') return output_({ok:true, version:8, now:new Date().toISOString()}, callback);",1)

anchor="""    if (action === 'updateCompare') {
      const allowed = ['rent','utilities','condo','stilltravel','food','carpay','insurance','tax','carfuel','maintenance'];
"""
insert="""    if (action === 'saveFinanceMonth') {
      const monthData = sanitizeFinanceMonth_(payload.monthData || {}, actor);
      if (!/^\\d{4}-\\d{2}$/.test(monthData.month)) throw new Error('Choose a valid month');
      state.finances = sanitizeFinances_(state.finances);
      const list = state.finances[actor] || [];
      const idx = list.findIndex(x => x.month === monthData.month);
      monthData.updatedAt = new Date().toISOString();
      monthData.updatedBy = actor;
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

    if (action === 'updateCompare') {
      const allowed = ['rent','utilities','condo','stilltravel','food','carpay','insurance','tax','carfuel','maintenance'];
"""
if anchor not in b: raise SystemExit('backend action anchor not found')
b=b.replace(anchor,insert,1)

helper_anchor="""function cleanUncertain_(obj) {
"""
helpers="""function sanitizeFinanceIncome_(item) {
  return {name:cleanText_(item && item.name, 100), amount:cleanMoney_(item && item.amount)};
}

function sanitizeFinanceExpense_(item) {
  const allowed = ['health','subscriptions','living','transport','groceries','extra','savings','investments','other'];
  const group = allowed.indexOf(String(item && item.group || '')) >= 0 ? String(item.group) : 'other';
  return {group:group, name:cleanText_(item && item.name, 100), amount:cleanMoney_(item && item.amount)};
}

function sanitizeFinanceReserved_(item) {
  return {name:cleanText_(item && item.name, 100), amount:cleanMoney_(item && item.amount)};
}

function sanitizeFinanceMonth_(record, actor) {
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

function sanitizeFinanceList_(list, actor) {
  if (!Array.isArray(list)) return [];
  const byMonth = {};
  list.slice(-36).forEach(function(record) {
    const safe = sanitizeFinanceMonth_(record, actor);
    if (/^\\d{4}-\\d{2}$/.test(safe.month)) byMonth[safe.month] = safe;
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

function cleanUncertain_(obj) {
"""
if helper_anchor not in b: raise SystemExit('backend helper anchor not found')
b=b.replace(helper_anchor,helpers,1)
bp.write_text(b,encoding='utf-8')
