(() => {
'use strict';
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const ACTORS=['Principessa','Principe'];
const PACKING_DEFAULTS=['Toothbrushes','Slippers','Hair brush','Shampoo','Conditioner','Shower gel','Dishwasher detergent'];
const REMINDER_DEFAULTS=["Don't forget to put fuel","Don't forget to ask mom to make work sandwich","Don't forget to take pictures of the Airbnb when you arrive"];
const MONTHS=Array.from({length:12},(_,i)=>`2026-${String(i+1).padStart(2,'0')}`);
let appState=null, plannerMonth='2026-09', prepPlanId='', deferredInstall=null;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>crypto.randomUUID?.()||`v33_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const num=v=>{const n=Number(String(v??'').replace(',','.'));return Number.isFinite(n)?n:0;};
const money=v=>'€'+num(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const actor=()=>ACTORS.includes(document.body.dataset.actor)?document.body.dataset.actor:(()=>{try{return ACTORS.includes(localStorage.getItem('twogether_actor_v1'))?localStorage.getItem('twogether_actor_v1'):'';}catch{return'';}})();
const other=()=>actor()==='Principessa'?'Principe':'Principessa';
function toast(text,tone='ok'){const el=$('#toast');if(!el)return;el.textContent=text;el.className='toast show '+tone;clearTimeout(el._v33);el._v33=setTimeout(()=>el.className='toast',3000);}
async function freshState(){try{appState=await window.TwogetherAPI.remoteState();return appState;}catch(e){toast(e.message||'Could not load shared data','warn');return appState;}}
function currentState(){return appState||window.__TWOGETHER_CACHED_STATE__||null;}
function planById(id){return currentState()?.plans?.find(p=>p.id===id)||null;}
function financeRecord(month){return currentState()?.finances?.[actor()]?.find(r=>r.month===month)||null;}
function profile(){return currentState()?.financeProfiles?.[actor()]||{};}

/* PWA shell: installability and native notification permission only; no third-party push service. */
function installPwa(){
  if('serviceWorker' in navigator)navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
  const top=$('.top-actions');if(!top)return;
  let notify=$('#v33Notify');if(!notify&&'Notification' in window){notify=document.createElement('button');notify.id='v33Notify';notify.type='button';notify.className='v33-app-action';top.prepend(notify);syncNotificationButton();notify.addEventListener('click',async()=>{if(Notification.permission==='default')await Notification.requestPermission();syncNotificationButton();});}
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;let b=$('#v33Install');if(!b){b=document.createElement('button');b.id='v33Install';b.type='button';b.className='v33-app-action';b.textContent='Install app';top.prepend(b);b.addEventListener('click',async()=>{if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;b.remove();});}});
  window.addEventListener('appinstalled',()=>{$('#v33Install')?.remove();deferredInstall=null;});
}
function syncNotificationButton(){const b=$('#v33Notify');if(!b)return;const p=Notification.permission;b.textContent=p==='granted'?'Notifications on':p==='denied'?'Notifications blocked':'Enable notifications';b.classList.toggle('is-on',p==='granted');}

/* Shared Jar appears in balances for both profiles. */
function renderSharedJar(){
  const root=$('#financeCurrent');if(!root)return;
  let card=$('.v33-shared-jar',root);if(!card){card=document.createElement('article');card.className='v33-shared-jar';root.appendChild(card);}
  const jar=currentState()?.sharedJar||{balance:870,initialBalance:870,transactions:[]};
  const used=Math.max(0,num(jar.initialBalance||870)-num(jar.balance??870));
  card.innerHTML=`<div class="v33-jar-icon" aria-hidden="true">♡</div><div><span class="panel-kicker">SHARED BANK</span><h3>Shared Jar</h3><p>Used for the optional 20% accommodation contribution.</p></div><div class="v33-jar-money"><strong>${money(jar.balance??870)}</strong><small>${used?`${money(used)} used for accommodation`:'Ready for your next accommodation'}</small></div>`;
}

function baseRow(name,planner='',actual='',group='other',notes='',kind='expense',frequency='monthly',paymentTiming=''){return {id:uid(),name,planner,actual,group,notes,kind,frequency,paymentTiming,reserveMonthly:frequency==='yearly'&&paymentTiming==='later'&&planner!==''?Math.round(num(planner)/12*100)/100:''};}
function principeDefaults(){return [
  baseRow('Salary','','','other','Usually €1,350–€1,600','income','monthly'),
  baseRow('Mandatory savings','','','savings','Move planned savings aside when possible','expense','monthly'),
  baseRow('Rent',575,'','rent','','expense','monthly'),baseRow('Ryanair part 3',47.58,'','other','','expense','monthly'),
  baseRow('Iliad',9.99,'','subscriptions','Around the 2nd','expense','monthly'),baseRow('Spotify',16.99,'','subscriptions','Around the 22nd','expense','monthly'),
  baseRow('ChatGPT Plus',23,'','subscriptions','Around the 9th','expense','monthly'),baseRow('Railway Hosting',5,'','subscriptions','Around the 27th','expense','monthly'),
  baseRow('Claude',21.96,'','subscriptions','Around the 22nd','expense','monthly'),baseRow('Amazon Prime',1.99,'','subscriptions','','expense','monthly'),
  baseRow('OneDrive','','','subscriptions','Paid yearly','expense','yearly','later'),baseRow('Loverzz','','','subscriptions','Paid yearly','expense','yearly','later'),
  baseRow('Fuel',300,'','transport','','expense','monthly'),baseRow('Groceries',17.33,'','groceries','','expense','monthly'),baseRow('Personal',100,'','other','','expense','monthly'),
  baseRow('Airbnb',142,'','other','','expense','one-time'),baseRow('Flights','','','transport','','expense','one-time'),baseRow('P&P expenses','','','other','','expense','one-time')
];}
function requiredBudgetRows(){return ['Flights','P&P expenses','Airbnb'];}
function previousPlanning(month){const list=currentState()?.finances?.[actor()]||[];return [...list].filter(r=>r.month<month&&r.planning?.items?.length).sort((a,b)=>b.month.localeCompare(a.month))[0]?.planning||null;}
function migrateRecordToPlanning(rec){
  if(!rec)return [];
  const rows=[];(rec.incomes||[]).forEach(x=>rows.push(baseRow(x.name,x.amount,x.amount,'other','Migrated from the existing month','income','monthly')));
  (rec.expenses||[]).forEach(x=>{if(String(x.name||'').toLowerCase()==='extra'&&x.group==='extra')return;rows.push(baseRow(x.name,x.amount,x.amount,x.group||'other','Migrated from the existing month','expense','monthly'));});
  return rows;
}
function initialPlanning(month){
  const rec=financeRecord(month);if(rec?.planning?.items?.length)return JSON.parse(JSON.stringify(rec.planning));
  let items=actor()==='Principe'?principeDefaults():migrateRecordToPlanning(rec);
  const prior=previousPlanning(month);
  if(prior?.items?.length){
    const carry=prior.items.filter(x=>x.frequency==='monthly'||(x.frequency==='yearly'&&x.paymentTiming==='later')).map(x=>({...x,id:uid(),actual:'',reserveMonthly:x.frequency==='yearly'&&x.paymentTiming==='later'&&x.planner!==''?Math.round(num(x.planner)/12*100)/100:''}));
    if(carry.length)items=carry;
  }
  const names=new Set(items.map(x=>String(x.name).toLowerCase()));requiredBudgetRows().forEach(name=>{if(!names.has(name.toLowerCase()))items.push(baseRow(name,'','','other','','expense','one-time'));});
  const opening=rec?.planning?.openingSavings??profile().savingsTotal??'';
  return {items,openingSavings:opening,updatedAt:''};
}
function expenseCategory(item){const n=String(item.name||'').toLowerCase();if(item.kind==='income')return'Income';if(n==='rent'||/ryanair part/.test(n))return'Fixed expenses';if(item.group==='subscriptions')return'Subscriptions';if(['fuel','groceries','personal','airbnb','flights','p&p expenses'].includes(n))return'Variable expenses';if(item.frequency==='yearly')return'Yearly expenses';return'Other';}
function monthlyPlanned(item){if(item.kind==='income')return num(item.planner);if(item.frequency==='yearly'&&item.paymentTiming==='later')return num(item.reserveMonthly);return num(item.planner);}
function planningSummary(planning){
  const items=planning.items||[],plannedIncome=items.filter(x=>x.kind==='income').reduce((s,x)=>s+num(x.planner),0),actualIncome=items.filter(x=>x.kind==='income').reduce((s,x)=>s+num(x.actual),0),plannedOut=items.filter(x=>x.kind!=='income').reduce((s,x)=>s+monthlyPlanned(x),0),actualOut=items.filter(x=>x.kind!=='income').reduce((s,x)=>s+num(x.actual),0),saved=actualIncome-actualOut,opening=num(planning.openingSavings),after=opening+saved;
  return {plannedIncome,actualIncome,plannedOut,actualOut,saved,opening,after,diff:plannedOut-actualOut};
}
function renderPlanner(){
  const view=$('[data-fin-view="monthly"]');if(!view)return;
  let root=$('#v33FinancePlanner',view);if(!root){root=document.createElement('section');root.id='v33FinancePlanner';root.className='v33-planner';view.appendChild(root);}
  if(!actor()){root.innerHTML='';return;}
  let planning=root._planning&&root.dataset.month===plannerMonth?root._planning:initialPlanning(plannerMonth);root._planning=planning;root.dataset.month=plannerMonth;
  const finalized=!!financeRecord(plannerMonth)?.finalized;
  const grouped={};planning.items.forEach(x=>(grouped[expenseCategory(x)]||(grouped[expenseCategory(x)]=[])).push(x));
  const order=['Income','Fixed expenses','Subscriptions','Variable expenses','Yearly expenses','Other'];
  const rows=order.filter(k=>grouped[k]?.length).map(cat=>`<tr class="v33-cat"><th colspan="5">${esc(cat)}</th></tr>`+grouped[cat].map(item=>{
    const reserve=item.frequency==='yearly'&&item.paymentTiming==='later'&&item.planner!==''?`<small class="v33-reserve">Reserve ${money(num(item.planner)/12)}/month</small>`:'';
    const custom=!!item.custom;
    return `<tr data-plan-row="${esc(item.id)}"><td><strong>${esc(item.name)}</strong>${reserve}${custom?'<button type="button" class="v33-remove-row" data-remove-row aria-label="Remove expense">×</button>':''}</td><td><input data-field="planner" inputmode="decimal" value="${esc(item.planner??'')}" ${finalized?'disabled':''}></td><td><input data-field="actual" inputmode="decimal" value="${esc(item.actual??'')}" ${(finalized||(item.frequency==='yearly'&&item.paymentTiming==='later'))?'disabled':''}></td><td><span>${esc(item.notes||'')}</span>${item.frequency!=='monthly'?`<small>${item.frequency==='yearly'?'Yearly':'One-time'}${item.frequency==='yearly'&&item.paymentTiming==='later'?' · due later':''}</small>`:''}</td><td>${custom?'<span class="v33-custom-mark">Custom</span>':''}</td></tr>`;
  }).join('')).join('');
  const s=planningSummary(planning),status=finalized?'Month closed — Actual is final.':'Actual is the amount paid so far. It stays ongoing until you confirm/close the month.';
  root.innerHTML=`<div class="v33-planner-head"><div><span class="panel-kicker">PLANNER VS ACTUAL</span><h2>${esc(actor())}’s monthly plan</h2><p>${status}</p></div><label>Month<select id="v33PlannerMonth">${MONTHS.map(m=>`<option value="${m}" ${m===plannerMonth?'selected':''}>${m}</option>`).join('')}</select></label></div>
    <div class="v33-opening"><label>Savings before month <div class="finance-money mini"><span>€</span><input id="v33OpeningSavings" inputmode="decimal" value="${esc(planning.openingSavings??'')}" ${finalized?'disabled':''}></div></label><p>Planner is your adjustable budget. Actual is only what has really been paid so far.</p></div>
    <div class="v33-plan-table-wrap"><table class="v33-plan-table"><thead><tr><th>Category</th><th>Planner</th><th>Actual</th><th>Notes</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="v33-plan-actions"><button type="button" class="btn ghost" id="v33AddExpense" ${finalized?'disabled':''}>+ Extra expense?</button><button type="button" class="btn primary" id="v33SavePlanning" ${finalized?'disabled':''}>Save planner / actual</button></div>
    <div id="v33ExtraForm" class="v33-extra-form hidden"></div>
    <div class="v33-month-summary"><h3>Monthly summary</h3><div><span>Savings before month</span><strong>${money(s.opening)}</strong></div><div><span>Planned income</span><strong>${money(s.plannedIncome)}</strong></div><div><span>Actual income so far</span><strong>${money(s.actualIncome)}</strong></div><div><span>Planned monthly outflow</span><strong>${money(s.plannedOut)}</strong></div><div><span>Actual expenses so far</span><strong>${money(s.actualOut)}</strong></div><div><span>Saved / left so far</span><strong class="${s.saved<0?'negative':''}">${money(s.saved)}</strong></div><div><span>Savings after month (so far)</span><strong>${money(s.after)}</strong></div><div><span>Against planner</span><strong class="${s.diff>=0?'positive':'negative'}">${s.diff>=0?'Under':'Over'} ${money(Math.abs(s.diff))}</strong></div></div>`;
  bindPlanner(root,finalized);
}
function readPlannerInputs(root){
  const p=root._planning;if(!p)return;
  p.openingSavings=$('#v33OpeningSavings',root)?.value??'';
  $$('[data-plan-row]',root).forEach(tr=>{const item=p.items.find(x=>x.id===tr.dataset.planRow);if(!item)return;item.planner=$('[data-field="planner"]',tr)?.value??'';if(!(item.frequency==='yearly'&&item.paymentTiming==='later'))item.actual=$('[data-field="actual"]',tr)?.value??'';item.reserveMonthly=item.frequency==='yearly'&&item.paymentTiming==='later'&&item.planner!==''?Math.round(num(item.planner)/12*100)/100:'';});
}
function bindPlanner(root,finalized){
  $('#v33PlannerMonth',root)?.addEventListener('change',e=>{plannerMonth=e.target.value;root._planning=null;renderPlanner();});
  $$('input[data-field],#v33OpeningSavings',root).forEach(i=>i.addEventListener('change',()=>{readPlannerInputs(root);renderPlanner();}));
  $$('[data-remove-row]',root).forEach(b=>b.addEventListener('click',()=>{readPlannerInputs(root);const id=b.closest('[data-plan-row]').dataset.planRow;root._planning.items=root._planning.items.filter(x=>x.id!==id);renderPlanner();}));
  $('#v33AddExpense',root)?.addEventListener('click',()=>showExtraForm(root));
  $('#v33SavePlanning',root)?.addEventListener('click',async()=>{readPlannerInputs(root);const btn=$('#v33SavePlanning',root);btn.disabled=true;try{const result=await window.TwogetherAPI.post('saveFinancePlanning',{month:plannerMonth,planning:root._planning},actor());appState=await window.TwogetherAPI.remoteState();root._planning=JSON.parse(JSON.stringify(result.planning||root._planning));toast('Planner and Actual saved');renderPlanner();}catch(e){toast(e.message||'Could not save monthly planning','warn');btn.disabled=false;}});
}
function showExtraForm(root){
  const form=$('#v33ExtraForm',root);if(!form)return;form.classList.remove('hidden');form.innerHTML=`<h3>Add an extra expense</h3><div class="v33-extra-grid"><label>Name<input id="v33ExtraName" placeholder="e.g. Insurance"></label><label>Planner amount<input id="v33ExtraPlanner" inputmode="decimal" placeholder="0.00"></label><label>Actual paid so far<input id="v33ExtraActual" inputmode="decimal" placeholder="0.00"></label><label>What type of expense is this?<select id="v33ExtraFreq"><option value="one-time">One-time</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label><label class="v33-yearly-pay hidden" id="v33YearlyWrap">How is this yearly expense being paid?<select id="v33ExtraTiming"><option value="upfront">Paid upfront now</option><option value="later">Paid once per year / due later</option></select></label></div><div id="v33ReservePreview"></div><div class="v33-plan-actions"><button class="btn ghost" type="button" data-extra-cancel>Cancel</button><button class="btn primary" type="button" data-extra-add>Add expense</button></div>`;
  const update=()=>{const yearly=$('#v33ExtraFreq',form).value==='yearly';$('#v33YearlyWrap',form).classList.toggle('hidden',!yearly);const later=yearly&&$('#v33ExtraTiming',form).value==='later',amt=num($('#v33ExtraPlanner',form).value);$('#v33ReservePreview',form).innerHTML=later&&amt?`<div class="v33-reserve-preview"><strong>${money(amt/12)} per month</strong><span>Keep this reserved in the account. It is not counted as Actual until the yearly bill is really paid.</span></div>`:'';$('#v33ExtraActual',form).disabled=later;};
  $('#v33ExtraFreq',form).addEventListener('change',update);$('#v33ExtraTiming',form).addEventListener('change',update);$('#v33ExtraPlanner',form).addEventListener('input',update);
  $('[data-extra-cancel]',form).addEventListener('click',()=>form.classList.add('hidden'));
  $('[data-extra-add]',form).addEventListener('click',()=>{const name=$('#v33ExtraName',form).value.trim(),planner=$('#v33ExtraPlanner',form).value,frequency=$('#v33ExtraFreq',form).value,timing=frequency==='yearly'?$('#v33ExtraTiming',form).value:'',later=frequency==='yearly'&&timing==='later',actual=later?'':$('#v33ExtraActual',form).value;if(!name)return toast('Add an expense name','warn');readPlannerInputs(root);root._planning.items.push({...baseRow(name,planner,actual,'other','', 'expense',frequency,timing),custom:true});renderPlanner();});
}

/* Prepare-for-trip checklists live inside each current trip and are shared. */
function ensurePrepModal(){
  if($('#v33PrepModal'))return;
  const modal=document.createElement('div');modal.id='v33PrepModal';modal.className='v33-prep-modal';modal.setAttribute('aria-hidden','true');modal.innerHTML='<div class="v33-prep-backdrop" data-prep-close></div><section class="v33-prep-card" role="dialog" aria-modal="true" aria-label="Prepare for trip"><button class="v33-prep-close" type="button" data-prep-close>×</button><div id="v33PrepBody"></div></section>';document.body.appendChild(modal);$$('[data-prep-close]',modal).forEach(x=>x.addEventListener('click',closePrep));
}
function defaults(list){return list.map(text=>({id:uid(),text,done:false}));}
function openPrep(id){prepPlanId=id;ensurePrepModal();const plan=planById(id);if(!plan)return toast('Trip not found','warn');const stored=plan.prep||{},prep={packing:stored.packing?.length?JSON.parse(JSON.stringify(stored.packing)):defaults(PACKING_DEFAULTS),reminders:stored.reminders?.length?JSON.parse(JSON.stringify(stored.reminders)):defaults(REMINDER_DEFAULTS)};$('#v33PrepModal')._prep=prep;renderPrep();$('#v33PrepModal').classList.add('show');$('#v33PrepModal').setAttribute('aria-hidden','false');}
function closePrep(){$('#v33PrepModal')?.classList.remove('show');$('#v33PrepModal')?.setAttribute('aria-hidden','true');}
function prepRows(kind,list){return `<div class="v33-check-list" data-prep-list="${kind}">${list.map(x=>`<div class="v33-check-row" data-prep-id="${esc(x.id)}"><input type="checkbox" ${x.done?'checked':''} data-prep-check aria-label="Done"><input class="v33-check-text" value="${esc(x.text)}" data-prep-text><button type="button" data-prep-remove aria-label="Remove">×</button></div>`).join('')}</div><div class="v33-add-check"><input placeholder="Add another item" data-prep-new="${kind}"><button class="btn ghost" type="button" data-prep-add="${kind}">Add</button></div>`;}
function renderPrep(){const modal=$('#v33PrepModal'),body=$('#v33PrepBody'),prep=modal?._prep;if(!body||!prep)return;const plan=planById(prepPlanId);body.innerHTML=`<span class="panel-kicker">${esc(plan?.meta?.city||'TRIP')}</span><h2>Prepare for trip</h2><p>Tick things off, edit them, or add your own.</p><section class="v33-prep-section"><h3>Packing / things to take</h3>${prepRows('packing',prep.packing)}</section><section class="v33-prep-section"><h3>Important trip reminders</h3>${prepRows('reminders',prep.reminders)}</section><button class="btn primary v33-prep-save" type="button" data-prep-save>Save checklist</button>`;bindPrep();}
function bindPrep(){const modal=$('#v33PrepModal'),prep=modal._prep;$$('[data-prep-id]',modal).forEach(row=>{const list=row.closest('[data-prep-list]').dataset.prepList,item=prep[list].find(x=>x.id===row.dataset.prepId);$('[data-prep-check]',row).addEventListener('change',e=>item.done=e.target.checked);$('[data-prep-text]',row).addEventListener('change',e=>item.text=e.target.value.trim());$('[data-prep-remove]',row).addEventListener('click',()=>{prep[list]=prep[list].filter(x=>x.id!==item.id);renderPrep();});});$$('[data-prep-add]',modal).forEach(b=>b.addEventListener('click',()=>{const kind=b.dataset.prepAdd,input=$(`[data-prep-new="${kind}"]`,modal),text=input.value.trim();if(!text)return;prep[kind].push({id:uid(),text,done:false});renderPrep();}));$('[data-prep-save]',modal)?.addEventListener('click',async()=>{const btn=$('[data-prep-save]',modal);btn.disabled=true;prep.packing=prep.packing.filter(x=>x.text);prep.reminders=prep.reminders.filter(x=>x.text);try{const r=await window.TwogetherAPI.post('saveTripPrep',{planId:prepPlanId,prep},actor());const plan=planById(prepPlanId);if(plan)plan.prep=r.prep;toast('Trip checklist saved');closePrep();await freshState();}catch(e){toast(e.message||'Could not save checklist','warn');btn.disabled=false;}});}
function decorateCurrentTrips(){
  $$('#twCurrentTrips .tw-current-card[data-current-plan]').forEach(card=>{if($('[data-v33-prep]',card))return;const actions=$('.tw-current-actions',card);if(!actions)return;const b=document.createElement('button');b.type='button';b.className='text-btn v33-prepare-btn';b.dataset.v33Prep='';b.textContent='Prepare';const open=$('[data-current-open]',actions);actions.insertBefore(b,open||null);});
}

function attachEvents(){
  document.addEventListener('click',e=>{const prep=e.target.closest?.('[data-v33-prep]');if(prep){e.preventDefault();e.stopImmediatePropagation();const id=prep.closest('[data-current-plan]')?.dataset.currentPlan;if(id)openPrep(id);return;}const identity=e.target.closest?.('.identity-choice,#loggedUserBadge');if(identity)setTimeout(async()=>{await freshState();renderSharedJar();renderPlanner();decorateCurrentTrips();},180);},true);
  document.addEventListener('twogether:v18-rendered',()=>{decorateCurrentTrips();});
  document.addEventListener('twogether:finance-view',async e=>{if(e.detail?.view==='balances'){await freshState();renderSharedJar();}if(e.detail?.view==='monthly'){await freshState();renderPlanner();}});
  document.addEventListener('twogether:saved',async()=>{await freshState();renderSharedJar();decorateCurrentTrips();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')freshState().then(()=>{renderSharedJar();decorateCurrentTrips();});});
}
async function init(){installPwa();ensurePrepModal();attachEvents();await freshState();renderSharedJar();decorateCurrentTrips();if($('[data-fin-view="monthly"].active'))renderPlanner();document.dispatchEvent(new CustomEvent('twogether:v33-ready'));}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
