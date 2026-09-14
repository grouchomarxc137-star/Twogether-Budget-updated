from pathlib import Path

def replace(path, old, new, label):
    p=Path(path); text=p.read_text()
    if old not in text: raise SystemExit(f'{path}: missing {label}')
    p.write_text(text.replace(old,new,1))

replace('index.html','<meta name="theme-color" content="#f7f4ef">','<meta name="theme-color" content="#f7f4ef">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-status-bar-style" content="default">\n<meta name="apple-mobile-web-app-title" content="Twogether">\n<link rel="manifest" href="manifest.webmanifest?v=1">\n<link rel="icon" href="app-icon.svg" type="image/svg+xml">','PWA head')
replace('index.html','<link rel="stylesheet" href="v32.css?v=1">','<link rel="stylesheet" href="v32.css?v=1">\n<link rel="stylesheet" href="v33.css?v=1">','v33 css')
replace('index.html','<script src="v32.js?v=1" defer></script>','<script src="v32.js?v=1" defer></script>\n<script src="v33.js?v=1" defer></script>','v33 js')
replace('.github/workflows/pages.yml','cp -f *.html *.js *.css public/','cp -f *.html *.js *.css *.webmanifest *.svg public/','PWA Pages assets')
replace('approved-v18.js','setTimeout(()=>refreshState(true),180);setInterval(()=>refreshState(false),5000);','setTimeout(()=>refreshState(true),180);\n    document.addEventListener(\'visibilitychange\',()=>{if(document.visibilityState===\'visible\')refreshState(false);});','remove polling')
for path in ['backend/Code.gs','backend/Code-v17.gs']:
    replace(path,"function sanitizeFinancePlanning_(value){const s=value&&typeof value==='object'?value:{};return {items:(Array.isArray(s.items)?s.items:[]).slice(0,120).map(sanitizeFinancePlanningItem_).filter(function(x){return !!x.name;}),updatedAt:cleanText_(s.updatedAt,40)};}","function sanitizeFinancePlanning_(value){const s=value&&typeof value==='object'?value:{};return {items:(Array.isArray(s.items)?s.items:[]).slice(0,120).map(sanitizeFinancePlanningItem_).filter(function(x){return !!x.name;}),openingSavings:cleanMoney_(s.openingSavings),updatedAt:cleanText_(s.updatedAt,40)};}",'opening savings')
