const assert=require('assert/strict'),fs=require('fs');
const shop=fs.readFileSync('shop-v26.js','utf8'),shopCss=fs.readFileSync('shop-v26.css','utf8'),refine=fs.readFileSync('refine-v26.css','utf8'),overview=fs.readFileSync('overview-v26.js','utf8'),loader=fs.readFileSync('refine-v19.js','utf8'),html=fs.readFileSync('index.html','utf8');
for(const [kind,amount] of [['log',5],['tripConfirm',10],['financeConfirm',15],['expense',100],['daily',200],['session',400]]){assert.match(shop,new RegExp(`${kind}[^\\n]{0,160}${amount}`));}
assert.match(shop,/1800000/);assert.match(shop,/daily:\$\{actor\(\)\}/);assert.match(shop,/session:\$\{a\}/);assert.match(shop,/score = Lovis × 100 \+ Twos/);assert.match(shop,/flying-heart/);assert.match(shop,/flying-note/);assert.match(shop,/previewSignal/);assert.match(shop,/500,twos:5000/);assert.match(shop,/once per day/i);
assert.match(shopCss,/shop-scoreboard/);assert.match(shopCss,/flying-message/);assert.match(shopCss,/shop-wallets/);
assert.match(refine,/grid-template-columns:126px minmax\(0,1fr\)/);assert.match(refine,/tw-current-numbers/);assert.match(refine,/border-top:1px solid var\(--v26-line\)/);assert.match(refine,/overview-payment-grid/);
assert.match(overview,/20% =/);assert.match(overview,/overview-match matched/);assert.doesNotMatch(overview,/setInterval\(refresh,5000\)/);assert.match(overview,/setInterval\(backgroundRefresh,30000\)/);
assert.doesNotMatch(loader,/refine-v22\.css/);assert.match(loader,/refine-v26\.css/);assert.match(html,/shop-v26\.js/);assert.match(html,/overview-v26\.js/);assert.doesNotMatch(html,/shop-v24\.js/);assert.doesNotMatch(html,/overview\.js\?v=19/);
console.log('v26 static: horizontal trips, refined overview, Lovis/Twos, scoreboard, social rewards and lightweight runtime checks passed.');
