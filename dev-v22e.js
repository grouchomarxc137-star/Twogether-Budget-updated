(() => {
'use strict';

let wasDev=document.body.classList.contains('dev-v22');
let token=0;

function notifyEnter(){
  const id=++token;
  let tries=0;
  const tick=()=>{
    if(id!==token)return;
    const ready=document.body.classList.contains('dev-v22')&&!!window.TwogetherDevV22?.active;
    if(ready){
      document.dispatchEvent(new CustomEvent('twogether:dev-changed',{detail:{reason:'dev-enter-reapply'}}));
      return;
    }
    if(++tries<12)requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function onClassChange(){
  const now=document.body.classList.contains('dev-v22');
  if(now&&!wasDev)notifyEnter();
  if(!now&&wasDev)token++;
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
