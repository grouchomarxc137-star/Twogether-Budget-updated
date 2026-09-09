(() => {
  'use strict';

  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const ACTORS=['Principessa','Principe'];
  const ACTOR_KEY='twogether_actor_v1';
  const MONEY_KEYS=['travel','accom','fuel','groceries','eat','tolls','other'];
  const PARTIAL_ORDER=['travel','accom','fuel','groceries','eat','tolls','other'];
  const LABELS={travel:'Flights / Train',accom:'Accommodation',fuel:'Fuel',groceries:'Groceries',eat:'Eating out',tolls:'Tolls / Parking',other:'Other'};
  let remoteState=null;
  let refreshing=false;
  let wishlistEnhancing=false;
  let overlayObserver=null;
  let storyObserver=null;
  let actorObserver=null;

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
  const n=v=>{const x=Number(String(v??'').replace(',','.'));return Number.isFinite(x)?x:0;};
  const money=v=>'€'+n(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtDate=v=>{if(!v)return '—';const [y,m,d]=String(v).split('-');return y&&m&&d?`${d}/${m}/${y}`:String(v);};
  function actor(){const a=document.body.dataset.actor||localStorage.getItem(ACTOR_KEY)||'';return ACTORS.includes(a)?a:'';}
  function otherActor(){return actor()==='Principessa'?'Principe':'Principessa';}
  function has(v){return v!==''&&v!=null;}
  function isLocked(t){return !!(t?.confirmed?.Principessa&&t?.confirmed?.Principe);}
  function tripMeta(t){return t?.submissions?.[t?.createdBy]||t?.submissions?.Principessa||t?.submissions?.Principe||{};}
  function locationLabel(m){return m?.location==='Other'?(m.otherLocation||'Other'):(m?.location||'—');}
  function toast(msg,tone='ok'){const el=$('#toast');if(!el)return;el.textContent=msg;el.className='toast show '+tone;clearTimeout(el._v18);el._v18=setTimeout(()=>el.className='toast',2800);}

  function ensureNavigation(){
    if($('.tw-v18-nav-wrap'))return;
    const hub=$('.hub-tabs');if(!hub)return;
    const defs=[
      {key:'trips',items:[['Log trip',()=>$('.trip-subnav [data-sheet="log"]')],['Monthly',()=>$('.trip-subnav [data-sheet="monthly"]')],['Compare',()=>$('.trip-subnav [data-sheet="compare"]')]]},
      {key:'finances',items:[['Overview',()=>$('.finance-subnav [data-fin-subview="overview"]')],['Monthly finances',()=>$('.finance-subnav [data-fin-subview="monthly"]')],['Balances & loans',()=>$('.finance-subnav [data-fin-subview="balances"]')],['Test scenarios',()=>$('.finance-subnav [data-fin-subview="scenarios"]')]]}
    ];
    defs.forEach(def=>{
      const main=$(`[data-hub="${def.key}"]`,hub);if(!main)return;
      const wrap=document.createElement('div');wrap.className='tw-nav-wrap tw-v18-nav-wrap';main.parentNode.insertBefore(wrap,main);wrap.appendChild(main);main.setAttribute('aria-haspopup','menu');main.setAttribute('aria-expanded','false');
      const menu=document.createElement('div');menu.className='tw-nav-menu';menu.setAttribute('role','menu');
      def.items.forEach(([label,getTarget])=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.setAttribute('role','menuitem');b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();getTarget()?.click();});menu.appendChild(b);});
      wrap.appendChild(menu);
    });
  }

  function ensureSessionControls(){
    const top=$('.top-actions');if(!top)return;
    let dev=$('#twDevToggle');
    if(!dev){dev=document.createElement('button');dev.id='twDevToggle';dev.type='button';dev.className='tw-dev-toggle';dev.textContent='Dev';top.appendChild(dev);dev.addEventListener('click',()=>{if(window.TwogetherDevV18?.active)window.TwogetherDevV18.exit();else window.TwogetherDevV18?.enter();});}
    syncBadge();
  }

  function syncBadge(){
    const badge=$('#loggedUserBadge');const a=actor();const inDev=!!window.TwogetherDevV18?.active;
    const dev=$('#twDevToggle');if(dev)dev.hidden=!a;
    if(!badge||!a)return;
    badge.style.pointerEvents='auto';badge.style.cursor='pointer';badge.setAttribute('role','button');badge.setAttribute('tabindex','0');
    if(inDev){badge.textContent='DEV';badge.title='Leave DEV and return to '+a;badge.setAttribute('aria-label','DEV mode. Return to '+a);if(dev)dev.textContent='Exit DEV';}
    else{badge.textContent=a;badge.title='Switch to '+otherActor();badge.setAttribute('aria-label','Logged in as '+a+'. Switch to '+otherActor());if(dev)dev.textContent='Dev';}
  }

  function switchActor(){
    if(window.TwogetherDevV18?.active){window.TwogetherDevV18.exit();return;}
    const next=otherActor();const choice=$(`.identity-choice[data-actor="${next}"]`);if(!choice)return;
    choice.click();setTimeout(()=>{syncBadge();refreshState(true);},120);
  }

  function installSessionEvents(){
    document.addEventListener('click',e=>{if(e.target.closest?.('#loggedUserBadge')){e.preventDefault();e.stopImmediatePropagation();switchActor();}},true);
    document.addEventListener('keydown',e=>{if(e.target?.id==='loggedUserBadge'&&(e.key==='Enter'||e.key===' ')){e.preventDefault();switchActor();}},true);
    if(actorObserver)actorObserver.disconnect();actorObserver=new MutationObserver(()=>{syncBadge();setTimeout(()=>refreshState(true),60);});actorObserver.observe(document.body,{attributes:true,attributeFilter:['data-actor']});
  }

  function simplifyStaticCopy(){
    const hero=$('#log .hero-copy');if(hero){const p=$('p',hero);if(p)p.textContent='';}
    const compare=$('#compare .page-heading');if(compare){const eyebrow=$('.eyebrow',compare);if(eyebrow)eyebrow.textContent='';const p=$('p',compare);if(p)p.textContent='Compare your current costs with possible next steps.';}
    const storyHeading=$('#log .trip-gallery-section .section-heading');if(storyHeading){$('.panel-kicker',storyHeading)?.replaceChildren(document.createTextNode('CONFIRMED'));const h=$('h2',storyHeading);if(h)h.textContent='Trip stories';const p=$('p',storyHeading);if(p)p.textContent='Only trips confirmed by both of you appear here.';}
  }

  function startNewTrip(){
    $('#restartWizard')?.click();
    setTimeout(()=>{const b=$('#wizardBody [data-trip-pick="new"]');if(b)b.click();else $('#wizardCard')?.scrollIntoView({behavior:'smooth',block:'center'});},60);
  }

  function ensureCurrentTrips(){
    const gallery=$('#log .trip-gallery-section');if(!gallery)return null;
    let section=$('#twCurrentTripsSection');
    if(!section){
      section=document.createElement('section');section.id='twCurrentTripsSection';section.className='tw-current-trips-section';
      section.innerHTML='<div class="tw-current-head"><div><span class="panel-kicker">NOW</span><h2 id="twCurrentTitle">Current Trips</h2><p>Trips being planned, logged or matched stay here.</p></div><button class="btn ghost" type="button" data-v18-new-trip>Plan a trip</button></div><div id="twCurrentTrips" class="tw-current-list"></div>';
      gallery.parentNode.insertBefore(section,gallery);
      $('[data-v18-new-trip]',section)?.addEventListener('click',startNewTrip);
      section.addEventListener('click',e=>{
        const card=e.target.closest('[data-current-plan],[data-current-trip]');if(!card)return;
        if(card.dataset.currentPlan){
          const id=card.dataset.currentPlan;const plan=remoteState?.plans?.find(p=>p.id===id);if(!plan)return;
          if(e.target.closest('[data-current-budget]'))return window.TwogetherWorkflow?.budget(id);
          if(e.target.closest('[data-current-expenses]'))return window.TwogetherWorkflow?.start(id);
          if(e.target.closest('[data-current-open],.tw-current-main'))return window.TwogetherOverview?.open(plan);
        }else{
          const id=card.dataset.currentTrip;if(e.target.closest('[data-current-open],.tw-current-main'))window.TwogetherApp?.open(id);
        }
      });
    }
    return section;
  }

  function expenseTotal(plan,trip){
    const a=trip?.submissions?.Principessa||plan?.partials?.Principessa||{};
    const b=trip?.submissions?.Principe||plan?.partials?.Principe||{};
    return MONEY_KEYS.reduce((sum,key)=>{
      const shared=plan?.sharedExpenses?.[key]||trip?.sharedExpenses?.[key];
      if(has(shared?.total))return sum+n(shared.total);
      const av=has(a?.[key])?n(a[key]):null,bv=has(b?.[key])?n(b[key]):null;
      if(av!=null&&bv!=null)return sum+Math.max(av,bv);
      return sum+(av??bv??0);
    },0);
  }

  function planCard(plan,trip){
    const meta=plan?.meta||{};const a=actor();const p=plan?.budgets?.Principessa,q=plan?.budgets?.Principe;
    const totalBudget=(has(p)?n(p):0)+(has(q)?n(q):0);const spent=expenseTotal(plan,trip);
    const status=trip||plan?.partials?.Principessa||plan?.partials?.Principe?'In progress':(has(p)&&has(q)?'Planned':'Waiting for budget');
    const ownLabel=a==='Principe'?'Principe budget':'Principessa budget';const ownBudget=a==='Principe'?q:p;
    return `<article class="tw-current-card" data-current-plan="${esc(plan.id)}"><button class="tw-current-main" type="button"><div class="tw-current-top"><span class="trip-country">${esc(locationLabel(meta))}</span><span class="tw-current-status">${esc(status)}</span></div><h3>${esc(meta.city||locationLabel(meta))}</h3><p>${fmtDate(meta.start)}–${fmtDate(meta.end)}</p><div class="tw-current-numbers"><div><span>${ownLabel}</span><strong>${has(ownBudget)?money(ownBudget):'Not set'}</strong></div><div><span>Total budget</span><strong>${has(p)||has(q)?money(totalBudget):'Not set'}</strong></div><div><span>Trip so far</span><strong>${money(spent)}</strong></div></div></button><div class="tw-current-actions"><button class="text-btn" type="button" data-current-budget>${has(plan?.budgets?.[a])?'Edit my budget':'Add my budget'}</button><button class="btn ghost" type="button" data-current-expenses>${trip?.submissions?.[a]?'Edit expenses':plan?.partials?.[a]?'Continue expenses':'Add expenses'}</button><button class="text-btn" type="button" data-current-open>Open trip</button></div></article>`;
  }

  function standaloneCard(trip){
    const meta=tripMeta(trip);const spent=expenseTotal({},trip);
    const ownLabel=actor()==='Principe'?'Principe budget':'Principessa budget';
    return `<article class="tw-current-card" data-current-trip="${esc(trip.id)}"><button class="tw-current-main" type="button"><div class="tw-current-top"><span class="trip-country">${esc(locationLabel(meta))}</span><span class="tw-current-status">In progress</span></div><h3>${esc(meta.city||locationLabel(meta))}</h3><p>${fmtDate(meta.start)}–${fmtDate(meta.end)}</p><div class="tw-current-numbers"><div><span>${ownLabel}</span><strong>—</strong></div><div><span>Total budget</span><strong>${has(trip.budget)?money(trip.budget):'Not set'}</strong></div><div><span>Trip so far</span><strong>${money(spent)}</strong></div></div></button><div class="tw-current-actions"><button class="text-btn" type="button" data-current-open>Open trip</button></div></article>`;
  }

  function renderCurrentTrips(){
    const section=ensureCurrentTrips(),root=$('#twCurrentTrips');if(!section||!root||!remoteState)return;
    const trips=remoteState.trips||[],plans=remoteState.plans||[];const tripMap=new Map(trips.map(t=>[t.id,t]));const linked=new Set(plans.map(p=>p.linkedTripId).filter(Boolean));
    const activePlans=plans.filter(p=>!isLocked(tripMap.get(p.linkedTripId))).sort((a,b)=>String(b?.meta?.start||b.updatedAt||'').localeCompare(String(a?.meta?.start||a.updatedAt||'')));
    const standalone=trips.filter(t=>!isLocked(t)&&!linked.has(t.id)).sort((a,b)=>String(tripMeta(b).start||b.updatedAt||'').localeCompare(String(tripMeta(a).start||a.updatedAt||'')));
    const count=activePlans.length+standalone.length;$('#twCurrentTitle').textContent=count===1?'Current Trip':'Current Trips';
    root.innerHTML=count?activePlans.map(p=>planCard(p,tripMap.get(p.linkedTripId))).join('')+standalone.map(standaloneCard).join(''):'<div class="tw-current-empty"><strong>No current trips</strong><span>Start a trip when you are ready.</span></div>';
    document.dispatchEvent(new CustomEvent('twogether:v18-rendered'));
  }

  function filterTripStories(){
    const root=$('#tripGallery');if(!root||!remoteState)return;
    const locked=new Set((remoteState.trips||[]).filter(isLocked).map(t=>t.id));let shown=0;
    $$('[data-open-trip]',root).forEach(card=>{const yes=locked.has(card.dataset.openTrip);card.classList.toggle('tw-v18-hidden',!yes);if(yes)shown++;});
    root.querySelector('.tw-story-empty')?.remove();
    if(!shown){const e=document.createElement('div');e.className='empty-state gallery-empty tw-story-empty';e.innerHTML='<strong>No confirmed trips yet</strong><span>Completed trips move here after both of you confirm them.</span>';root.appendChild(e);}
  }

  async function refreshState(force=false){
    if(refreshing||!window.TwogetherAPI)return;refreshing=true;
    try{remoteState=await window.TwogetherAPI.state();renderCurrentTrips();filterTripStories();enhanceTripModal();}
    catch(err){if(force)toast(err.message||'Could not refresh shared trips','warn');}
    finally{refreshing=false;}
  }

  function enhanceTripChoices(){
    $$('.trip-pick').forEach(btn=>{
      if(btn.dataset.v18Choice==='1')return;const strong=btn.querySelector('strong'),icon=btn.querySelector('.pick-icon');if(!strong)return;const text=strong.textContent.trim();
      if(/^Yes ·/i.test(text)){strong.textContent=text.replace(/^Yes ·\s*/i,'Log expenses · ');if(icon)icon.textContent='→';}
      if(/^No · this is a different trip/i.test(text)){strong.textContent='Start a different trip';if(icon)icon.textContent='+';}
      if(/Start a new trip/i.test(text)&&icon)icon.textContent='+';if(/Add your version/i.test(text)&&icon)icon.textContent='→';if(/Match the differences/i.test(text)&&icon)icon.textContent='=';btn.dataset.v18Choice='1';
    });
  }

  function enhancePartialPicker(){
    const overlay=$('#workflowV5Overlay');if(!overlay?.classList.contains('show'))return;
    const title=$('.v5-question h2',overlay)?.textContent?.trim();if(title!=='What do you want to log?')return;
    const stack=$('.v5-choice-stack',overlay);if(!stack||stack.dataset.v18Expanded==='1')return;
    const originals=$$('[data-v5-partial-key]',stack);if(!originals.length)return;const proxy=originals[0];const saved=new Set($$('[data-v5-partial-saved]',overlay).map(b=>b.dataset.v5PartialSaved));
    stack.innerHTML='';stack.classList.add('v18-partial-picker');
    PARTIAL_ORDER.filter(k=>!saved.has(k)).forEach(key=>{const clone=proxy.cloneNode(true);clone.dataset.v5PartialKey=key;const strong=clone.querySelector('strong'),small=clone.querySelector('small'),icon=clone.querySelector('.pick-icon');if(strong)strong.textContent=LABELS[key];if(small)small.textContent='Add '+LABELS[key].toLowerCase();if(icon)icon.textContent=key==='travel'?'✈':key==='accom'?'⌂':key==='fuel'?'⛽':'+';clone.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();proxy.dataset.v5PartialKey=key;proxy.click();});stack.appendChild(clone);});
    stack.dataset.v18Expanded='1';const help=$('.v5-question>p',overlay);if(help)help.textContent='Choose any category now. Flights, accommodation and fuel are listed first.';
  }

  function parseMoney(text){
    let s=String(text||'').replace(/[^0-9,.-]/g,'');if(!s)return null;const c=s.lastIndexOf(','),d=s.lastIndexOf('.');
    if(c>=0&&d>=0){const dec=c>d?',':'.',thou=dec===','?'.':',';s=s.split(thou).join('').replace(dec,'.');}
    else if(c>=0){const tail=s.length-c-1;s=tail===2?s.replace(',','.'):s.replace(/,/g,'');}
    else if(d>=0){const tail=s.length-d-1;if(tail!==2)s=s.replace(/\./g,'');}
    const out=Number(s);return Number.isFinite(out)?out:null;
  }

  function enhanceTripModal(){
    const root=$('#tripModalBody');if(!root||!root.children.length)return;
    const differences=$$('.difference-row',root);const total=parseMoney(root.querySelector('.trip-modal-total strong')?.textContent||'');
    const paid=$$('.submission-card',root).map(card=>{const m=(card.querySelector(':scope > small')?.textContent||'').match(/Paid:\s*([^·]+)/i);return m?parseMoney(m[1]):null;}).filter(v=>v!=null);const paidTotal=paid.length>=2?paid.reduce((a,b)=>a+b,0):null;const delta=total!=null&&paidTotal!=null?total-paidTotal:null;
    const sig=`${differences.length}|${total}|${paidTotal}|${delta}`;if(root.dataset.v18WarningSig===sig)return;root.dataset.v18WarningSig=sig;root.querySelectorAll('.tw-trip-warning').forEach(x=>x.remove());
    const anchor=root.querySelector('.difference-list')||root.querySelector('.submission-grid')||root.firstElementChild;
    if(differences.length){const box=document.createElement('div');box.className='tw-trip-warning soft';box.innerHTML=`<strong>${differences.length} detail${differences.length===1?'':'s'} still differ</strong>The trip stays unmatched until every highlighted detail matches.`;anchor?.parentNode?.insertBefore(box,anchor);}
    if(delta!=null&&Math.abs(delta)>.01){const box=document.createElement('div');box.className='tw-trip-warning';box.innerHTML=`<strong>Payment totals do not match the trip expenses</strong>${money(total)} of expenses are recorded, but ${money(paidTotal)} is assigned as paid. Difference: ${money(Math.abs(delta))}.`;const target=root.querySelector('.trip-budget-comparison')||root.querySelector('.budget-check')||anchor;target?.parentNode?.insertBefore(box,target?.nextSibling||null);}
  }

  function stripPrio(note){const s=String(note||'');const m=s.match(/^\s*\[\[(P[1-5])\]\]\s*/i);return {prio:(m?.[1]||'P3').toUpperCase(),note:s.replace(/^\s*\[\[P[1-5]\]\]\s*/i,'')};}
  function encodePrio(note,prio){return `[[${prio||'P3'}]] ${String(note||'').trim()}`.trim();}

  function enhanceWishlist(){
    if(wishlistEnhancing)return;const root=$('#financeWishlist');const table=$('.wishlist-table',root);if(!root||!table)return;wishlistEnhancing=true;
    try{
      const head=table.querySelector('thead tr');if(head&&!head.querySelector('[data-v18-prio-head]')){const th=document.createElement('th');th.textContent='Prio';th.dataset.v18PrioHead='1';head.insertBefore(th,head.firstElementChild);}
      const rows=$$('tbody tr',table).filter(tr=>tr.querySelector('[data-wish-index]'));
      rows.forEach(tr=>{
        const noteText=tr.querySelector('.wishlist-note-text');const raw=noteText?.textContent||'';
        const parts=tr.dataset.prio?{prio:tr.dataset.prio,note:raw}:stripPrio(raw);tr.dataset.prio=parts.prio;
        if(noteText&&!noteText.dataset.v18PrioStripped){noteText.textContent=parts.note;noteText.dataset.v18PrioStripped='1';}
        if(!tr.querySelector('[data-v18-prio-cell]')){const td=document.createElement('td');td.dataset.v18PrioCell='1';td.innerHTML=`<span class="tw-prio-pill">${parts.prio}</span>`;tr.insertBefore(td,tr.firstElementChild);}else tr.querySelector('.tw-prio-pill').textContent=parts.prio;
      });
      const foot=table.querySelector('tfoot tr');if(foot&&!foot.querySelector('[data-v18-prio-foot]')){const td=document.createElement('td');td.dataset.v18PrioFoot='1';foot.insertBefore(td,foot.firstElementChild);}
      let filter=$('.tw-prio-filter',root);if(!filter){filter=document.createElement('div');filter.className='tw-prio-filter';filter.innerHTML='<label>Priority</label><select aria-label="Wishlist priority filter"><option value="all">All · P1 → P5</option><option value="P1">P1 only</option><option value="P2">P2 only</option><option value="P3">P3 only</option><option value="P4">P4 only</option><option value="P5">P5 only</option></select>';const header=$('.wishlist-head',root);header?.insertBefore(filter,header.querySelector('[data-wish-add]'));filter.querySelector('select').addEventListener('change',applyWishlistFilter);}
      const tbody=table.querySelector('tbody');const ordered=[...rows].sort((a,b)=>Number(a.dataset.prio.slice(1))-Number(b.dataset.prio.slice(1)));ordered.forEach(row=>tbody.appendChild(row));applyWishlistFilter();
    }finally{wishlistEnhancing=false;}
  }

  function applyWishlistFilter(){
    const root=$('#financeWishlist'),sel=$('.tw-prio-filter select',root);if(!sel)return;const val=sel.value,visible=[];
    $$('.wishlist-table tbody tr[data-prio]',root).forEach(tr=>{const show=val==='all'||tr.dataset.prio===val;tr.style.display=show?'':'none';if(show)visible.push(tr);});
    const prices=visible.map(tr=>parseMoney(tr.querySelector('.wishlist-price-cell')?.textContent||'')).filter(v=>v!=null);
    const count=root.querySelector('.wishlist-table tfoot small');if(count)count.textContent=`${visible.length} ${visible.length===1?'item':'items'}${val==='all'?'':` · ${val}`}`;
    const total=root.querySelector('.wishlist-table tfoot .wishlist-price-cell strong');if(total)total.textContent=prices.length?money(prices.reduce((a,b)=>a+b,0)):'—';
  }

  function enhanceWishlistModal(){
    const modal=$('#wishlistMiniModal');if(!modal?.classList.contains('show'))return;const body=$('#wishlistMiniBody');if(!body||$('.tw-wish-prio',body))return;const note=$('#wishNote',body);if(!note)return;
    const parsed=stripPrio(note.value);note.value=parsed.note;const label=document.createElement('label');label.className='tw-wish-prio';label.innerHTML='Priority<select id="wishPrio"><option>P1</option><option>P2</option><option>P3</option><option>P4</option><option>P5</option></select>';const fields=$('.wishlist-fields',body);fields?.insertBefore(label,fields.firstElementChild);$('#wishPrio',body).value=parsed.prio;
    $('[data-wish-save]',body)?.addEventListener('click',()=>{note.value=encodePrio(note.value,$('#wishPrio',body)?.value||'P3');},true);
  }

  function installEnhancers(){
    const card=$('#wizardCard');if(card){overlayObserver=new MutationObserver(()=>requestAnimationFrame(()=>{enhanceTripChoices();enhancePartialPicker();}));overlayObserver.observe(card,{childList:true,subtree:true});}
    const wish=$('#financeWishlist');if(wish)new MutationObserver(()=>requestAnimationFrame(()=>{enhanceWishlist();enhanceWishlistModal();})).observe(wish,{childList:true,subtree:true});
    const wishModal=$('#wishlistMiniModal');if(wishModal)new MutationObserver(()=>requestAnimationFrame(enhanceWishlistModal)).observe(wishModal,{attributes:true,childList:true,subtree:true,attributeFilter:['class']});
    const gallery=$('#tripGallery');if(gallery){storyObserver=new MutationObserver(()=>requestAnimationFrame(filterTripStories));storyObserver.observe(gallery,{childList:true,subtree:true});}
    const tripModal=$('#tripModalBody');if(tripModal)new MutationObserver(()=>requestAnimationFrame(enhanceTripModal)).observe(tripModal,{childList:true,subtree:true});
  }

  document.addEventListener('DOMContentLoaded',()=>{
    ensureNavigation();ensureSessionControls();installSessionEvents();simplifyStaticCopy();ensureCurrentTrips();installEnhancers();enhanceTripChoices();enhancePartialPicker();enhanceWishlist();enhanceWishlistModal();
    setTimeout(()=>refreshState(true),180);setInterval(()=>refreshState(false),5000);
    document.addEventListener('twogether:saved',()=>setTimeout(()=>refreshState(false),120));document.addEventListener('twogether:finance-view',()=>setTimeout(()=>{enhanceWishlist();enhanceWishlistModal();},40));
    window.addEventListener('focus',()=>refreshState(false),{passive:true});
  });

  document.addEventListener('twogether:dev-changed',syncBadge);
  window.TwogetherV18={refresh:refreshState,get state(){return remoteState;},stripPrio,encodePrio};
})();
