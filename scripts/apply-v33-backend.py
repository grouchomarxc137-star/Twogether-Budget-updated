from pathlib import Path


def rep(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing patch anchor: {label}')
    return text.replace(old, new, 1)


action_block = r'''
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

'''

finance_action = r'''
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

'''

helper_block = r'''
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
'''

planning_helpers = r'''
function sanitizeFinancePlanningItem_(item){
  const s=item&&typeof item==='object'?item:{},frequency=['one-time','monthly','yearly'].indexOf(String(s.frequency||''))>=0?String(s.frequency):'one-time',paymentTiming=['upfront','later'].indexOf(String(s.paymentTiming||''))>=0?String(s.paymentTiming):'';
  const kind=String(s.kind||'')==='income'?'income':'expense';
  const allowed=['medical','subscriptions','rent','transport','groceries','extra','savings','investments','other']; let group=String(s.group||'other'); if(allowed.indexOf(group)<0)group='other';
  const planner=cleanMoney_(s.planner),actual=cleanMoney_(s.actual); let reserveMonthly='';
  if(frequency==='yearly'&&paymentTiming==='later'&&planner!=='')reserveMonthly=money2_(Number(planner)/12);
  return {id:cleanText_(s.id,80)||Utilities.getUuid(),name:cleanText_(s.name,120),kind:kind,group:group,planner:planner,actual:actual,frequency:frequency,paymentTiming:paymentTiming,reserveMonthly:reserveMonthly,notes:cleanText_(s.notes,240)};
}
function sanitizeFinancePlanning_(value){const s=value&&typeof value==='object'?value:{};return {items:(Array.isArray(s.items)?s.items:[]).slice(0,120).map(sanitizeFinancePlanningItem_).filter(function(x){return !!x.name;}),updatedAt:cleanText_(s.updatedAt,40)};}

'''

for filename in ['backend/Code.gs','backend/Code-v17.gs']:
    p=Path(filename); text=p.read_text()
    text=rep(text,"    },\n    game: defaultGame_(),","    },\n    sharedJar: defaultSharedJar_(),\n    game: defaultGame_(),",'default shared jar')
    text=rep(text,"      financeProfiles: sanitizeFinanceProfiles_(parsed.financeProfiles),\n      game: sanitizeGame_(parsed.game),","      financeProfiles: sanitizeFinanceProfiles_(parsed.financeProfiles),\n      sharedJar: sanitizeSharedJar_(parsed.sharedJar),\n      game: sanitizeGame_(parsed.game),",'read shared jar')
    text=rep(text,"  state.financeProfiles = sanitizeFinanceProfiles_(state.financeProfiles);\n  state.game = sanitizeGame_(state.game);","  state.financeProfiles = sanitizeFinanceProfiles_(state.financeProfiles);\n  state.sharedJar = sanitizeSharedJar_(state.sharedJar);\n  state.game = sanitizeGame_(state.game);",'save shared jar')
    text=rep(text,"          sharedExpenses: {},\n          linkedTripId: '',","          sharedExpenses: {},\n          prep: defaultTripPrep_(),\n          linkedTripId: '',",'new plan prep')
    text=rep(text,"    sharedExpenses: sanitizeSharedExpenses_(plan && plan.sharedExpenses),\n    linkedTripId:","    sharedExpenses: sanitizeSharedExpenses_(plan && plan.sharedExpenses),\n    prep: sanitizeTripPrep_(plan && plan.prep),\n    linkedTripId:",'sanitize plan prep')
    text=rep(text,"    if (action === 'saveSharedExpense') {",action_block+"    if (action === 'saveSharedExpense') {",'new accommodation actions')
    text=rep(text,"    if (action === 'deleteFinanceMonth') {",finance_action+"    if (action === 'deleteFinanceMonth') {",'finance planning action')
    text=rep(text,"function emptySharedExpense_() {",helper_block+"\nfunction emptySharedExpense_() {",'shared helpers')
    text=rep(text,"    unknown:{Principessa:false,Principe:false},\n    updatedAt:'', updatedBy:'Unknown'","    unknown:{Principessa:false,Principe:false},\n    accommodation:defaultAccommodationMeta_(),\n    updatedAt:'', updatedBy:'Unknown'",'accommodation meta default')
    text=rep(text,"  out.updatedAt = cleanText_(source.updatedAt,40);","  out.accommodation = sanitizeAccommodationMeta_(source.accommodation);\n  out.updatedAt = cleanText_(source.updatedAt,40);",'accommodation meta sanitize')
    text=rep(text,"function sanitizeFinanceMonth_(record, actor) {",planning_helpers+"function sanitizeFinanceMonth_(record, actor) {",'planning helpers')
    text=rep(text,"    sisterInvestments: cleanMoney_(record && record.sisterInvestments),\n    finalized:","    sisterInvestments: cleanMoney_(record && record.sisterInvestments),\n    planning: sanitizeFinancePlanning_(record && record.planning),\n    finalized:",'planning persisted')
    text=rep(text,"    const paid=Number(m.paid.Principessa||0)+Number(m.paid.Principe||0);\n    if(Math.abs(paid-Number(m.total))>.005)warnings.push(key+' payments differ from the bill by €'+Math.abs(paid-Number(m.total)).toFixed(2)+'.');","    const jar=key==='accom'?Number(m.accommodation&&m.accommodation.jarContribution||0):0;\n    const paid=Number(m.paid.Principessa||0)+Number(m.paid.Principe||0)+jar;\n    if(Math.abs(paid-Number(m.total))>.005)warnings.push(key+' payments differ from the bill by €'+Math.abs(paid-Number(m.total)).toFixed(2)+'.');",'jar reconciliation')
    text=rep(text,"  if(a&&b){const total=MONEY_FIELDS.reduce((sum,key)=>sum+Number(a[key]||0),0);const paid=Number(a.paid||0)+Number(b.paid||0);if(Math.abs(total-paid)>.005)warnings.push('Total payments do not match trip expenses (difference €'+Math.abs(total-paid).toFixed(2)+'.');}","  if(a&&b){const total=MONEY_FIELDS.reduce((sum,key)=>sum+Number(a[key]||0),0);const shared=sanitizeSharedExpenses_(trip.sharedExpenses);const jar=Number(shared.accom&&shared.accom.accommodation&&shared.accom.accommodation.jarContribution||0);const paid=Number(a.paid||0)+Number(b.paid||0)+jar;if(Math.abs(total-paid)>.005)warnings.push('Total payments do not match trip expenses (difference €'+Math.abs(total-paid).toFixed(2)+'.');}",'overall jar reconciliation')
    p.write_text(text)
