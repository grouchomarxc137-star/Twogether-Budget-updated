from pathlib import Path
p=Path('index.html')
s=p.read_text(encoding='utf-8')
s=s.replace('<link rel="stylesheet" href="shop-v24.css?v=1">','<link rel="stylesheet" href="shop-v26.css?v=1">')
s=s.replace('<script src="overview.js?v=19" defer></script>','<script src="overview-v26.js?v=1" defer></script>')
s=s.replace('<script src="shop-v24.js?v=2" defer></script>','<script src="shop-v26.js?v=1" defer></script>')
if 'shop-v26.js' not in s or 'overview-v26.js' not in s or 'shop-v26.css' not in s:
    raise RuntimeError('v26 entrypoint patch failed')
p.write_text(s,encoding='utf-8')
print('Patched v26 frontend entrypoints.')
