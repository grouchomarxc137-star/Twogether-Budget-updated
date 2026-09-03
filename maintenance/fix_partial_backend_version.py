from pathlib import Path
p=Path('backend/Code.gs')
s=p.read_text(encoding='utf-8')
old='  state.version = 5;'
if old not in s:
    raise SystemExit('Expected old state.version stamp not found')
s=s.replace(old,'  state.version = 6;',1)
p.write_text(s,encoding='utf-8')
