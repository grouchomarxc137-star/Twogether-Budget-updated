const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const html=fs.readFileSync('index.html','utf8');let count=0;
for(const match of html.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css))(?:[?#][^"]*)?"/g)){const file=match[1];if(/^https?:/.test(file))continue;assert(fs.existsSync(file),'Missing asset '+file);if(file.endsWith('.js')){new vm.Script(fs.readFileSync(file,'utf8'),{filename:file});count++;}}
new vm.Script(fs.readFileSync('backend/Code.gs','utf8'),{filename:'backend/Code.gs'});assert.equal(fs.readFileSync('backend/Code.gs','utf8'),fs.readFileSync('backend/Code-v17.gs','utf8'));assert(!fs.readFileSync('workflow.js','utf8').includes('cleanupLonatoTrips'));assert(!fs.readFileSync('workflow.js','utf8').includes("setTimeout(()=>body.querySelector('[data-skip-budget]')"));
console.log(`Validated ${count} frontend scripts, referenced styles, backend syntax and canonical backend copy.`);
