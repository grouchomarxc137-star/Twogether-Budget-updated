from pathlib import Path

p = Path('workflow.js')
s = p.read_text(encoding='utf-8')
old = """      const ownBudget=plan?.budgets?.[a]??''; const ownSub=trip?.submissions?.[a]||null;\n      const status=locked?'Budget checked':trip?'Trip expenses in progress':'Waiting for the trip';\n      return `<article class=\"budget-plan-card\" data-v5-plan=\"${esc(plan.id)}\"><div class=\"budget-plan-top\"><div><span class=\"trip-country\">${esc(locationLabel(meta))}</span><h3>${esc(meta.city||locationLabel(meta))}</h3><p>${fmtDate(meta.start)}–${fmtDate(meta.end)}</p></div><span class=\"budget-plan-status ${locked?'done':trip?'live':''}\">${esc(status)}</span></div><div class=\"budget-person-grid\">"""
new = """      const ownBudget=plan?.budgets?.[a]??''; const ownSub=trip?.submissions?.[a]||null;\n      const status=trip?'Trip expenses in progress':'Waiting for the trip';\n      const combinedPlanned=bothBudgets ? money(n(pBudget)+n(qBudget)) : 'Waiting for both budgets';\n      return `<article class=\"budget-plan-card\" data-v5-plan=\"${esc(plan.id)}\"><div class=\"budget-plan-top\"><div><span class=\"trip-country\">${esc(locationLabel(meta))}</span><h3>${esc(meta.city||locationLabel(meta))}</h3><p>${fmtDate(meta.start)}–${fmtDate(meta.end)}</p></div><span class=\"budget-plan-status ${trip?'live':''}\">${esc(status)}</span></div><div class=\"v5-reference\"><span>Combined planned budget</span><strong>${esc(combinedPlanned)}</strong></div><div class=\"budget-person-grid\">"""
if old not in s:
    raise SystemExit('Expected active budget-card markup not found; refusing to patch')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

p = Path('index.html')
s = p.read_text(encoding='utf-8')
import re
m = re.search(r'workflow\.js\?v=(\d+)', s)
if not m:
    raise SystemExit('workflow.js script tag not found; refusing to patch')
next_v = int(m.group(1)) + 1
s = re.sub(r'workflow\.js\?v=\d+', f'workflow.js?v={next_v}', s, count=1)
p.write_text(s, encoding='utf-8')

# trigger
