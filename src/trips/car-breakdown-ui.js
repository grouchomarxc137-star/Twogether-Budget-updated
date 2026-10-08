// Reusable accessible long-press / tap breakdown for Car spending.
import { carExpenseLabel } from './car-expenses.js';

const escapeText=(x)=>String(x??'').replace(/[&<>"']/g,(ch)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const euros=(amount)=>new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(Number(amount)||0);
export function showCarBreakdown(title, groups, total) {
  document.querySelector('.trip-car-breakdown-dialog')?.remove();
  const dialog=document.createElement('dialog');
  dialog.className='trip-car-breakdown-dialog';
  dialog.setAttribute('aria-label','Car spending details');
  const rows=(groups||[]).map((g)=>
    '<section class="trip-car-breakdown-group"><div class="trip-car-breakdown-group-head"><strong>'+escapeText(g.label)+'</strong><b>'+euros(g.amount)+'</b></div>'+
      (g.items||[]).map((item)=>'<div class="trip-car-breakdown-entry"><span>'+escapeText(item.name||carExpenseLabel(item))+
        (item.date?'<small>'+escapeText(item.date)+'</small>':'')+'</span><b>'+euros(item.amount)+'</b></div>').join('')+
    '</section>'
  ).join('');
  dialog.innerHTML='<div class="trip-car-breakdown-shell"><header><div><span class="panel-kicker">CAR SPENDING</span><h2>'+escapeText(title||'Car')+'</h2></div>'+
    '<button type="button" class="trip-car-breakdown-close" data-car-breakdown-close aria-label="Close">×</button></header>'+
    '<div class="trip-car-breakdown-total">Total Car expenses <strong>'+euros(total)+'</strong></div>'+
    (rows||'<p class="trip-car-breakdown-empty">No detailed Car expenses logged yet.</p>')+
    '</div>';
  document.body.appendChild(dialog);
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  dialog.querySelector('[data-car-breakdown-close]')?.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',(e)=>{if(e.target===dialog)dialog.close();});
  dialog.showModal();
}
export function installCarLongPress(element,open) {
  if(!element||typeof open!=='function')return;
  let timer=null,startX=0,startY=0,activated=false;
  const clear=()=>{if(timer!==null){clearTimeout(timer);timer=null;}};
  element.addEventListener('pointerdown',(e)=>{
    if(e.button!==0||e.target.closest('input,select'))return;
    clear();activated=false;startX=e.clientX;startY=e.clientY;
    timer=setTimeout(()=>{timer=null;activated=true;open();},500);
    e.stopPropagation();
  });
  element.addEventListener('pointermove',(e)=>{
    if(Math.abs(e.clientX-startX)>12||Math.abs(e.clientY-startY)>12)clear();
  });
  ['pointerup','pointercancel','pointerleave'].forEach(type=>element.addEventListener(type,clear));
  element.addEventListener('contextmenu',(e)=>{e.preventDefault();clear();});
  element.addEventListener('click',(e)=>{
    e.stopPropagation();e.preventDefault();
    if(!activated)open();
    activated=false;
  });
  element.addEventListener('keydown',(e)=>{
    if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();open();}
  });
}
