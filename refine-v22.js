(() => {
  'use strict';
  const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
  let pinned=null,closeTimer=null,installed=false;
  function closeAll(except=null,fade=true){
    clearTimeout(closeTimer);
    $$('.tw-nav-wrap').forEach(w=>{
      if(w===except)return;
      if(fade&&w.classList.contains('v22-open')){w.classList.add('v22-fade');setTimeout(()=>w.classList.remove('v22-open','v22-fade','menu-open','nav-visible'),125);}
      else w.classList.remove('v22-open','v22-fade','menu-open','nav-visible');
      w.querySelector('[data-hub]')?.setAttribute('aria-expanded','false');
    });
  }
  function openWrap(w){
    if(!w)return;
    if(pinned&&pinned!==w){pinned=null;closeAll(w,true);}
    else closeAll(w,false);
    w.classList.remove('v22-fade');w.classList.add('v22-open');w.classList.remove('menu-open','nav-visible');w.querySelector('[data-hub]')?.setAttribute('aria-expanded','true');
  }
  function scheduleClose(w){
    clearTimeout(closeTimer);
    closeTimer=setTimeout(()=>{if(pinned===w)return;w.classList.add('v22-fade');setTimeout(()=>{if(pinned!==w)w.classList.remove('v22-open','v22-fade','menu-open','nav-visible');},125);},180);
  }
  function installNavigation(){
    const wraps=$$('.tw-nav-wrap');if(!wraps.length)return;
    wraps.forEach(w=>{
      if(w.dataset.v22Nav==='1')return;w.dataset.v22Nav='1';
      const hub=w.querySelector('[data-hub]'),menu=w.querySelector('.tw-nav-menu');
      w.addEventListener('pointerenter',()=>{clearTimeout(closeTimer);openWrap(w);});
      w.addEventListener('pointerleave',()=>scheduleClose(w));
      menu?.addEventListener('pointerenter',()=>{clearTimeout(closeTimer);openWrap(w);});
      menu?.addEventListener('pointerleave',()=>scheduleClose(w));
      hub?.addEventListener('click',()=>{
        if(pinned===w){pinned=null;openWrap(w);scheduleClose(w);}else{pinned=w;openWrap(w);}
      },true);
      menu?.addEventListener('click',()=>{pinned=null;closeAll(null,true);});
    });
    if(!installed){
      installed=true;
      window.addEventListener('scroll',()=>{pinned=null;closeAll(null,true);},{passive:true});
      document.addEventListener('pointerdown',e=>{if(!e.target.closest?.('.tw-nav-wrap')){pinned=null;closeAll(null,true);}},true);
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
