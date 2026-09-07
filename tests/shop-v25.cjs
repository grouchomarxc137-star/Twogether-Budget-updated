const assert=require('assert/strict'),fs=require('fs');
const js=fs.readFileSync('shop-v25.js','utf8'),css=fs.readFileSync('shop-v25.css','utf8'),refine=fs.readFileSync('refine-v25.css','utf8'),nav=fs.readFileSync('refine-v22.js','utf8');
for(const cost of [20,30,40,50,60,70,80,100,120,150])assert.match(js,new RegExp(`cost:${cost}`));
assert.match(js,/5,'logged'/);assert.match(js,/10,'trip confirmed'/);assert.match(js,/15,'month confirmed'/);
assert.match(js,/Lovis/);assert.doesNotMatch(js,/\btokens\b/i);assert.match(js,/Principessa/);assert.match(js,/500/);assert.match(js,/TEST_KEY/);
for(const id of ['gold-heart','cute-icons','sparkle-cards','trip-countdown','theme-pack','packing-list','travel-passport','custom-dashboard','trip-planner-plus','world-map'])assert.match(js,new RegExp(id));
assert.match(css,/shop-theme-night/);assert.match(css,/lovis-dashboard/);assert.match(css,/lovis-map-wrap/);assert.match(refine,/tw-current-numbers/);assert.match(refine,/gap:8px/);assert.doesNotMatch(nav,/observe\(document\.body/);
console.log('v25 Lovis shop, rewards, trip cards and lightweight navigation checks passed.');
