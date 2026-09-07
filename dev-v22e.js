(() => {
'use strict';

const DIRECT_KEY='twogether_dev_direct_v22c';
const ORIGIN_KEY='twogether_dev_origins_v22d';
let wasDev=document.body.classList.contains('dev-v22');
let token=0;
const fallbackSession=new Map();

const esc=v=>window.CSS?.escape?CSS.escape(String(v)):String(v).replace(/[^\w-]/g,'\\$&');
function readJson(key){try{return JSON.parse(localStorage.getItem(key)||'{}')||{}}catch{return{}}}
function directFree(){return readJson(DIRECT_KEY).free||{}}
function origins(){return readJson(ORIGIN_KEY)||{}}
function resolve(sel){try{return document.querySelector(sel)}catch{return null}}
function fromStableKey(key){
  if(!key)return null;
  if(key.startsWith('id:'))return document.getElementById(key.slice(3));
  const i=key.indexOf(':');if(i<1)return null;
  const attr=key.slice(0,i),value=key.slice(i+1);
  if(!/^data-[\w-]+$/.test(attr))return null;
  try{return document.querySelector(`[${attr}="${esc(value)}"]`)}catch{return null}
}
function findElement(selector){
  const direct=resolve(selector);if(direct)return direct;
  const os=origins();
  for(const [stable,o] of Object.entries(os)){
    if(o?.elementSelector!==selector)continue;
    const byStable=fromStableKey(stable);if(byStable)return byStable;
    const parent=resolve(o.parentSelector);if(!parent)continue;
    const kids=[...parent.children],idx=Math.max(0,Math.min(Number(o.index)||0,kids.length-1));
    if(kids[idx])return kids[idx];
  }
  return null;
}
function rememberFallback(el){
  if(!el||fallbackSession.has(el))return;
  const parent=el.parentNode,index=parent?.children?[...parent.children].indexOf(el):-1;
  fallbackSession.set(el,{style:el.getAttribute('style'),parent,index});
}
function restoreFallback(){
  for(const [el,s] of [...fallbackSession.entries()].reverse()){
    if(!el?.isConnected||!s.parent?.isConnected)continue;
    if(el.parentNode!==s.parent){
      const kids=[...s.parent.children].filter(x=>x!==el),idx=Math.max(0,Math.min(s.index<0?kids.length:s.index,kids.length));
      s.parent.insertBefore(el,kids[idx]||null);
    }
    if(s.style==null)el.removeAttribute('style');else el.setAttribute('style',s.style);
    el.classList.remove('dev22c-floating','dev22-dragging');
    el.removeAttribute('data-dev22c-floating');
  }
  fallbackSession.clear();
}
function fallbackReapply(id){
  if(id!==token||!document.body.classList.contains('dev-v22')||!window.TwogetherDevV22?.active)return;
  for(const [selector,f] of Object.entries(directFree())){
    const el=findElement(selector);if(!el)continue;
    const cs=getComputedStyle(el);
    if(el.parentElement===document.body&&cs.position==='absolute'&&el.hasAttribute('data-dev22c-floating'))continue;
    rememberFallback(el);
    if(el.parentElement!==document.body)document.body.appendChild(el);
    el.classList.add('dev22c-floating');el.dataset.dev22cFloating='1';
    Object.assign(el.style,{
      position:'absolute',
      left:`${Math.max(0,Number(f.x)||0)}px`,
      top:`${Math.max(0,Number(f.y)||0)}px`,
      width:f.w?`${Math.max(40,Number(f.w))}px`:el.style.width,
      height:f.h?`${Math.max(28,Number(f.h))}px`:el.style.height,
      margin:'0',
      zIndex:String(f.z||22000)
    });
  }
}
function notifyEnter(){
  const id=++token;
  let tries=0;
  const tick=()=>{
    if(id!==token)return;
    const ready=document.body.classList.contains('dev-v22')&&!!window.TwogetherDevV22?.active;
    if(ready){
      document.dispatchEvent(new CustomEvent('twogether:dev-changed',{detail:{reason:'dev-enter-reapply'}}));
      setTimeout(()=>fallbackReapply(id),90);
      return;
    }
    if(++tries<16)requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function onClassChange(){
  const now=document.body.classList.contains('dev-v22');
  if(now&&!wasDev)notifyEnter();
  if(!now&&wasDev){token++;restoreFallback();}
  wasDev=now;
}

function install(){
  wasDev=document.body.classList.contains('dev-v22');
  const mo=new MutationObserver(onClassChange);
  mo.observe(document.body,{attributes:true,attributeFilter:['class']});
  if(wasDev)notifyEnter();
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
