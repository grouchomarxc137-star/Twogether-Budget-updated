from pathlib import Path

p = Path('workflow.js')
s = p.read_text(encoding='utf-8')
old = "const plans=[...sharedState.plans].sort((a,b)=>String(b?.meta?.start||b.updatedAt||'').localeCompare(String(a?.meta?.start||a.updatedAt||'')));"
new = "const plans=[...sharedState.plans].filter(plan=>!isLocked(tripForPlan(plan))).sort((a,b)=>String(b?.meta?.start||b.updatedAt||'').localeCompare(String(a?.meta?.start||a.updatedAt||'')));"
if old not in s:
    raise SystemExit('Expected budget-plan list not found; refusing to patch')
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
