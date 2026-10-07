import { actor } from '../lib/session.js';
import { toast } from '../lib/toast.js';

let swipe={tracking:false,active:false,startX:0,startY:0,lastX:0,row:null};
let ignoreClickUntil=0;
let confirmLayer=null;
const mobile=()=>window.matchMedia?.('(max-width:760px)')?.matches??window.innerWidth<=760;
const esc=(v)=>String(v??'').replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const card=(row)=>row?.querySelector('.our-stay-card');
const reveal=(row)=>row?.querySelector('.our-stay-delete-underlay');

function reset(row,animate=true){
  if(!row)return;
  const c=card(row),r=reveal(row);
  if(r){
    r.style.pointerEvents='none';r.style.zIndex='1';r.style.right='0';r.style.width='0px';r.style.opacity='0';
    r.style.background='var(--tv2-over)';r.style.color='white';r.style.fontSize='14px';
    r.style.transition=animate?'width .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease':'none';
  }
  if(c){
    c.style.zIndex='2';
    c.style.transition=animate?'transform .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease':'none';
    c.style.transform='translateX(0)';c.style.opacity='1';
  }
  if(animate)setTimeout(()=>{if(c?.isConnected)c.style.transition='';if(r?.isConnected)r.style.transition='';},220);
}
function resetState(){swipe={tracking:false,active:false,startX:0,startY:0,lastX:0,row:null};}
function paint(row,distance){
  const c=card(row),r=reveal(row);if(!c||!r)return;
  const exposed=Math.abs(distance);
  c.style.transition='none';c.style.transform='translateX('+distance+'px)';
  r.style.transition='none';r.style.width=exposed+'px';r.style.opacity=String(Math.min(1,.35+exposed/120));
}
function finish(row){
  const c=card(row),r=reveal(row),width=row.getBoundingClientRect().width||window.innerWidth-32;
  if(c){c.style.transition='transform .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease';c.style.transform='translateX(-'+width+'px)';c.style.opacity='.76';}
  if(r){r.style.transition='width .2s cubic-bezier(.22,.8,.28,1), opacity .16s ease';r.style.width=width+'px';r.style.opacity='1';}
}
function closeConfirm(){confirmLayer?.remove();confirmLayer=null;}
async function deleteFavorite(id){
  await window.TwogetherAPI.post('deleteStayFavorite',{ownerPlanId:'',favoriteId:id},actor());
  toast('Removed from Our Stays');
  document.dispatchEvent(new CustomEvent('twogether:saved'));
}
function openConfirm(id){
  closeConfirm();
  const fav=(window.TwogetherAPI?.state?.()?.stayFavorites||[]).find((x)=>x.id===id);if(!fav)return;
  confirmLayer=document.createElement('div');
  confirmLayer.className='tv2-confirm-layer';
  confirmLayer.innerHTML='<div class="tv2-confirm-backdrop" data-confirm-cancel></div><div class="tv2-confirm-card" role="dialog" aria-modal="true"><h2>Delete favourite?</h2><p>Are you sure you want to delete <strong>'+esc(fav.name||'this stay')+'</strong>?</p><p class="tv2-confirm-note">This removes it from Our Stays. Any trip expense already logged stays untouched.</p><p class="tv2-confirm-error" aria-live="polite"></p><div class="tv2-confirm-actions"><button type="button" data-confirm-cancel>Cancel</button><button type="button" class="is-delete" data-confirm-delete>Delete</button></div></div>';
  document.body.appendChild(confirmLayer);
  confirmLayer.querySelectorAll('[data-confirm-cancel]').forEach((b)=>b.addEventListener('click',closeConfirm));
  const del=confirmLayer.querySelector('[data-confirm-delete]');
  del?.addEventListener('click',async()=>{
    del.disabled=true;del.textContent='Deleting…';
    try{await deleteFavorite(id);closeConfirm();}
    catch(e){del.disabled=false;del.textContent='Delete';const err=confirmLayer?.querySelector('.tv2-confirm-error');if(err)err.textContent=e?.message||'Could not remove this stay';}
  });
  setTimeout(()=>del?.focus(),0);
}

['pointerdown','pointermove','pointerup','pointercancel'].forEach((type)=>document.addEventListener(type,(e)=>{
  if((e.pointerType==='touch'||e.pointerType==='pen')&&e.target.closest?.('[data-stay-swipe]'))e.stopImmediatePropagation();
},true));
document.addEventListener('click',(e)=>{
  if(Date.now()<ignoreClickUntil&&e.target.closest?.('[data-stay-swipe]')){e.preventDefault();e.stopImmediatePropagation();}
},true);

document.addEventListener('touchstart',(e)=>{
  if(!mobile()||confirmLayer||e.touches.length!==1)return;
  const row=e.target.closest?.('[data-stay-swipe]');if(!row)return;
  document.querySelectorAll('[data-stay-swipe]').forEach((x)=>{if(x!==row)reset(x,true);});
  reset(row,false);
  const t=e.touches[0];swipe={tracking:true,active:false,startX:t.clientX,startY:t.clientY,lastX:t.clientX,row};
},{passive:true});
document.addEventListener('touchmove',(e)=>{
  if(!swipe.tracking||!swipe.row||e.touches.length!==1)return;
  const t=e.touches[0],dx=t.clientX-swipe.startX,dy=Math.abs(t.clientY-swipe.startY);swipe.lastX=t.clientX;
  if(!swipe.active){
    if(Math.abs(dx)<8&&dy<8)return;
    const horizontal=Math.abs(dx)>dy*1.2;
    if(horizontal&&dx<-10)swipe.active=true;
    else if(dy>=Math.abs(dx)||(horizontal&&Math.abs(dx)>10)){reset(swipe.row,true);resetState();return;}
  }
  if(!swipe.active)return;
  e.preventDefault();
  const width=swipe.row.getBoundingClientRect().width||window.innerWidth-32;
  paint(swipe.row,Math.min(0,Math.max(-width*.94,dx)));
},{passive:false});
document.addEventListener('touchend',()=>{
  if(!swipe.tracking||!swipe.row){resetState();return;}
  const row=swipe.row,dx=swipe.lastX-swipe.startX,width=row.getBoundingClientRect().width||window.innerWidth-32;
  const full=swipe.active&&-dx>=Math.max(180,width*.62);
  if(!swipe.active){reset(row,true);resetState();return;}
  ignoreClickUntil=Date.now()+550;
  if(!full){reset(row,true);resetState();return;}
  const id=row.dataset.staySwipe||'';finish(row);resetState();
  setTimeout(()=>{reset(row,false);openConfirm(id);},180);
},{passive:true});
document.addEventListener('touchcancel',()=>{reset(swipe.row,true);resetState();},{passive:true});
document.addEventListener('twogether:saved',()=>requestAnimationFrame(()=>document.querySelectorAll('[data-stay-swipe]').forEach((row)=>reset(row,false))));
