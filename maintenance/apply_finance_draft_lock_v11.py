from pathlib import Path
import re

# Frontend
p=Path('finances.js')
s=p.read_text(encoding='utf-8')

repls=[
("    const extraBudget=hasValue(rec?.extraBudget)?n(rec.extraBudget):255;","    const rawExtraBudget=hasValue(rec?.extraBudget)?n(rec.extraBudget):255;\n    const extraBudget=rawExtraBudget>0?rawExtraBudget:255;"),
("  function freshRecord(month){ return {month,incomes:[],expenses:[],extraBudget:255,investmentTotal:'',sisterInvestments:''}; }","  function freshRecord(month){ return {month,incomes:[],expenses:[],extraBudget:255,investmentTotal:'',sisterInvestments:'',finalized:false,finalizedAt:''}; }"),
("    if(!hasValue(copy.extraBudget))copy.extraBudget=255;","    if(!hasValue(copy.extraBudget)||n(copy.extraBudget)<=0)copy.extraBudget=255;\n    copy.finalized=copy.finalized===true; if(!copy.finalizedAt)copy.finalizedAt='';"),
("    if(previous&&hasValue(previous.extraBudget)) d.extraBudget=n(previous.extraBudget);","    if(previous&&hasValue(previous.extraBudget)&&n(previous.extraBudget)>0) d.extraBudget=n(previous.extraBudget);"),
("  function startEdit(rec){ flow={data:cloneRecord(rec),stage:'review',temp:{}}; renderWizard(); }","  function startEdit(rec){ if(rec?.finalized===true)return toast('This month is final and locked','warn'); flow={data:cloneRecord(rec),stage:'review',temp:{}}; renderWizard(); }"),
("<div class=\"finance-kpi\"><span>${latest?monthLabel(latest.month):'Latest month'}</span><strong>${latest?'Saved':'Not logged'}</strong></div>","<div class=\"finance-kpi\"><span>${latest?monthLabel(latest.month):'Latest month'}</span><strong>${latest?(latest.finalized?'Final':'Draft'):'Not logged'}</strong></div>"),
("<small>${rec?`${money(c.income)} in · ${money(c.outflow)} out`:'Tap to start'}</small>","<small>${rec?`${rec.finalized?'Final':'Draft'} · ${money(c.income)} in · ${money(c.outflow)} out`:'Tap to start'}</small>"),
("<button class=\"btn ghost\" type=\"button\" data-fin-edit>Edit month</button>","${rec.finalized?'<span class=\"finance-final-badge\">Final · locked</span>':'<div class=\"finance-detail-actions\"><button class=\"btn ghost\" type=\"button\" data-fin-edit>Edit draft</button><button class=\"btn primary\" type=\"button\" data-fin-finalize-existing>Confirm month</button></div>'}"),
("    $('[data-fin-edit]',root)?.addEventListener('click',()=>startEdit(rec));","    $('[data-fin-edit]',root)?.addEventListener('click',()=>startEdit(rec));\n    $('[data-fin-finalize-existing]',root)?.addEventListener('click',()=>confirmExistingMonth(rec));"),
("<div class=\"finance-actions\"><button class=\"btn ghost\" data-fin-cancel>Cancel</button><button class=\"btn primary big\" data-fin-save>Save month</button></div>","<div class=\"finance-actions finance-save-actions\"><button class=\"btn ghost\" data-fin-cancel>Cancel</button><div><button class=\"btn ghost\" data-fin-save-draft>Save draft</button><button class=\"btn primary big\" data-fin-finalize>Confirm month</button></div></div>"),
("    $('[data-fin-save]')?.addEventListener('click',saveMonth);","    $('[data-fin-save-draft]')?.addEventListener('click',()=>saveMonth(false));\n    $('[data-fin-finalize]')?.addEventListener('click',()=>saveMonth(true));"),
("  async function saveMonth(){","  async function saveMonth(finalize=false){"),
("    const d=cloneRecord(flow.data); if(!d.month) return toast('Choose a month first','warn');\n    const btn=$('[data-fin-save]'); if(btn) btn.disabled=true;","    const d=cloneRecord(flow.data); if(!d.month) return toast('Choose a month first','warn');\n    if(finalize&&financeState.version<10)return toast('Final locking needs the latest backend deployment','warn');\n    d.finalized=!!finalize; d.finalizedAt=finalize?new Date().toISOString():'';\n    const btn=$(finalize?'[data-fin-finalize]':'[data-fin-save-draft]'); if(btn) btn.disabled=true;"),
("      const saved={...d,updatedAt:new Date().toISOString(),updatedBy:actor()};","      const saved={...d,updatedAt:new Date().toISOString(),updatedBy:actor()};"),
("      selectedMonth=d.month; flow=null; renderPage(); renderWizard(); renderDetail(saved); toast('Monthly finances saved'); setTimeout(loadState,1400);","      selectedMonth=d.month; flow=null; renderPage(); renderWizard(); renderDetail(saved); toast(finalize?'Month confirmed and locked':'Draft saved — you can keep editing it'); setTimeout(loadState,1400);")
]
for old,new in repls:
    if old not in s:
        raise SystemExit('frontend anchor missing: '+old[:90])
    s=s.replace(old,new,1)

anchor="  async function saveMonth(finalize=false){"
helper="""  async function confirmExistingMonth(rec){
    if(!rec||rec.finalized===true)return;
    if(financeState.version<10)return toast('Final locking needs the latest backend deployment','warn');
    const d=cloneRecord(rec); d.finalized=true; d.finalizedAt=new Date().toISOString();
    try{
      await post('saveFinanceMonth',{monthData:d});
      const list=financeState.finances[actor()]||[]; const idx=list.findIndex(x=>x.month===d.month);
      const saved={...d,updatedAt:new Date().toISOString(),updatedBy:actor()};
      if(idx>=0)list[idx]=saved; else list.push(saved);
      renderPage(); renderDetail(saved); toast('Month confirmed and locked'); setTimeout(loadState,1200);
    }catch(err){toast(err.message||'Could not confirm month','warn');}
  }

"""+anchor
if anchor not in s: raise SystemExit('saveMonth anchor missing')
s=s.replace(anchor,helper,1)

p.write_text(s,encoding='utf-8')

# Backend
p=Path('backend/Code.gs')
b=p.read_text(encoding='utf-8')
b=b.replace('version: 9','version: 10').replace('version:9','version:10').replace('state.version = 9','state.version = 10')

old="""      const idx = list.findIndex(x => x.month === monthData.month);
      monthData.updatedAt = new Date().toISOString();
      monthData.updatedBy = actor;
      if (idx >= 0) list[idx] = monthData; else list.push(monthData);"""
new="""      const idx = list.findIndex(x => x.month === monthData.month);
      const existing = idx >= 0 ? sanitizeFinanceMonth_(list[idx], actor) : null;
      if (existing && existing.finalized) throw new Error('This month is final and locked');
      const now = new Date().toISOString();
      monthData.updatedAt = now;
      monthData.updatedBy = actor;
      monthData.finalized = monthData.finalized === true;
      monthData.finalizedAt = monthData.finalized ? (monthData.finalizedAt || now) : '';
      if (idx >= 0) list[idx] = monthData; else list.push(monthData);"""
if old not in b: raise SystemExit('backend save anchor missing')
b=b.replace(old,new,1)

old="""    extraBudget: cleanMoney_(record && record.extraBudget),
    investmentTotal: cleanMoney_(record && record.investmentTotal),
    sisterInvestments: cleanMoney_(record && record.sisterInvestments),
    updatedAt: cleanText_(record && record.updatedAt, 40),"""
new="""    extraBudget: (function(){ const x=cleanMoney_(record && record.extraBudget); return x === '' || Number(x) <= 0 ? 255 : x; })(),
    investmentTotal: cleanMoney_(record && record.investmentTotal),
    sisterInvestments: cleanMoney_(record && record.sisterInvestments),
    finalized: !!(record && record.finalized === true),
    finalizedAt: cleanText_(record && record.finalizedAt, 40),
    updatedAt: cleanText_(record && record.updatedAt, 40),"""
if old not in b: raise SystemExit('backend sanitize anchor missing')
b=b.replace(old,new,1)
p.write_text(b,encoding='utf-8')

# CSS
p=Path('finance.css')
c=p.read_text(encoding='utf-8')
if '.finance-final-badge{' not in c:
    c += "\n.finance-detail-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.finance-final-badge{display:inline-flex;align-items:center;padding:8px 11px;border-radius:999px;background:#edf3e4;border:1px solid #d5dfbc;color:#4e7352;font-size:12px;font-weight:700}.finance-save-actions>div{display:flex;gap:8px;flex-wrap:wrap}.finance-month.saved:not(.current){position:relative}\n"
p.write_text(c,encoding='utf-8')

# Cache bust
p=Path('index.html')
h=p.read_text(encoding='utf-8')
h=re.sub(r'finance\\.css\\?v=\\d+','finance.css?v=4',h)
h=re.sub(r'finances\\.js\\?v=\\d+','finances.js?v=4',h)
p.write_text(h,encoding='utf-8')
