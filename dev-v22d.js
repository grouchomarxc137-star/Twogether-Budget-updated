(() => {
'use strict';

const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const KEY='twogether_dev_origins_v22d';
let origins={};
let refs=new Map();
let scheduled=false;
try{origins=JSON.parse(localStorage.getItem(KEY)||'{}')||{};}catch{origins={};}

const active=()=>document.body.classList.contains('dev-v22');
const esc=v=>window.CSS?.escape?CSS.escape(String(v)):String(v).replace(/[^\w-]/g,'\\$&');
function selector(el){
  if(!el)return'';
  if(el===document.body)return'body';
  if(el.id)return'#'+esc(el.id);
  for(const a of ['data-current-plan','data-current-trip','data-open-trip','data-fin-month','data-fin-view','data-sheet','data-wish-index','data-dev22b-added']){
    if(el.hasAttribute?.(a))return`[${a}="${esc(el.getAttribute(a))}"]`;
  }
  const p=el.parentElement;if(!p)return'';
  const same=[...p.children].filter(x=>x.tagName===el.tagName);
  return `${selector(p)}>${el.tagName.toLowerCase()}:nth-of-type(${same.indexOf(el)+1})`;
}
function resolve(s){try{return document.querySelector(s)}catch{return null}}
function save(){try{localStorage.setItem(KEY,JSON.stringify(origins))}catch{}}
function stableKey(el){
  if(!el)return'';
  for(const a of ['data-current-plan','data-current-trip','data-open-trip','data-fin-month','data-wish-index','data-dev22b-added']){
    if(el.hasAttribute?.(a))return `${a}:${el.getAttribute(a)}`;
  }
  if(el.id)return `id:${el.id}`;
  return selector(el);
}
function selectedTarget(){
  const box=$('.dev22-selection:not([hidden])');if(!box)return null;
  const b=box.getBoundingClientRect();if(!b.width||!b.height)return null;
  const points=[[b.left+b.width/2,b.top+b.height/2],[b.left+Math.min(10,b.width/3),b.top+Math.min(10,b.height/3)],[b.right-Math.min(10,b.width/3),b.bottom-Math.min(10,b.height/3)]];
  let best=null,score=Infinity;
  const seen=new Set();
  points.forEach(([x,y])=>document.elementsFromPoint(Math.max(1,Math.min(innerWidth-1,x)),Math.max(1,Math.min(innerHeight-1,y))).forEach(n=>{
    for(let el=n;el&&el!==document.body;el=el.parentElement){
      if(el.closest?.('.dev22-selection,.dev22-inspector,.dev22-toolbar,.dev22-context,.dev22c-divider-layer,.dev22-note,.identity-modal'))continue;
      seen.add(el);
    }
  }));
  $$('[data-dev22c-floating="1"]').forEach(el=>seen.add(el));
  for(const el of seen){
    const r=el.getBoundingClientRect();if(!r.width||!r.height)continue;
    const s=Math.abs(r.left-b.left)+Math.abs(r.top-b.top)+Math.abs(r.right-b.right)+Math.abs(r.bottom-b.bottom)+Math.abs(r.width-b.width)*.25+Math.abs(r.height-b.height)*.25;
    if(s<score){score=s;best=el;}
  }
  return score<Math.max(30,(b.width+b.height)*.09)?best:null;
}
function rememberOrigin(el){
  if(!el||el.parentElement===document.body&&el.hasAttribute('data-dev22c-floating'))return;
  const parent=el.parentElement;if(!parent)return;
  const key=stableKey(el);if(!key)return;
  refs.set(key,el);
  if(origins[key])return;
  const children=[...parent.children],index=children.indexOf(el);
  origins[key]={
    elementSelector:selector(el),
    parentSelector:selector(parent),
    index,
    prevSelector:index>0?selector(children[index-1]):'',
    nextSelector:index>=0&&index<children.length-1?selector(children[index+1]):''
  };
  save();
}
function captureSelected(){if(!active())return;const el=selectedTarget();if(el&&!el.hasAttribute('data-dev22c-floating'))rememberOrigin(el);}
function captureNormalRefs(){
  for(const [key,o] of Object.entries(origins)){
    let el=refs.get(key);
    if(el?.isConnected&&el.parentElement!==document.body)continue;
    el=resolve(o.elementSelector);
    if(el)refs.set(key,el);
  }
}
function floatingSnapshot(){
  const arr=[];
  $$('[data-dev22c-floating="1"]').forEach(el=>{
    let key='';
    for(const [k,r] of refs)if(r===el){key=k;break;}
    if(!key){
      const sk=stableKey(el);if(origins[sk])key=sk;
      else{
        for(const [k,o] of Object.entries(origins)){
          if(o.elementSelector&&el.matches?.(o.elementSelector)){key=k;break;}
        }
      }
    }
    if(key){refs.set(key,el);arr.push([key,el]);}
  });
  return arr;
}
function insertAtOrigin(key,el){
  const o=origins[key];if(!o||!el?.isConnected)return;
  const parent=resolve(o.parentSelector);if(!parent)return;
  if(Number.isFinite(o.index)){
    const kids=[...parent.children].filter(x=>x!==el),idx=Math.max(0,Math.min(o.index,kids.length));
    parent.insertBefore(el,kids[idx]||null);
    return;
  }
  const prev=o.prevSelector?resolve(o.prevSelector):null,next=o.nextSelector?resolve(o.nextSelector):null;
  if(next&&next.parentElement===parent&&next!==el){parent.insertBefore(el,next);return;}
  if(prev&&prev.parentElement===parent&&prev!==el){parent.insertBefore(el,prev.nextSibling);return;}
  parent.appendChild(el);
}
function restoreExactOrder(snapshot){
  for(const [key,el] of snapshot)insertAtOrigin(key,el);
}
function beforeDevExit(){
  if(!active())return;
  const snap=floatingSnapshot();
  if(!snap.length)return;
  setTimeout(()=>restoreExactOrder(snap),0);
  setTimeout(()=>restoreExactOrder(snap),50);
}
function forgetIfReset(){
  if(!active())return;
  setTimeout(()=>{
    const hasDirect=localStorage.getItem('twogether_dev_direct_v22c');
    if(hasDirect){try{const d=JSON.parse(hasDirect);if(!Object.keys(d?.free||{}).length){origins={};refs.clear();save();}}catch{}}
  },20);
}
function scheduleCapture(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;captureSelected();});}

function init(){
  captureNormalRefs();
  window.addEventListener('click',e=>{
    const exit=e.target.closest?.('.dev22-exit');
    const toggle=e.target.closest?.('#twDevToggle');
    if((exit||toggle)&&active())beforeDevExit();
    if(toggle&&!active())captureNormalRefs();
  },true);
  document.addEventListener('click',e=>{
    const b=e.target.closest?.('button');if(!b)return;
    const txt=(b.textContent||'').trim().toLowerCase();
    if(active()&&txt.includes('move freely'))captureSelected();
    if(active()&&(txt.includes('reset selected')||b.matches('[data-reset]')))forgetIfReset();
  },true);
  document.addEventListener('contextmenu',()=>setTimeout(scheduleCapture,0),true);
  document.addEventListener('pointerup',()=>setTimeout(scheduleCapture,0),true);
  document.addEventListener('twogether:dev-changed',()=>{
    if(active()){captureNormalRefs();setTimeout(scheduleCapture,0);}else refs.clear();
  });
  const mo=new MutationObserver(records=>{
    if(!active())return;
    if(records.some(r=>r.target?.classList?.contains('dev22-selection')||r.type==='childList'))scheduleCapture();
  });
  mo.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['style','hidden','class']});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();