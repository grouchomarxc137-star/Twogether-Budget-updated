// Current Trip overview: a simple shared category table with drill-down
// editing for individual trip expenses. Existing/legacy trip totals stay
// visible while new log-as-you-go expenses use the shared expenseEntries
// collection on each budget plan.
import { fmtDate, money as formatMoney } from '../lib/format.js';
import { tripDetailMoneyHtml, tripDetailShellHtml, tripTimelineHtml, tripExpenseRowHtml, tripSheetHtml } from '../lib/trips-ui.js';
import { openSheet, rememberCardView, backFromCardView, dismissCardView } from '../app/navigation.js';
import { isCarExpense, carExpenseLabel } from './car-expenses.js';

const names = ['Principessa', 'Principe'];
const legacyKeys = ['travel', 'accom', 'fuel', 'groceries', 'eat', 'tolls', 'other'];
const legacyLabels = { travel: 'Transport', accom: 'Accommodation', fuel: 'Car · Fuel', groceries: 'House groceries', eat: 'Food / eating out', tolls: 'Car · Tolls / Parking', other: 'Other' };
const rows = [
  { key: 'accommodation', label: 'Accommodation', category: 'accommodation', legacy: ['accom'] },
  { key: 'transport', label: 'Transport', category: 'transport', legacy: ['travel'], subtypes: [['flights-trains', 'Flights / Trains'], ['other', 'Other']] },
  { key: 'car', label: 'Car', category: 'transport', car: true, legacy: ['fuel', 'tolls'], subtypes: [['fuel', 'Fuel'], ['tolls', 'Tolls'], ['parking', 'Parking'], ['car-other', 'Other']] },
  { key: 'groceries', label: 'Groceries', category: 'food', legacy: ['groceries', 'eat'], subtypes: [['eating-out', 'Food / eating out'], ['groceries', 'House groceries'], ['other', 'Other']] },
  { key: 'activities', label: 'Activities', category: 'activities', legacy: [] },
  { key: 'other', label: 'Other', category: 'other', legacy: ['other'], customName: true },
];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const has = (v) => v !== '' && v != null;
const n = (v) => Number(String(v ?? 0).replace(',', '.')) || 0;
const money = formatMoney;
const today = () => { const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 10); };
const actorName = () => document.body.dataset.actor || 'Principessa';
function asDate(value) { if (!value) return null; const d = new Date(value + 'T12:00:00'); return Number.isNaN(d.getTime()) ? null : d; }
function dayDiff(a,b){ return Math.round((b-a)/86400000); }
function timing(meta){
  const start=asDate(meta?.start),end=asDate(meta?.end),now=asDate(today()); if(!start||!end)return'';
  if(now<start){const days=Math.max(1,dayDiff(now,start));return `Starts in ${days} day${days===1?'':'s'}`;}
  if(now<=end){const total=Math.max(1,dayDiff(start,end)+1),day=Math.max(1,Math.min(total,dayDiff(start,now)+1));return `Day ${day} of ${total}`;}
  return 'Past trip';
}
function shortRange(start,end){const a=asDate(start),b=asDate(end);if(!a||!b)return'';const am=a.toLocaleDateString('en-GB',{month:'short'}),bm=b.toLocaleDateString('en-GB',{month:'short'});return am===bm?`${a.getDate()}–${b.getDate()} ${bm}`:`${a.getDate()} ${am}–${b.getDate()} ${bm}`;}
function displayMoney(value,_forceCents=false){return money(value);}
function categoryInfo(entry){
  if(entry?.category==='accommodation')return['Stay','🛏'];
  if(entry?.category==='transport')return[isCarExpense(entry)?'Car · '+carExpenseLabel(entry):'Transport',isCarExpense(entry)?'⛽':'✈️'];
  if(entry?.category==='food')return[entry?.foodType==='groceries'?'Groceries':entry?.foodType==='eating-out'?'Eating out':'Food',entry?.foodType==='groceries'?'🛒':'🍝'];
  if(entry?.category==='activities')return['Activities','🎟'];
  return[entry?.name||entry?.note||'Other','•'];
}
function settlementLine(plan){
  const paid={Principessa:0,Principe:0},share={Principessa:0,Principe:0};
  for(const entry of entries(plan)){const amount=Math.max(0,n(entry.amount)-n(entry.jarContribution));if(entry.paidBy==='both'){paid.Principessa+=amount/2;paid.Principe+=amount/2}else if(paid[entry.paidBy]!=null)paid[entry.paidBy]+=amount;if(entry.split==='personal')share[entry.forActor==='Principe'?'Principe':'Principessa']+=amount;else{share.Principessa+=amount/2;share.Principe+=amount/2}}
  const d=paid.Principessa-share.Principessa,me=actorName();if(Math.abs(d)<.005)return 'You’re even';
  const creditor=d>0?'Principessa':'Principe',debtor=d>0?'Principe':'Principessa',amount=Math.abs(d);
  if(me===creditor)return `${debtor} owes you ${displayMoney(amount,true)}`;
  if(me===debtor)return `You owe ${creditor} ${displayMoney(amount,true)}`;
  return `${debtor} owes ${creditor} ${displayMoney(amount,true)}`;
}

const EXPENSE_CATS = [
  ['stay','Stay','🛏'],['transport','Transport','✈️'],['car','Car','⛽'],
  ['groceries','Groceries','🛒'],['eating-out','Eating out','🍝'],['activities','Activities','🎟'],['other','Other','•'],
];
function closeExpenseSheet(){
  expenseLayer?.remove(); expenseLayer=null; document.body.classList.remove('tv2-locked');
}
function tripSnack(message){
  let el=document.querySelector('.overview-trip-snack');
  if(!el){el=document.createElement('div');el.className='overview-trip-snack';el.setAttribute('role','status');document.body.appendChild(el);}
  el.textContent=message;el.classList.add('show');clearTimeout(snackTimer);snackTimer=setTimeout(()=>el.classList.remove('show'),2600);
}
function mapExpenseCategory(key){
  if(key==='stay')return{category:'accommodation',foodType:'',transportType:'',useJar:true};
  if(key==='transport')return{category:'transport',foodType:'',transportType:'other',useJar:false};
  if(key==='car')return{category:'transport',foodType:'',transportType:'fuel',useJar:false};
  if(key==='groceries')return{category:'food',foodType:'groceries',transportType:'',useJar:false};
  if(key==='eating-out')return{category:'food',foodType:'eating-out',transportType:'',useJar:false};
  if(key==='activities')return{category:'activities',foodType:'',transportType:'',useJar:false};
  return{category:'other',foodType:'',transportType:'',useJar:false};
}
function openExpenseSheet(plan){
  closeExpenseSheet();
  const me=actorName(),other=me==='Principessa'?'Principe':'Principessa';
  const state={amountText:'',category:'',paidBy:me,split:'shared',forActor:me,date:today(),note:'',uncertain:false,useJar:true,more:false,busy:false,error:'',mounted:false};
  const amount=()=>Number(String(state.amountText||'').replace(',','.'));
  const validAmount=()=>Number.isFinite(amount())&&amount()>0;
  const availableJar=()=>n(latest?.sharedJar?.balance);
  const mapping=()=>mapExpenseCategory(state.category);
  const jarValue=()=>state.category==='stay'&&state.useJar&&validAmount()?amount()*.2:0;
  const canSave=()=>validAmount()&&!!state.category&&(state.category!=='stay'||!state.useJar||jarValue()<=availableJar()+.005);
  const summary=()=>{
    const payer=state.paidBy===me?'Paid by you':state.paidBy==='both'?'Each paid half':'Paid by '+state.paidBy;
    const split=state.paidBy==='both'?'':state.split==='shared'?'split 50/50':state.forActor===me?'just you':'just '+other;
    const date=state.date===today()?'today':fmtDate(state.date);
    return[payer,split,date,state.uncertain?'estimate':''].filter(Boolean).join(' · ');
  };
  const html=()=>tripSheetHtml({
    title:'Add expense',
    closeAttr:'data-close',
    amountId:'tv2Amount',
    amountValue:state.amountText,
    categoriesHtml:EXPENSE_CATS.map(([k,l,i])=>'<button type="button" class="tv2-cat '+(state.category===k?'on':'')+'" data-cat="'+k+'" aria-pressed="'+(state.category===k?'true':'false')+'"><span aria-hidden="true">'+i+'</span>'+esc(l)+'</button>').join(''),
    afterCategoriesHtml:'<div class="tv2-jar-slot"></div>',
    defaultsHtml:'<button type="button" class="tv2-defaults" data-more aria-expanded="'+(state.more?'true':'false')+'"><span class="tv2-summary">'+esc(summary())+'</span><span class="tv2-chev" aria-hidden="true">'+(state.more?'⌃':'⌄')+'</span></button>',
    moreHtml:'<div class="tv2-more" '+(state.more?'':'hidden')+'>'+
      '<div class="tv2-field"><span>Paid by</span><div class="tv2-seg">'+
        [[me,'You'],[other,other],['both','Each paid half']].map(([k,l])=>'<button type="button" data-payer="'+k+'" class="'+(state.paidBy===k?'on':'')+'">'+esc(l)+'</button>').join('')+
      '</div></div>'+
      '<div class="tv2-field" '+(state.paidBy==='both'?'hidden':'')+'><span>For</span><div class="tv2-seg">'+
        [['shared','Shared 50/50'],[me,'Just you'],[other,'Just '+other]].map(([k,l])=>'<button type="button" data-split="'+k+'" class="'+((k==='shared'&&state.split==='shared')||(k!=='shared'&&state.split==='personal'&&state.forActor===k)?'on':'')+'">'+esc(l)+'</button>').join('')+
      '</div></div>'+
      '<label class="tv2-field"><span>Date</span><input type="date" id="tv2Date" value="'+esc(state.date)+'"></label>'+
      '<label class="tv2-field"><span>Note</span><input id="tv2Note" maxlength="180" placeholder="e.g. dinner by the canal" value="'+esc(state.note)+'"></label>'+
      '<label class="tv2-check"><input type="checkbox" id="tv2Est" '+(state.uncertain?'checked':'')+'> This amount is an estimate</label>'+
    '</div>',
    saveAttr:'data-save',
    saveLabel:'Save',
  });

  expenseLayer=document.createElement('div');
  expenseLayer.className='tv2-layer';
  expenseLayer.innerHTML='<div class="tv2-backdrop" data-close></div><div class="tv2-sheet" role="dialog" aria-modal="true"></div>';
  (dialog || document.body).appendChild(expenseLayer);document.body.classList.add('tv2-locked');

  const sheet=expenseLayer.querySelector('.tv2-sheet');
  function refreshLive(){
    const slot=sheet.querySelector('.tv2-jar-slot');
    if(state.category==='stay'){
      if(availableJar()<=0) slot.innerHTML='<div class="tv2-jar is-off"><span>Shared Jar has '+displayMoney(availableJar(),true)+' available</span></div>';
      else if(state.useJar) slot.innerHTML='<div class="tv2-jar"><span>Shared Jar pays <b>'+(validAmount()?displayMoney(jarValue(),true):'20%')+'</b> (20%)</span><button type="button" data-jar="off">Remove</button></div>';
      else slot.innerHTML='<div class="tv2-jar is-off"><span>Shared Jar not used</span><button type="button" data-jar="on">Use 20%</button></div>';
    } else slot.innerHTML='';
    const sm=sheet.querySelector('.tv2-summary');if(sm)sm.textContent=summary();
    const hint=sheet.querySelector('.tv2-hint'),save=sheet.querySelector('[data-save]');
    save.disabled=!canSave()||state.busy;save.textContent=state.busy?'Saving…':'Save';
    hint.textContent=state.error||(state.amountText&&!validAmount()?'That amount doesn’t look right':!validAmount()?'Enter the amount':!state.category?'Pick a category':state.category==='stay'&&state.useJar&&jarValue()>availableJar()+.005?'Not enough in the Shared Jar.':'');
    hint.classList.toggle('is-error',!!state.error||(!!state.amountText&&!validAmount())||(state.category==='stay'&&state.useJar&&jarValue()>availableJar()+.005));
  }
  function mount(){
    sheet.innerHTML=html();
    const input=sheet.querySelector('#tv2Amount');
    input.addEventListener('input',()=>{state.amountText=input.value;state.error='';refreshLive();});
    input.addEventListener('keydown',(e)=>{if(e.key==='Enter'){e.preventDefault();if(canSave())save();}});
    sheet.querySelector('#tv2Date')?.addEventListener('change',(e)=>{state.date=e.target.value||today();refreshLive();});
    sheet.querySelector('#tv2Note')?.addEventListener('input',(e)=>{state.note=e.target.value;});
    sheet.querySelector('#tv2Est')?.addEventListener('change',(e)=>{state.uncertain=e.target.checked;refreshLive();});
    sheet.onclick=(e)=>{
      const b=e.target.closest('button');if(!b)return;
      if(b.hasAttribute('data-close')){closeExpenseSheet();return;}
      if(b.dataset.cat){state.category=b.dataset.cat;if(state.category!=='stay')state.useJar=false;sheet.querySelectorAll('[data-cat]').forEach(x=>{x.classList.toggle('on',x===b);x.setAttribute('aria-pressed',String(x===b));});refreshLive();return;}
      if(b.dataset.jar){state.useJar=b.dataset.jar==='on';refreshLive();return;}
      if(b.hasAttribute('data-more')){state.more=!state.more;mount();return;}
      if(b.dataset.payer){state.paidBy=b.dataset.payer;if(state.paidBy==='both')state.split='shared';mount();return;}
      if(b.dataset.split){if(b.dataset.split==='shared'){state.split='shared';}else{state.split='personal';state.forActor=b.dataset.split;}mount();return;}
      if(b.hasAttribute('data-save')){save();return;}
    };
    refreshLive();
    if(!state.mounted){state.mounted=true;setTimeout(()=>input.focus(),0);}
  }
  async function save(){
    if(!canSave()||state.busy)return;
    state.busy=true;state.error='';refreshLive();
    const mapped=mapping();
    try{
      await window.TwogetherAPI.post('saveTripExpense',{planId:plan.id,expense:{
        id:'',category:mapped.category,foodType:mapped.foodType,transportType:mapped.transportType,name:'',
        amount:amount(),paidBy:state.paidBy,split:state.paidBy==='both'?'shared':state.split,
        forActor:state.split==='personal'?state.forActor:'',date:state.date||today(),note:state.note.trim(),
        uncertain:!!state.uncertain,useJar:state.category==='stay'&&!!state.useJar
      }},actorName());
      await refresh(true);
      const updated=latest?.plans?.find((item)=>item.id===plan.id)||plan;
      closeExpenseSheet();draw(updated);
      tripSnack(displayMoney(amount(),true)+' '+(EXPENSE_CATS.find(x=>x[0]===state.category)?.[1]||'expense').toLowerCase()+' added');
    }catch(err){
      state.busy=false;state.error=err?.message||'Could not save. Check your connection and try again.';refreshLive();
    }
  }
  expenseLayer.querySelector('.tv2-backdrop').onclick=closeExpenseSheet;
  expenseLayer.addEventListener('keydown',(e)=>{if(e.key==='Escape')closeExpenseSheet();});
  mount();
}

function expenseTimeline(plan){
  const list=entries(plan).slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  const grouped=new Map();
  for(const entry of list){const key=entry.date||today();if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(entry);}
  const groups=[...grouped.entries()].map(([date,items])=>({label:date===today()?'Today':fmtDate(date),items}));
  return tripTimelineHtml(groups,{
    emptyText:'No expenses yet. Add them as they happen, it takes a few seconds.',
    rowHtml:(entry)=>{
      const [label,icon]=categoryInfo(entry);
      const payer=entry.paidBy===actorName()?'you':entry.paidBy==='both'?'each paid half':entry.paidBy;
      const jar=entry.jarContribution?' · '+displayMoney(entry.jarContribution,true)+' from Jar':'';
      return tripExpenseRowHtml({
        attr:'data-trip-entry="'+esc(entry.id)+'"',
        icon,
        title:entry.note||entry.name||label,
        meta:payer+jar,
        amount:displayMoney(entry.amount,true),
      });
    },
  });
}

let latest = null, dialog = null, opened = null, refreshing = false, lastRefresh = 0, busy = false, expenseLayer = null, snackTimer = null;

function rowByKey(key) { return rows.find((row) => row.key === key) || null; }
function records(plan, trip) { return names.map((name) => trip?.submissions?.[name] || plan?.partials?.[name] || {}); }
function entries(plan) { return Array.isArray(plan?.expenseEntries) ? plan.expenseEntries : []; }
function rowEntries(plan, row) {
  return entries(plan).filter((entry) => entry?.category === row.category && (row.category !== 'transport' || isCarExpense(entry) === (row.car === true)));
}
function rowForExpense(entry) {
  return rows.find((row)=>row.category===entry.category&&(row.category!=='transport'||isCarExpense(entry)===(row.car===true)))||rows[rows.length-1];
}
function sharedFor(plan, trip, key) { return plan?.sharedExpenses?.[key] || trip?.sharedExpenses?.[key] || null; }

function legacyPaid(plan, trip, row, name) {
  const record = trip?.submissions?.[name] || plan?.partials?.[name] || {};
  return row.legacy.reduce((sum, key) => {
    const shared = sharedFor(plan, trip, key);
    if (has(shared?.paid?.[name])) return sum + n(shared.paid[name]);
    return sum + (has(record?.[key]) ? n(record[key]) : 0);
  }, 0);
}

function entryPaid(entry, name) {
  const remaining = Math.max(0, n(entry?.amount) - n(entry?.jarContribution));
  if (entry?.paidBy === 'both') return remaining / 2;
  return entry?.paidBy === name ? remaining : 0;
}

function rowPaid(plan, trip, row, name) {
  return legacyPaid(plan, trip, row, name) + rowEntries(plan, row).reduce((sum, entry) => sum + entryPaid(entry, name), 0);
}

function legacyTotal(plan, trip) {
  const [a, b] = records(plan, trip);
  return legacyKeys.reduce((sum, key) => {
    const shared = sharedFor(plan, trip, key);
    const gross = has(shared?.total) ? n(shared.total) : Math.max(n(a?.[key]), n(b?.[key]));
    const jar = key === 'accom' ? Math.min(gross, Math.max(0, n(shared?.accommodation?.jarContribution))) : 0;
    return sum + Math.max(0, gross - jar);
  }, 0);
}

function total(plan, trip) {
  return legacyTotal(plan, trip) + entries(plan).reduce((sum, entry) => {
    const gross = Math.max(0, n(entry?.amount));
    const jar = Math.min(gross, Math.max(0, n(entry?.jarContribution)));
    return sum + (gross - jar);
  }, 0);
}

function metrics(plan, trip) {
  return '<div class="overview-metrics">' +
    names.map((name) => '<div><span>' + name + ' budget</span><strong>' + (has(plan?.budgets?.[name]) ? money(plan.budgets[name]) : 'Not set') + '</strong></div>').join('') +
    '<div><span>Total budget</span><strong>' + (names.some((name) => has(plan?.budgets?.[name])) ? money(names.reduce((sum, name) => sum + n(plan.budgets[name]), 0)) : has(trip?.budget) ? money(trip.budget) : 'Not set') + '</strong></div>' +
    '<div><span>Trip so far</span><strong>' + money(total(plan, trip)) + '</strong></div></div>';
}

function budgetSplit(plan, trip) {
  const principessaSet = has(plan?.budgets?.Principessa);
  const principeSet = has(plan?.budgets?.Principe);
  const principessa = principessaSet ? n(plan.budgets.Principessa) : 0;
  const principe = principeSet ? n(plan.budgets.Principe) : 0;
  const splitTotal = principessa + principe;
  const totalBudget = splitTotal || (has(trip?.budget) ? n(trip.budget) : 0);
  const share = splitTotal > 0 ? Math.max(0, Math.min(100, (principessa / splitTotal) * 100)) : 0;
  const hasBudget = principessaSet || principeSet || has(trip?.budget);
  return '<div class="overview-budget-split">' +
    '<div class="overview-budget-donut' + (splitTotal > 0 ? '' : ' empty') + '" style="--principessa-share:' + share.toFixed(2) + '%"><div><span>Total</span><strong>' + (hasBudget ? money(totalBudget) : '—') + '</strong></div></div>' +
    '<div class="overview-budget-breakdown">' +
      '<span class="principessa"><i></i><em>Principessa</em><strong>' + (principessaSet ? money(principessa) : 'Not set') + '</strong></span>' +
      '<span class="principe"><i></i><em>Principe</em><strong>' + (principeSet ? money(principe) : 'Not set') + '</strong></span>' +
    '</div></div>';
}

function warnings(plan, trip) {
  const result = [];
  for (const key of ['accom', 'travel']) {
    const shared = sharedFor(plan, trip, key);
    if (!shared?.mode || !names.some((name) => shared.mode[name])) continue;
    if (names.every((name) => has(shared.totals?.[name])) && Math.abs(n(shared.totals.Principessa) - n(shared.totals.Principe)) > 0.005) result.push((legacyLabels[key] || key) + ': different totals are still saved.');
  }
  return result;
}

function rowMatch(plan, trip, row) {
  const [a, b] = records(plan, trip);
  let sawLegacy = false, incomplete = false, conflict = false;
  for (const key of row.legacy) {
    const av = a?.[key], bv = b?.[key], ah = has(av), bh = has(bv);
    const shared = sharedFor(plan, trip, key);
    if (ah || bh || shared) sawLegacy = true;
    if (ah !== bh) incomplete = true;
    if (ah && bh && Math.abs(n(av) - n(bv)) > 0.005) conflict = true;
    if (names.some((name) => has(shared?.totals?.[name]))) {
      const ph = has(shared?.totals?.Principessa), qh = has(shared?.totals?.Principe);
      if (ph !== qh) incomplete = true;
      if (ph && qh && Math.abs(n(shared.totals.Principessa) - n(shared.totals.Principe)) > 0.005) conflict = true;
    }
  }
  if (conflict) return { cls: 'different', symbol: '×', text: 'Different' };
  if (incomplete) return { cls: 'waiting', symbol: '~', text: 'Incomplete' };
  if (rowEntries(plan, row).length || sawLegacy) return { cls: 'matched', symbol: '✓', text: 'Matched' };
  return { cls: 'waiting', symbol: '~', text: 'Incomplete' };
}

function matchCell(status) {
  return '<span class="overview-match ' + status.cls + '"><i>' + status.symbol + '</i>' + status.text + '</span>';
}

function overviewCardKey(id = opened) { return id ? 'trip-overview:'+id : ''; }
function close() { dialog?.remove(); dialog = null; opened = null; }
function dismissOverview() {
  const key=overviewCardKey();
  if(key)dismissCardView(key);
  close();
}
function backFromOverview(plan) {
  backFromCardView(overviewCardKey(plan?.id),close);
}
export function open(plan) {
  if (!plan) return;
  opened = plan.id;
  rememberCardView(overviewCardKey(plan.id),()=>{
    openSheet('log');
    const latestPlan=(latest?.plans||[]).find((item)=>item.id===plan.id)||plan;
    open(latestPlan);
  });
  draw(plan);
}

function hero(plan, trip) {
  const meta=plan?.meta||{},spent=total(plan,trip);
  const splitBudget=names.reduce((sum,name)=>sum+(has(plan?.budgets?.[name])?n(plan.budgets[name]):0),0);
  const available=splitBudget||(has(trip?.budget)?n(trip.budget):0),left=available-spent,pct=available>0?Math.max(0,Math.min(100,(spent/available)*100)):0;
  const mine=plan?.budgets?.[actorName()];
  return '<header class="overview-trip-head"><div class="overview-trip-nav"><button type="button" data-overview-back>‹ Trips</button><button type="button" data-overview-edit>Edit</button></div><h2>'+esc(meta.city||'Current trip')+'</h2><p>'+esc(shortRange(meta.start,meta.end))+(timing(meta)?' · '+esc(timing(meta)):'')+'</p></header>'+
    '<section class="overview-trip-money"><div class="overview-trip-figures"><button type="button" data-overview-budget><span>Available ›</span><strong>'+(available>0?displayMoney(available):'Not set')+'</strong>'+(!has(mine)?'<small>+ add yours</small>':'')+'</button><div><span>Spent</span><strong>'+displayMoney(spent)+'</strong></div></div>'+(available>0?'<span class="overview-trip-progress"><i style="width:'+pct.toFixed(1)+'%"></i></span><div class="overview-trip-left '+(left<0?'over':'')+'"><strong>'+displayMoney(Math.abs(left))+'</strong><span>'+(left<0?'over budget':'left')+'</span></div>':'')+'</section>';
}

function draw(plan) {
  dialog?.remove();
  dialog=document.createElement('dialog');
  dialog.className='current-overview current-overview-trip';
  const trip=latest?.trips?.find((item)=>item.id===plan.linkedTripId);
  const meta=plan?.meta||{},spent=total(plan,trip);
  const splitBudget=names.reduce((sum,name)=>sum+(has(plan?.budgets?.[name])?n(plan.budgets[name]):0),0);
  const available=splitBudget||(has(trip?.budget)?n(trip.budget):0);
  const left=available-spent;
  const pct=available>0?Math.max(0,Math.min(100,(spent/available)*100)):null;
  const mine=plan?.budgets?.[actorName()];
  const balanceLine=settlementLine(plan),balanceClass=balanceLine==='You’re even'?' is-even':balanceLine.startsWith('You owe ')?' is-debtor':'';

  dialog.innerHTML=tripDetailShellHtml({
    back:{attr:'data-overview-back',label:'‹ Trips'},
    right:{attr:'data-overview-edit',label:'Edit'},
    title:meta.city||'Current trip',
    subtitle:shortRange(meta.start,meta.end)+(timing(meta)?' · '+timing(meta):''),
    moneyHtml:tripDetailMoneyHtml({
      first:{label:'Available ›',value:available>0?displayMoney(available):'Not set',button:true,attr:'data-overview-budget',extraHtml:!has(mine)?'<small>+ add yours</small>':''},
      second:{label:'Spent',value:displayMoney(spent)},
      progress:pct,
      summary:available>0?{value:displayMoney(Math.abs(left)),label:left<0?'over budget':'left',over:left<0}:null,
    }),
    middleHtml:'<button type="button" class="overview-trip-balance'+balanceClass+'"><span>'+esc(balanceLine)+'</span><b>›</b></button>',
    listHtml:expenseTimeline(plan),
    dock:{attr:'data-overview-add',label:'＋ Add expense'},
  });
  document.body.appendChild(dialog);dialog.showModal();
  dialog._twogetherBack=()=>backFromOverview(plan);
  dialog._twogetherHome=dismissOverview;
  dialog.addEventListener('cancel',(event)=>{event.preventDefault();backFromOverview(plan);});
  dialog.querySelector('[data-overview-back]').onclick=()=>backFromOverview(plan);
  dialog.querySelector('[data-overview-edit]').onclick=()=>window.TwogetherWorkflow?.budget(plan.id);
  dialog.querySelector('[data-overview-budget]').onclick=()=>window.TwogetherWorkflow?.budget(plan.id);
  dialog.querySelector('[data-overview-add]').onclick=()=>openExpenseSheet(plan);
  dialog.querySelectorAll('[data-trip-entry]').forEach((button)=>button.onclick=()=>{const entry=entries(plan).find((item)=>item.id===button.dataset.tripEntry);if(!entry)return;const row=rowForExpense(entry);drawCategory(plan,row.key,entry.id,true);});
}

function subtypeLabel(row, entry) {
  if (!row?.subtypes?.length) return row?.label || 'Expense';
  const value = row.category === 'transport' ? entry?.transportType : entry?.foodType;
  const normalized = value;
  return normalized==='parking-tolls'?'Tolls / Parking':(row.subtypes.find(([key]) => key === normalized)?.[1] || row.label);
}

function entryTitle(row, entry) {
  return entry?.name || subtypeLabel(row, entry) || entry?.note || row.label;
}

function entryMeta(row, entry) {
  const paid = entry?.paidBy === 'both' ? 'Both paid' : 'Paid by ' + (entry?.paidBy || '—');
  const split = entry?.split === 'personal' ? 'Personal · ' + (entry?.forActor || entry?.paidBy || '—') : 'Shared 50/50';
  const parts = [subtypeLabel(row, entry), paid, split, fmtDate(entry?.date)];
  if (entry?.uncertain) parts.push('estimate');
  if (entry?.jarContribution) parts.push('Jar ' + money(entry.jarContribution));
  return parts.filter(Boolean).join(' · ');
}

function categoryEntriesHtml(plan, row) {
  const list = rowEntries(plan, row);
  if (!list.length) return '<div class="overview-category-empty"><strong>Nothing logged here yet.</strong><span>Your next saved expense will appear here.</span></div>';
  return '<div class="overview-category-list">' + list.slice().reverse().map((entry) =>
    '<div class="overview-category-entry"><button type="button" class="overview-entry-main" data-entry-edit="' + esc(entry.id) + '"><span><strong>' + esc(entryTitle(row, entry)) + '</strong><small>' + esc(entryMeta(row, entry)) + '</small></span><b>' + money(entry.amount) + '</b></button><button type="button" class="overview-entry-delete" data-entry-delete="' + esc(entry.id) + '">Delete</button></div>'
  ).join('') + '</div>';
}

function blankDraft(row, subtype = '') {
  return { id: '', category: row.category, foodType: row.category === 'food' ? subtype : '', transportType: row.category === 'transport' ? (row.car ? 'fuel' : (subtype||'flights-trains')) : '', name: '', amount: '', paidBy: document.body.dataset.actor || 'Principessa', split: 'shared', forActor: document.body.dataset.actor || 'Principessa', date: today(), note: '', uncertain: false, useJar: false, showMore: false };
}

function draftFromEntry(entry) {
  return {
    ...entry,
    name: entry?.name || '',
    foodType: entry?.foodType || '',
    transportType: entry?.transportType || '',
    amount: String(entry?.amount ?? ''),
    date: entry?.date || today(),
    note: entry?.note || '',
    showMore: !!(entry?.note || entry?.uncertain || (entry?.date && entry.date !== today())),
  };
}

function formSubtype(row, draft) {
  if (!row.subtypes?.length) return '';
  const current = row.category === 'transport' ? draft.transportType : draft.foodType;
  return '<fieldset><legend>' + esc(row.label) + ' type</legend><div class="overview-form-chips">' + (row.car&&draft.transportType==='parking-tolls'?[...row.subtypes,['parking-tolls','Tolls / Parking (older)']]:row.subtypes).map(([key, label]) => '<button type="button" class="' + (current === key ? 'active' : '') + '" data-form-subtype="' + key + '">' + esc(label) + '</button>').join('') + '</div></fieldset>';
}

function categoryFormHtml(plan, row, draft, entry) {
  const available = n(latest?.sharedJar?.balance) + n(entry?.jarContribution);
  const jar = draft.useJar && row.category === 'accommodation' ? n(draft.amount) * .2 : 0;
  const needsName = row.customName || draft.foodType === 'other' || draft.transportType === 'car-other' || (draft.transportType === 'other' && !row.car);
  return '<div class="overview-expense-form">' +
    formSubtype(row, draft) +
    '<label data-form-name-wrap class="' + (needsName ? '' : 'hidden') + '">Expense name<input id="overviewExpenseName" value="' + esc(draft.name || '') + '" placeholder="Write your own"></label>' +
    '<label>Amount<div class="overview-money-input"><span>€</span><input id="overviewExpenseAmount" inputmode="decimal" value="' + esc(draft.amount || '') + '" placeholder="0"></div></label>' +
    '<fieldset><legend>Who paid?</legend><div class="overview-form-chips">' + names.concat('both').map((value) => '<button type="button" class="' + (draft.paidBy === value ? 'active' : '') + '" data-form-payer="' + value + '">' + (value === 'both' ? 'Both' : value) + '</button>').join('') + '</div></fieldset>' +
    '<fieldset><legend>How should we count it?</legend><div class="overview-form-chips"><button type="button" class="' + (draft.split === 'shared' ? 'active' : '') + '" data-form-split="shared">Shared 50/50</button><button type="button" class="' + (draft.split === 'personal' ? 'active' : '') + '" data-form-split="personal">Personal</button></div></fieldset>' +
    '<fieldset data-form-owner-wrap class="' + (draft.split === 'personal' ? '' : 'hidden') + '"><legend>Personal expense for</legend><div class="overview-form-chips">' + names.map((value) => '<button type="button" class="' + (draft.forActor === value ? 'active' : '') + '" data-form-owner="' + value + '">' + value + '</button>').join('') + '</div></fieldset>' +
    (row.category === 'accommodation' ? '<button type="button" class="overview-jar-toggle ' + (draft.useJar ? 'active' : '') + '" data-form-jar><span><strong>Use 20% from Shared Jar</strong><small>Accommodation only · ' + money(available) + ' available</small></span><b data-form-jar-value>' + (draft.useJar ? money(jar) + ' from Jar' : 'Off') + '</b></button>' : '') +
    '<button type="button" class="overview-more" data-form-more aria-expanded="' + (draft.showMore ? 'true' : 'false') + '"><span>' + (draft.showMore ? '⌃' : '⌄') + '</span> More options</button>' +
    '<div class="overview-more-fields ' + (draft.showMore ? '' : 'hidden') + '"><label>Date<input id="overviewExpenseDate" type="date" value="' + esc(draft.date || today()) + '"></label><label>Note <small>optional</small><input id="overviewExpenseNote" value="' + esc(draft.note || '') + '" placeholder="Add a note"></label><label class="overview-estimate"><input id="overviewExpenseEstimate" type="checkbox" ' + (draft.uncertain ? 'checked' : '') + '><span>This amount is an estimate</span></label></div>' +
    '<div class="overview-form-actions">' + (draft.id ? '<button type="button" class="btn ghost" data-form-cancel>Cancel edit</button>' : '') + '<button type="button" class="btn primary" data-form-save>' + (draft.id ? 'Save changes' : 'Save expense') + '</button></div><p data-overview-error class="overview-form-error" role="status"></p></div>';
}

function historyHtml(plan, row, expanded) {
  const list = rowEntries(plan, row);
  const currentTotal = list.reduce((sum, entry) => sum + n(entry?.amount), 0);
  if (!list.length) return '<aside class="overview-history-panel"><div class="overview-history-title"><span>Logged expenses</span><strong>Nothing yet</strong></div><p>Add an expense on the left and it will appear here.</p></aside>';
  return '<aside class="overview-history-panel"><button type="button" class="overview-history-summary" data-history-open><span><small>Logged expenses</small><strong>' + list.length + (list.length === 1 ? ' expense' : ' expenses') + '</strong></span><b>' + money(currentTotal) + '</b><i>' + (list.length === 1 ? 'Edit' : (expanded ? 'Hide' : 'View')) + ' →</i></button>' +
    (expanded && list.length > 1 ? categoryEntriesHtml(plan, row) : '') + '</aside>';
}

function drawCategory(plan, key, editId = '', expandedHistory = false) {
  const row = rowByKey(key); if (!row || !dialog) return;
  const selected = editId ? entries(plan).find((item) => item.id === editId) || null : null;
  let draft = selected ? draftFromEntry(selected) : blankDraft(row);
  let expanded = expandedHistory;

  const render = () => {
    const trip = latest?.trips?.find((item) => item.id === plan.linkedTripId);
    const currentEntry = draft.id ? entries(plan).find((item) => item.id === draft.id) || selected : null;
    dialog.innerHTML = '<button class="trip-close" data-overview-close aria-label="Close overview">×</button><div class="overview-shell">' + hero(plan, trip) +
      '<div class="overview-scroll"><button type="button" class="overview-back" data-category-back>← Back to expenses</button><div class="overview-category-head"><div><span class="panel-kicker">EXPENSES</span><h3>' + esc(row.label) + '</h3><p>' + (draft.id ? 'Editing a logged expense.' : 'Log a new expense and the category total updates automatically.') + '</p></div>' + matchCell(rowMatch(plan, trip, row)) + '</div>' +
      '<div class="overview-category-layout"><section class="overview-quick-log"><div class="overview-quick-log-head"><span>' + (draft.id ? 'EDIT EXPENSE' : 'QUICK LOG') + '</span><strong>' + (draft.id ? esc(entryTitle(row, currentEntry || draft)) : 'Add to ' + esc(row.label)) + '</strong></div>' + categoryFormHtml(plan, row, draft, currentEntry) + '</section>' +
      historyHtml(plan, row, expanded) + '</div></div></div>';

    dialog._twogetherBack=()=>draw(plan);
    dialog._twogetherHome=dismissOverview;
    dialog.querySelector('[data-overview-close]').onclick = dismissOverview;
    dialog.querySelector('[data-overview-back]').onclick = () => backFromOverview(plan);
    dialog.querySelector('[data-category-back]').onclick = () => draw(plan);

    const amount = dialog.querySelector('#overviewExpenseAmount');
    const syncChoices = () => {
      dialog.querySelectorAll('[data-form-subtype]').forEach((button) => {
        const current = row.category === 'transport' ? draft.transportType : draft.foodType;
        button.classList.toggle('active', current === button.dataset.formSubtype);
      });
      dialog.querySelectorAll('[data-form-payer]').forEach((button) => button.classList.toggle('active', draft.paidBy === button.dataset.formPayer));
      dialog.querySelectorAll('[data-form-split]').forEach((button) => button.classList.toggle('active', draft.split === button.dataset.formSplit));
      dialog.querySelectorAll('[data-form-owner]').forEach((button) => button.classList.toggle('active', draft.forActor === button.dataset.formOwner));

      const needsName = row.customName || draft.foodType === 'other' || draft.transportType === 'car-other' || (draft.transportType === 'other' && !row.car);
      dialog.querySelector('[data-form-name-wrap]')?.classList.toggle('hidden', !needsName);
      dialog.querySelector('[data-form-owner-wrap]')?.classList.toggle('hidden', draft.split !== 'personal');

      const more = dialog.querySelector('[data-form-more]');
      const moreFields = dialog.querySelector('.overview-more-fields');
      if (more) {
        more.setAttribute('aria-expanded', draft.showMore ? 'true' : 'false');
        const icon = more.querySelector('span'); if (icon) icon.textContent = draft.showMore ? '⌃' : '⌄';
      }
      moreFields?.classList.toggle('hidden', !draft.showMore);

      const jarButton = dialog.querySelector('[data-form-jar]');
      if (jarButton) {
        jarButton.classList.toggle('active', !!draft.useJar);
        const jarValue = jarButton.querySelector('[data-form-jar-value]');
        if (jarValue) jarValue.textContent = draft.useJar ? money(n(draft.amount) * .2) + ' from Jar' : 'Off';
      }
    };

    amount?.addEventListener('input', (event) => { draft.amount = event.target.value; syncChoices(); });
    dialog.querySelector('#overviewExpenseName')?.addEventListener('input', (event) => { draft.name = event.target.value; });
    dialog.querySelector('#overviewExpenseDate')?.addEventListener('input', (event) => { draft.date = event.target.value; });
    dialog.querySelector('#overviewExpenseNote')?.addEventListener('input', (event) => { draft.note = event.target.value; });
    dialog.querySelector('#overviewExpenseEstimate')?.addEventListener('change', (event) => { draft.uncertain = event.target.checked; });

    dialog.querySelectorAll('[data-form-subtype]').forEach((button) => button.onclick = () => {
      if (row.category === 'transport') draft.transportType = button.dataset.formSubtype;
      else draft.foodType = button.dataset.formSubtype;
      syncChoices();
      if ((draft.foodType === 'other' || draft.transportType === 'other' || draft.transportType==='car-other') && !draft.name) {
        requestAnimationFrame(() => dialog.querySelector('#overviewExpenseName')?.focus());
      }
    });
    dialog.querySelectorAll('[data-form-payer]').forEach((button) => button.onclick = () => {
      draft.paidBy = button.dataset.formPayer;
      if (draft.paidBy === 'both' && draft.split === 'personal') draft.split = 'shared';
      syncChoices();
    });
    dialog.querySelectorAll('[data-form-split]').forEach((button) => button.onclick = () => {
      draft.split = button.dataset.formSplit;
      if (draft.split === 'personal' && draft.paidBy === 'both') draft.paidBy = document.body.dataset.actor || 'Principessa';
      syncChoices();
    });
    dialog.querySelectorAll('[data-form-owner]').forEach((button) => button.onclick = () => {
      draft.forActor = button.dataset.formOwner;
      syncChoices();
    });
    dialog.querySelector('[data-form-jar]')?.addEventListener('click', () => {
      draft.useJar = !draft.useJar;
      syncChoices();
    });
    dialog.querySelector('[data-form-more]').onclick = () => {
      draft.showMore = !draft.showMore;
      syncChoices();
    };
    dialog.querySelector('[data-form-cancel]')?.addEventListener('click', () => {
      draft = blankDraft(row);
      render();
    });
    dialog.querySelector('[data-form-save]').onclick = () => saveEntry(plan, row, draft);

    const historyButton = dialog.querySelector('[data-history-open]');
    if (historyButton) historyButton.onclick = () => {
      const list = rowEntries(plan, row);
      if (list.length === 1) {
        draft = draftFromEntry(list[0]);
        expanded = false;
        render();
      } else {
        expanded = !expanded;
        render();
      }
    };
    dialog.querySelectorAll('[data-entry-edit]').forEach((button) => button.onclick = () => {
      const entry = entries(plan).find((item) => item.id === button.dataset.entryEdit);
      if (!entry) return;
      draft = draftFromEntry(entry);
      render();
    });
    dialog.querySelectorAll('[data-entry-delete]').forEach((button) => button.onclick = () => deleteEntry(plan, row, button));
    syncChoices();
    if (!draft.id && row.subtypes?.length === 0) setTimeout(() => amount?.focus(), 0);
  };

  render();
}

async function saveEntry(plan, row, draft) {
  if (busy) return;
  const error = dialog?.querySelector('[data-overview-error]');
  const amount = Number(String(draft.amount || '').replace(',', '.'));
  const subtype = row.category === 'transport' ? draft.transportType : row.category === 'food' ? draft.foodType : '';
  const needsName = row.customName || subtype === 'other' || subtype === 'car-other';
  if (row.subtypes?.length && !subtype) { if (error) error.textContent = 'Choose a type first.'; return; }
  if (needsName && !String(draft.name || '').trim()) { if (error) error.textContent = 'Add the expense name first.'; return; }
  if (!Number.isFinite(amount) || amount <= 0) { if (error) error.textContent = 'Enter a valid amount.'; return; }

  busy = true;
  try {
    await window.TwogetherAPI.post('saveTripExpense', {
      planId: plan.id,
      expense: {
        id: draft.id || '',
        category: row.category,
        foodType: row.category === 'food' ? draft.foodType : '',
        transportType: row.category === 'transport' ? draft.transportType : '',
        name: String(draft.name || '').trim(),
        amount,
        paidBy: draft.paidBy,
        split: draft.split,
        forActor: draft.split === 'personal' ? draft.forActor : '',
        date: draft.date || today(),
        note: draft.note || '',
        uncertain: !!draft.uncertain,
        useJar: row.category === 'accommodation' && !!draft.useJar,
      },
    }, document.body.dataset.actor);
    await refresh(true);
    const updated = latest?.plans?.find((item) => item.id === plan.id) || plan;
    drawCategory(updated, row.key);
  } catch (err) {
    if (error) error.textContent = err.message || 'Could not save expense.';
  } finally {
    busy = false;
  }
}

async function deleteEntry(plan, row, button) {
  if (busy) return;
  if (button.dataset.sure !== '1') {
    button.dataset.sure = '1'; button.textContent = 'Delete?';
    setTimeout(() => { if (button.isConnected) { button.dataset.sure = ''; button.textContent = 'Delete'; } }, 1800);
    return;
  }
  busy = true;
  try {
    await window.TwogetherAPI.post('deleteTripExpense', { planId: plan.id, expenseId: button.dataset.entryDelete }, document.body.dataset.actor);
    await refresh(true);
    const updated = latest?.plans?.find((item) => item.id === plan.id) || plan;
    drawCategory(updated, row.key);
  } catch (err) {
    const error = dialog?.querySelector('[data-overview-error]');
    if (error) error.textContent = err.message || 'Could not remove expense.';
  } finally {
    busy = false;
  }
}

export async function refresh(force = false) {
  const now = Date.now();
  if (refreshing || (!force && latest && now - lastRefresh < 10000)) return latest;
  refreshing = true;
  try { latest = await window.TwogetherAPI.state(); lastRefresh = Date.now(); return latest; }
  catch { return latest; } finally { refreshing = false; }
}
export { total, warnings, metrics };

function bindEnterSubmit() {
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.key !== 'Enter' || e.isComposing || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || !e.target.matches('input,select')) return;
    const root = e.target.closest('.shared-entry,#wizardCard,#workflowV5Overlay,#workflowBudgetModal,.current-overview');
    if (!root) return;
    const target = [...root.querySelectorAll('[data-next],[data-save],[data-wizard-next],[data-v5-next],[data-v5-partial-next],[data-v5-match-next],[data-form-save],button')].find((button) => !button.disabled && button.getClientRects().length && /^(Next|Continue|Save)/i.test(button.textContent.trim()));
    if (target) { e.preventDefault(); e.stopImmediatePropagation(); target.click(); }
  }, true);
}

function backgroundRefresh() { if (document.visibilityState === 'visible') refresh(false); }

export function initOverviewDialog() {
  bindEnterSubmit();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(true); });
  window.addEventListener('focus', () => refresh(false));
  document.addEventListener('twogether:saved', () => { refresh(true); window.TwogetherWorkflow.refresh().catch(() => {}); });
  window.TwogetherOverview = { open, total, warnings, metrics, refresh };
  document.addEventListener('DOMContentLoaded', () => {
    refresh(true);
    setInterval(backgroundRefresh, 30000);
  });
}
