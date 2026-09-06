(() => {
  'use strict';
  const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
  let pinned=null,installed=false;
  const closeTimers=new WeakMap(),fadeTimers=new WeakMap();

  function cancelTimers(w){
    const a=closeTimers.get(w),b=fadeTimers.get(w);if(a)clearTimeout(a);if(b)clearTimeout(b);closeTimers.delete(w);fadeTimers.delete(w);
  }
  function setExpanded(w,on){w?.querySelector('[data-hub]')?.setAttribute('aria-expanded',on?'true':'false');}
  function hardClose(w){
    if(!w)return;cancelTimers(w);w.classList.remove('v22-open','v22-fade','menu-open','nav-visible');setExpanded(w,false);
  }
  function fadeClose(w){
    if(!w)return;cancelTimers(w);setExpanded(w,false);
    if(!w.classList.contains('v22-open'))return hardClose(w);
    w.classList.add('v22-fade');
    const t=setTimeout(()=>{w.classList.remove('v22-open','v22-fade','menu-open','nav-visible');fadeTimers.delete(w);},135);fadeTimers.set(w,t);
  }
  function closeOthers(except,fade=true){
    $$('.tw-nav-wrap').forEach(w=>{if(w!==except)(fade?fadeClose(w):hardClose(w));});
  }
  function openWrap(w){
    if(!w)return;cancelTimers(w);closeOthers(w,true);w.classList.remove('v22-fade','menu-open','nav-visible');w.classList.add('v22-open');setExpanded(w,true);
  }
  function scheduleClose(w){
    if(!w||pinned===w)return;cancelTimers(w);
    const t=setTimeout(()=>{if(pinned!==w)fadeClose(w);closeTimers.delete(w);},170);closeTimers.set(w,t);
  }
  function unpinAndFadeAll(){
    pinned=null;$$('.tw-nav-wrap').forEach(fadeClose);
  }
  function installNavigation(){
    const wraps=$$('.tw-nav-wrap');if(!wraps.length)return;
    wraps.forEach(w=>{
      if(w.dataset.v22Nav==='2')return;w.dataset.v22Nav='2';
      const hub=w.querySelector('[data-hub]'),menu=w.querySelector('.tw-nav-menu');
      w.addEventListener('pointerenter',()=>{
        cancelTimers(w);
        if(pinned&&pinned!==w){const old=pinned;pinned=null;fadeClose(old);}
        openWrap(w);
      });
      w.addEventListener('pointerleave',()=>scheduleClose(w));
      menu?.addEventListener('pointerenter',()=>{cancelTimers(w);openWrap(w);});
      menu?.addEventListener('pointerleave',()=>scheduleClose(w));
      hub?.addEventListener('click',()=>{
        if(pinned===w){pinned=null;openWrap(w);scheduleClose(w);}
        else{
          const old=pinned;pinned=w;if(old&&old!==w)fadeClose(old);openWrap(w);
        }
      },true);
      menu?.addEventListener('click',()=>unpinAndFadeAll());
    });
    if(!installed){
      installed=true;
      let scrollQueued=false;
      window.addEventListener('scroll',()=>{
        if(scrollQueued)return;scrollQueued=true;
        requestAnimationFrame(()=>{scrollQueued=false;unpinAndFadeAll();});
      },{passive:true});
      document.addEventListener('pointerdown',e=>{if(!e.target.closest?.('.tw-nav-wrap'))unpinAndFadeAll();},true);
      document.addEventListener('keydown',e=>{if(e.key==='Escape')unpinAndFadeAll();},true);
    }
  }

  function cleanPriorityMetadata(cell){
    const t=cell?.querySelector('.wishlist-note-text');if(!t)return;
    t.textContent=String(t.textContent||'').replace(/^\s*\[\[P[1-5]\]\]\s*/i,'');
  }
  function enhanceWishlist(){
    const root=$('#financeWishlist'),table=root&&$('.wishlist-table',root);if(!table)return;
    const rows=$$('tbody tr',table);
    rows.forEach(tr=>{
      const cells=[...tr.children];if(!cells.length)return;
      if(cells.length>=5){cells[0].classList.add('v22-wish-prio');cells[1].classList.add('v22-wish-item');cells[2].classList.add('v22-wish-note');cells[3].classList.add('v22-wish-price');cells[4].classList.add('v22-wish-edit');cleanPriorityMetadata(cells[2]);}
      else{cells[0]?.classList.add('v22-wish-item');cells[1]?.classList.add('v22-wish-note');cells[2]?.classList.add('v22-wish-price');cells[3]?.classList.add('v22-wish-edit');}
      const note=tr.querySelector('.v22-wish-note');if(note){const visible=(note.innerText||'').trim();note.classList.toggle('v22-empty',!visible);}
    });
    table.dataset.v22Board='1';
  }

  let scheduled=false,observer=null;
  function enhance(){installNavigation();enhanceWishlist();}
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;enhance();});}
  function init(){
    enhance();
    if(!observer){observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','data-prio']});}
    document.addEventListener('twogether:wishlist-rendered',()=>setTimeout(enhanceWishlist,0));
    document.addEventListener('twogether:finance-view',()=>setTimeout(enhanceWishlist,0));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
