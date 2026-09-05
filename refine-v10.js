(() => {
  'use strict';

  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const CONFIG=window.TOGETHER_BUDGET_CONFIG||{};
  const API_URL=String(CONFIG.appsScriptUrl||'').trim();
  const ACTOR_KEY='twogether_actor_v1';
  const FIELD_LABELS={travel:'Flights / Train',accom:'Accommodation',fuel:'Fuel',groceries:'Groceries',eat:'Eating out',tolls:'Tolls / Parking',other:'Other'};
  const PARTIAL_ORDER=['travel','accom','fuel','groceries','eat','tolls','other'];

  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const actor=()=>document.body.dataset.actor||localStorage.getItem(ACTOR_KEY)||'';
  const money=v=>'€'+Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});

  function toast(msg,tone='ok'){
    const el=$('#toast'); if(!el)return;
    el.textContent=msg; el.className='toast show '+tone;
    clearTimeout(el._v10); el._v10=setTimeout(()=>el.className='toast',2600);
  }

  function jsonp(params={}){
    return new Promise((resolve,reject)=>{
      if(!API_URL)return reject(new Error('Backend URL missing'));
      const cb='__tw_v10_'+Date.now()+'_'+Math.random().toString(36).slice(2);
      const script=document.createElement('script');
      const timer=setTimeout(()=>done(new Error('Sync timed out')),10000);
      function done(err,data){clearTimeout(timer);try{delete window[cb];}catch{}script.remove();err?reject(err):resolve(data);}
      window[cb]=data=>done(null,data);
      const q=new URLSearchParams({...params,callback:cb,_:String(Date.now())});
      script.src=API_URL+(API_URL.includes('?')?'&':'?')+q.toString();
      script.onerror=()=>done(new Error('Could not reach backend'));
      document.head.appendChild(script);
    });
  }

  function post(action,payload){
    return new Promise((resolve,reject)=>{
      const a=actor(); if(!API_URL)return reject(new Error('Backend URL missing')); if(!a)return reject(new Error('Choose a profile first'));
      const frame=$('iframe[name="backendFrame"]'); if(!frame)return reject(new Error('Backend frame missing'));
      const form=document.createElement('form'); form.method='POST';form.action=API_URL;form.target='backendFrame';form.style.display='none';
      Object.entries({action,actor:a,payload:JSON.stringify(payload||{})}).forEach(([k,v])=>{const i=document.createElement('input');i.type='hidden';i.name=k;i.value=v;form.appendChild(i);});
      document.body.appendChild(form);form.submit();form.remove();setTimeout(resolve,850);
    });
  }

  function installSessionButtons(){
    if($('#twSessionActions'))return;
    const top=$('.top-actions'); if(!top)return;
    const wrap=document.createElement('div');wrap.id='twSessionActions';
    wrap.innerHTML='<button type="button" class="tw-top-btn" data-tw-logout>Logout</button><button type="button" class="tw-top-btn dev" data-tw-dev>Dev</button>';
    top.appendChild(wrap);
    $('[data-tw-logout]',wrap).addEventListener('click',()=>{
      try{localStorage.removeItem(ACTOR_KEY);}catch{}
      document.body.dataset.actor='';
      const badge=$('#loggedUserBadge');if(badge){badge.textContent='';badge.classList.add('hidden');}
      const modal=$('#identityModal');modal?.classList.add('show');modal?.setAttribute('aria-hidden','false');
    });
    $('[data-tw-dev]',wrap).addEventListener('click',openDev);
  }

  function installHoverMenus(){
    if($('.tw-nav-wrap'))return;
    const nav=$('.hub-tabs'); if(!nav)return;
    const trip=$('[data-hub="trips"]',nav),fin=$('[data-hub="finances"]',nav); if(!trip||!fin)return;
    function makeWrap(button,items){
      const wrap=document.createElement('div');wrap.className='tw-nav-wrap';button.parentNode.insertBefore(wrap,button);wrap.appendChild(button);
      const menu=document.createElement('div');menu.className='tw-nav-menu';
      items.forEach(item=>{const b=document.createElement('button');b.type='button';b.textContent=item.label;b.addEventListener('click',e=>{e.stopPropagation();item.target()?.click();wrap.classList.remove('menu-open');});menu.appendChild(b);});
      wrap.appendChild(menu);
      button.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();wrap.classList.add('menu-open');menu.querySelector('button')?.focus();}});
      wrap.addEventListener('mouseleave',()=>wrap.classList.remove('menu-open'));
    }
    makeWrap(trip,[
      {label:'Log trip',target:()=>$('.trip-subnav [data-sheet="log"]')},
      {label:'Monthly',target:()=>$('.trip-subnav [data-sheet="monthly"]')},
      {label:'Compare',target:()=>$('.trip-subnav [data-sheet="compare"]')}
    ]);
    makeWrap(fin,[
      {label:'Overview',target:()=>$('.finance-subnav [data-fin-subview="overview"]')},
      {label:'Monthly finances',target:()=>$('.finance-subnav [data-fin-subview="monthly"]')},
      {label:'Balances & loans',target:()=>$('.finance-subnav [data-fin-subview="balances"]')},
      {label:'Test scenarios',target:()=>$('.finance-subnav [data-fin-subview="scenarios"]')},
      {label:'Wishlist',target:()=>$('.finance-subnav [data-fin-subview="wishlist"]')}
    ]);
  }

  function installEnterToNext(){
    document.addEventListener('keydown',e=>{
      if(e.key!=='Enter'||e.shiftKey||e.ctrlKey||e.metaKey||e.altKey)return;
      const t=e.target;
      if(!(t instanceof HTMLInputElement||t instanceof HTMLSelectElement))return;
      const root=t.closest('#wizardCard,#workflowV5Overlay,#workflowBudgetModal,.trip-modal-card'); if(!root)return;
      if(t.type==='button'||t.type==='checkbox'||t.type==='radio')return;
      const candidates=$$('button',root).filter(b=>!b.disabled&&b.offsetParent!==null);
      const next=candidates.find(b=>/^(next|continue|save|save trip budget|save my budget)$/i.test((b.textContent||'').trim()))
        ||candidates.find(b=>/next|continue|save/i.test((b.textContent||'').trim()));
      if(next){e.preventDefault();next.click();}
    },true);
  }

  function enhanceTripChoices(root=document){
    $$('.trip-pick',root).forEach(btn=>{
      if(btn.dataset.v10Choice==='1')return;
      const strong=btn.querySelector('strong');const icon=btn.querySelector('.pick-icon');if(!strong)return;
      const text=strong.textContent.trim();
      if(/^Yes ·/i.test(text)){strong.textContent=text.replace(/^Yes ·\s*/i,'Log expenses · ');if(icon)icon.textContent='→';}
      if(/^No · this is a different trip/i.test(text)){strong.textContent='Start a different trip';if(icon)icon.textContent='+';}
      if(/Start a new trip/i.test(text)&&icon)icon.textContent='+';
      if(/Add your version/i.test(text)&&icon)icon.textContent='→';
      if(/Match the differences/i.test(text)&&icon)icon.textContent='=';
      btn.dataset.v10Choice='1';
    });
  }

  function enhancePartialPicker(){
    const overlay=$('#workflowV5Overlay');if(!overlay)return;
    const title=$('.v5-question h2',overlay)?.textContent?.trim();if(title!=='What do you want to log?')return;
    const stack=$('.v5-choice-stack',overlay);if(!stack||stack.dataset.v10Expanded==='1')return;
    const originals=$$('[data-v5-partial-key]',stack);if(!originals.length)return;
    const proxy=originals[0];
    const savedKeys=new Set($$('[data-v5-partial-saved]',overlay).map(b=>b.dataset.v5PartialSaved));
    stack.innerHTML='';
    PARTIAL_ORDER.filter(k=>!savedKeys.has(k)).forEach(key=>{
      const clone=proxy.cloneNode(true);clone.dataset.v5PartialKey=key;clone.dataset.v10Choice='1';
      const strong=clone.querySelector('strong'),small=clone.querySelector('small'),icon=clone.querySelector('.pick-icon');
      if(strong)strong.textContent=FIELD_LABELS[key];if(small)small.textContent='Add '+FIELD_LABELS[key].toLowerCase();
      if(icon)icon.textContent=key==='travel'?'✈':key==='accom'?'⌂':key==='fuel'?'⛽':'+';
      clone.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();proxy.dataset.v5PartialKey=key;proxy.click();});
      stack.appendChild(clone);
    });
    stack.dataset.v10Expanded='1';
    const help=$('.v5-question>p',overlay);if(help)help.textContent='Choose any category now. You can add more or edit saved totals later.';
  }

  function parseMoney(text){
    let s=String(text||'').replace(/[^0-9,.-]/g,'');if(!s)return null;
    const c=s.lastIndexOf(','),d=s.lastIndexOf('.');
    if(c>=0&&d>=0){const dec=c>d?',':'.';const thou=dec===','?'.':',';s=s.split(thou).join('').replace(dec,'.');}
    else if(c>=0){const tail=s.length-c-1;s=tail===2?s.replace(',','.'):s.replace(/,/g,'');}
    else if(d>=0){const tail=s.length-d-1;if(tail!==2)s=s.replace(/\./g,'');}
    const n=Number(s);return Number.isFinite(n)?n:null;
  }

  function decorateTripModal(){
    const root=$('#tripModalBody');if(!root||!root.children.length)return;
    const differences=$$('.difference-row',root);
    const total=parseMoney(root.querySelector('.trip-modal-total strong')?.textContent||'');
    const paid=$$('.submission-card',root).map(card=>{const m=(card.querySelector(':scope > small')?.textContent||'').match(/Paid:\s*([^·]+)/i);return m?parseMoney(m[1]):null;}).filter(v=>v!=null);
    const paidTotal=paid.length>=2?paid.reduce((a,b)=>a+b,0):null;
    const delta=total!=null&&paidTotal!=null?total-paidTotal:null;
    const sig=`${differences.length}|${total}|${paidTotal}|${delta}`;
    if(root.dataset.v10WarningSig===sig)return;
    root.dataset.v10WarningSig=sig;
    root.querySelectorAll('.tw-trip-warning').forEach(x=>x.remove());
    const anchor=root.querySelector('.difference-list')||root.querySelector('.submission-grid')||root.firstElementChild;
    if(differences.length){
      const box=document.createElement('div');box.className='tw-trip-warning soft';
      box.innerHTML=`<strong>${differences.length} detail${differences.length===1?'':'s'} still differ</strong>The amounts can match while a note or other detail still differs. The trip is not fully matched until every highlighted detail matches.`;
      anchor?.parentNode?.insertBefore(box,anchor);
    }
    if(delta!=null&&Math.abs(delta)>.01){
      const box=document.createElement('div');box.className='tw-trip-warning';
      box.innerHTML=`<strong>Payment totals do not match the trip expenses</strong>${money(total)} in expenses are recorded, but ${money(paidTotal)} is assigned as paid. Difference: ${money(Math.abs(delta))}.`;
      const target=root.querySelector('.trip-budget-comparison')||root.querySelector('.budget-check')||anchor;
      target?.parentNode?.insertBefore(box,target.nextSibling);
    }
  }

  function stripPrio(note){
    const s=String(note||'');const m=s.match(/^\s*\[\[(P[1-5])\]\]\s*/i);return {prio:(m?.[1]||'P3').toUpperCase(),note:s.replace(/^\s*\[\[P[1-5]\]\]\s*/i,'')};
  }
  function encodePrio(note,prio){return `[[${prio||'P3'}]] ${String(note||'').trim()}`.trim();}

  function enhanceWishlist(){
    const root=$('#financeWishlist');if(!root)return;
    const table=$('.wishlist-table',root);if(!table)return;
    if(!table.dataset.v10){
      const head=table.querySelector('thead tr'); if(head){const th=document.createElement('th');th.textContent='Prio';head.insertBefore(th,head.firstElementChild);}
      $$('tbody tr',table).forEach(tr=>{
        const noteCell=tr.children[1];if(!noteCell)return;
        const raw=(noteCell.querySelector('.wishlist-note-text')?.textContent||'').trim();const parts=stripPrio(raw);
        const td=document.createElement('td');td.innerHTML=`<span class="tw-prio-pill">${parts.prio}</span>`;tr.insertBefore(td,tr.firstElementChild);
        const text=noteCell.querySelector('.wishlist-note-text');if(text)text.textContent=parts.note;tr.dataset.prio=parts.prio;
      });
      const foot=table.querySelector('tfoot tr');if(foot){const td=document.createElement('td');td.textContent='';foot.insertBefore(td,foot.firstElementChild);}
      table.dataset.v10='1';
    }
    const headWrap=$('.wishlist-head',root);if(headWrap&&!$('.tw-prio-filter',headWrap)){
      const filter=document.createElement('div');filter.className='tw-prio-filter';filter.innerHTML='<label>Priority</label><select><option value="all">All</option><option>P1</option><option>P2</option><option>P3</option><option>P4</option><option>P5</option></select>';
      headWrap.insertBefore(filter,headWrap.lastElementChild);
      filter.querySelector('select').addEventListener('change',e=>$$('tbody tr',table).forEach(tr=>tr.style.display=e.target.value==='all'||tr.dataset.prio===e.target.value?'':'none'));
    }
  }

  function enhanceWishlistModal(){
    const modal=$('#wishlistMiniModal');if(!modal?.classList.contains('show'))return;
    const body=$('#wishlistMiniBody');if(!body||$('.tw-wish-prio',body))return;
    const note=$('#wishNote',body);if(!note)return;
    const parsed=stripPrio(note.value);note.value=parsed.note;
    const label=document.createElement('label');label.className='tw-wish-prio';label.innerHTML='Priority<select id="wishPrio"><option>P1</option><option>P2</option><option selected>P3</option><option>P4</option><option>P5</option></select>';
    const fields=$('.wishlist-fields',body);fields?.insertBefore(label,fields.firstElementChild);$('#wishPrio',body).value=parsed.prio;
    const save=$('[data-wish-save]',body);save?.addEventListener('click',()=>{note.value=encodePrio(note.value,$('#wishPrio',body)?.value||'P3');},true);
  }

  async function openDev(){
    let modal=$('#twDevModal');
    if(!modal){
      modal=document.createElement('div');modal.id='twDevModal';modal.className='tw-dev-modal';
      modal.innerHTML='<div class="tw-dev-backdrop" data-dev-close></div><div class="tw-dev-card"><button class="tw-dev-close" type="button" data-dev-close>×</button><div id="twDevBody"></div></div>';
      document.body.appendChild(modal);$$('[data-dev-close]',modal).forEach(x=>x.addEventListener('click',()=>modal.classList.remove('show')));
    }
    modal.classList.add('show');const body=$('#twDevBody');body.innerHTML='<h2>Dev tools</h2><p>Loading maintenance controls…</p>';
    try{
      const res=await jsonp({action:'state'});if(!res?.ok)throw new Error('Could not load state');const state=res.state||{};const a=actor();
      const tripRows=(state.trips||[]).map(t=>{const s=t.submissions?.Principessa||t.submissions?.Principe||{};return `<div class="tw-dev-row"><div><strong>${esc(s.city||'Trip')}</strong><small>${esc(s.start||'')} ${s.end?'– '+esc(s.end):''}</small></div><button class="tw-dev-delete" data-dev-trip="${esc(t.id)}">Delete trip</button></div>`;}).join('')||'<div class="tw-dev-empty">No trips to delete.</div>';
      const months=(state.finances?.[a]||[]).map(m=>`<div class="tw-dev-row"><div><strong>${esc(m.month||'Month')}</strong><small>${m.finalized?'Confirmed':'Draft'}</small></div><button class="tw-dev-delete" data-dev-month="${esc(m.month)}">Delete month</button></div>`).join('')||'<div class="tw-dev-empty">No finance months to delete.</div>';
      body.innerHTML=`<h2>Dev tools</h2><p>Maintenance controls for ${esc(a||'current user')}. Deletions always ask for confirmation.</p><section class="tw-dev-section"><h3>Trips</h3>${tripRows}</section><section class="tw-dev-section"><h3>Monthly finances</h3>${months}</section>`;
      $$('[data-dev-trip]',body).forEach(b=>b.addEventListener('click',async()=>{if(!confirm('Delete this trip? This cannot be undone.'))return;await post('deleteTrip',{id:b.dataset.devTrip});toast('Trip deleted');setTimeout(()=>location.reload(),900);}));
      $$('[data-dev-month]',body).forEach(b=>b.addEventListener('click',async()=>{if(!confirm(`Delete finance month ${b.dataset.devMonth}?`))return;await post('deleteFinanceMonth',{month:b.dataset.devMonth});toast('Finance month deleted');setTimeout(()=>location.reload(),900);}));
    }catch(err){body.innerHTML=`<h2>Dev tools</h2><p>${esc(err.message||'Could not load dev tools')}</p>`;}
  }

  function simplifyText(){
    const scenarioHead=$('#financeScenarios .finance-scenario-head h2');if(scenarioHead&&scenarioHead.textContent!=='Purchases')scenarioHead.textContent='Purchases';
    const compare=$('#compare .page-heading h1');if(compare&&compare.textContent!=='Compare')compare.textContent='Compare';
    const monthly=$('#monthly .page-heading h1');if(monthly&&monthly.textContent!=='Monthly trips')monthly.textContent='Monthly trips';
  }

  function refreshEnhancements(){
    installSessionButtons();installHoverMenus();enhanceTripChoices();enhancePartialPicker();decorateTripModal();enhanceWishlist();enhanceWishlistModal();simplifyText();
  }

  function init(){
    installEnterToNext();refreshEnhancements();
    const obs=new MutationObserver(()=>requestAnimationFrame(refreshEnhancements));obs.observe(document.body,{childList:true,subtree:true});
  }
  document.addEventListener('DOMContentLoaded',init);
})();
