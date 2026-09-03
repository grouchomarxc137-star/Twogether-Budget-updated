from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'Missing patch anchor: {label}')
    return text.replace(old, new, 1)

# workflow.js
p = Path('workflow.js')
s = p.read_text()

s = replace_once(
    s,
    "const plans=[...sharedState.plans].sort((a,b)=>String(b?.meta?.start||b.updatedAt||'').localeCompare(String(a?.meta?.start||a.updatedAt||'')));",
    "const plans=[...sharedState.plans].filter(plan=>!isLocked(tripForPlan(plan))).sort((a,b)=>String(b?.meta?.start||b.updatedAt||'').localeCompare(String(a?.meta?.start||a.updatedAt||'')));",
    'hide confirmed budget plans'
)

old_card = """      const ownBudget=plan?.budgets?.[a]??''; const ownSub=trip?.submissions?.[a]||null;\n      const status=locked?'Budget checked':trip?'Trip expenses in progress':'Waiting for the trip';\n      return `<article class=\"budget-plan-card\" data-v5-plan=\"${esc(plan.id)}\"><div class=\"budget-plan-top\"><div><span class=\"trip-country\">${esc(locationLabel(meta))}</span><h3>${esc(meta.city||locationLabel(meta))}</h3><p>${fmtDate(meta.start)}–${fmtDate(meta.end)}</p></div><span class=\"budget-plan-status ${locked?'done':trip?'live':''}\">${esc(status)}</span></div><div class=\"budget-person-grid\">"""
new_card = """      const ownBudget=plan?.budgets?.[a]??''; const ownSub=trip?.submissions?.[a]||null;\n      const status=trip?'Trip expenses in progress':'Waiting for the trip';\n      const combinedPlanned=bothBudgets ? money(n(pBudget)+n(qBudget)) : 'Waiting for both budgets';\n      return `<article class=\"budget-plan-card\" data-v5-plan=\"${esc(plan.id)}\"><div class=\"budget-plan-top\"><div><span class=\"trip-country\">${esc(locationLabel(meta))}</span><h3>${esc(meta.city||locationLabel(meta))}</h3><p>${fmtDate(meta.start)}–${fmtDate(meta.end)}</p></div><span class=\"budget-plan-status ${trip?'live':''}\">${esc(status)}</span></div><div class=\"budget-combined-planned\"><span>Combined planned budget</span><strong>${esc(combinedPlanned)}</strong></div><div class=\"budget-person-grid\">"""
s = replace_once(s, old_card, new_card, 'combined planned budget card')

old_mismatch = """      if(amountDiff)steps.push({key,label:MONEY_LABELS[key],type:'money'});\n      else if(certaintyDiff)steps.push({key,label:MONEY_LABELS[key]+' certainty',type:'certainty'});"""
new_mismatch = """      if(amountDiff || certaintyDiff)steps.push({key,label:MONEY_LABELS[key],type:'money'});"""
s = replace_once(s, old_mismatch, new_mismatch, 'certainty mismatch becomes amount match')

p.write_text(s)

# live.css
p = Path('live.css')
s = p.read_text()
addition = """

/* Active trip budget summary */
.budget-combined-planned{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:14px 0 4px;padding:12px 13px;border:1px solid var(--line);border-radius:15px;background:#fbf6e9}.budget-combined-planned span{font-size:12px;color:var(--muted)}.budget-combined-planned strong{font-size:18px;text-align:right}
"""
if '/* Active trip budget summary */' not in s:
    s += addition
p.write_text(s)

# index cache bust
p = Path('index.html')
s = p.read_text()
s = s.replace('live.css?v=2', 'live.css?v=3').replace('live.css?v=1', 'live.css?v=3')
s = s.replace('workflow.js?v=2', 'workflow.js?v=3').replace('workflow.js?v=1', 'workflow.js?v=3')
p.write_text(s)
