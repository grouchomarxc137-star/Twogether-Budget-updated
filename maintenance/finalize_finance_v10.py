from pathlib import Path

p=Path('backend/Code.gs')
s=p.read_text()
old="if (action === 'ping') return output_({ok:true, version:13, now:new Date().toISOString()}, callback);"
new="if (action === 'ping') return output_({ok:true, version:14, now:new Date().toISOString()}, callback);"
if old not in s:
    raise SystemExit('ping version marker missing')
p.write_text(s.replace(old,new,1))

p=Path('navigation.css')
s=p.read_text()
s=s.replace('.finance-subnav{display:grid;grid-template-columns:1fr 1fr}.finance-subnav button{border-radius:13px}.loan-stats', '.loan-stats')
p.write_text(s)
