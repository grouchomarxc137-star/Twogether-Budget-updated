from pathlib import Path

p = Path('workflow.js')
s = p.read_text(encoding='utf-8')
old = """      if(amountDiff)steps.push({key,label:MONEY_LABELS[key],type:'money'});\n      else if(certaintyDiff)steps.push({key,label:MONEY_LABELS[key]+' certainty',type:'certainty'});"""
new = """      if(amountDiff || certaintyDiff)steps.push({key,label:MONEY_LABELS[key],type:'money'});"""
if old not in s:
    raise SystemExit('Expected mismatchSteps block not found; refusing to patch')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

# Cache-bust only workflow.js.
p = Path('index.html')
s = p.read_text(encoding='utf-8')
import re
s, count = re.subn(r'workflow\.js\?v=\d+', 'workflow.js?v=3', s, count=1)
if count != 1:
    raise SystemExit('workflow.js script tag not found; refusing to patch')
p.write_text(s, encoding='utf-8')
