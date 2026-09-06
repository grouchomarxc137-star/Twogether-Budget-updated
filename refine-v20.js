(() => {
  'use strict';
  const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
  const FLAG={Italy:'1f1ee-1f1f9',Netherlands:'1f1f3-1f1f1',Tunisia:'1f1f9-1f1f3',Portugal:'1f1f5-1f1f9',Spain:'1f1ea-1f1f8',France:'1f1eb-1f1f7',Germany:'1f1e9-1f1ea',Belgium:'1f1e7-1f1ea','United Kingdom':'1f1ec-1f1e7'};
  const CITY_IMAGES={
    amsterdam:'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?auto=format&fit=crop&w=700&q=82',
    lonato:'https://images.unsplash.com/photo-1520175480921-4edfa2983e0f?auto=format&fit=crop&w=700&q=82',
    ariana:'https://images.unsplash.com/photo-1539650116574-75c0c6d73f6e?auto=format&fit=crop&w=700&q=82',
    lisbon:'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=700&q=82',
    lisboa:'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=700&q=82',
    porto:'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=700&q=82'
  };
  const COUNTRY_IMAGES={
    Italy:'https://images.unsplash.com/photo-1520175480921-4edfa2983e0f?auto=format&fit=crop&w=700&q=82',
    Netherlands:'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?auto=format&fit=crop&w=700&q=82',
    Portugal:'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=700&q=82',
    Tunisia:'https://images.unsplash.com/photo-1539650116574-75c0c6d73f6e?auto=format&fit=crop&w=700&q=82',
    Spain:'https://images.unsplash.com/photo-1509840841025-9088ba78a826?auto=format&fit=crop&w=700&q=82',
    France:'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=700&q=82',
    Germany:'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?auto=format&fit=crop&w=700&q=82',
    Belgium:'https://images.unsplash.com/photo-1491557345352-5929e343eb89?auto=format&fit=crop&w=700&q=82'
  };
  const FALLBACK='https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=700&q=82';

  function enhanceTripMedia(){
    $$('#twCurrentTrips .tw-current-card').forEach(card=>{
      const art=$('.tw-trip-art',card);if(!art)return;
      const country=$('.trip-country',card)?.textContent?.trim()||'';
      const city=$('h3',card)?.textContent?.trim().toLowerCase()||'';
      const image=CITY_IMAGES[city]||COUNTRY_IMAGES[country]||FALLBACK;
      art.style.backgroundImage=`linear-gradient(180deg,rgba(255,255,255,.02),rgba(25,18,10,.25)),url("${image}")`;
      const flag=$('.tw-trip-emoji',art);
      if(flag&&FLAG[country])flag.innerHTML=`<img alt="${country} flag" src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${FLAG[country]}.svg">`;
    });
  }

  let trackedPinned=null,synthetic=false;
  function unpinTracked(){
    if(!trackedPinned)return;
    const hub=trackedPinned.querySelector('[data-hub]');
    if(hub){synthetic=true;hub.click();synthetic=false;}
    trackedPinned=null;
    $$('.tw-nav-wrap').forEach(w=>{w.classList.remove('nav-visible');w.querySelector('[data-hub]')?.setAttribute('aria-expanded','false');});
  }
  function fixNavigation(){
    $$('.tw-nav-wrap').forEach(w=>{
      if(w.dataset.v20Nav==='1')return;w.dataset.v20Nav='1';
      w.querySelector('[data-hub]')?.addEventListener('click',()=>{if(synthetic)return;trackedPinned=trackedPinned===w?null:w;},true);
      w.addEventListener('mouseenter',()=>{
        if(trackedPinned&&trackedPinned!==w){unpinTracked();requestAnimationFrame(()=>{w.classList.add('nav-visible');w.querySelector('[data-hub]')?.setAttribute('aria-expanded','true');});}
      },true);
    });
  }
  window.addEventListener('scroll',()=>{if(trackedPinned)unpinTracked();else $$('.tw-nav-wrap.nav-visible').forEach(w=>{w.classList.remove('nav-visible');w.querySelector('[data-hub]')?.setAttribute('aria-expanded','false');});},{passive:true});

  function syncDevState(){
    const active=!!window.TwogetherDevV18?.active;
    if(!active){document.body.classList.remove('dev-playground','dev-v19');$$('.dev19-float,.dev19-inspector,.dev19-bottom,.dev-v18-strip,.dev-v18-tools,.dev-v18-editor').forEach(el=>{el.hidden=true;el.style.display='none';});
      const actor=document.body.dataset.actor||localStorage.getItem('twogether_actor_v1')||'';const badge=$('#loggedUserBadge');if(badge&&/^(Principessa|Principe)$/.test(actor))badge.textContent=actor;
    }else{$$('.dev19-float,.dev19-inspector,.dev19-bottom').forEach(el=>el.style.removeProperty('display'));}
  }

  const EXTRA_KEY='twogether_dev_v20_extras';let extras={};let base=new Map();
  try{extras=JSON.parse(localStorage.getItem(EXTRA_KEY)||'{}')||{};}catch{}
  const esc=s=>window.CSS?.escape?CSS.escape(String(s)):String(s).replace(/[^a-z0-9_-]/gi,'\\$&');
  function selector(el){if(!el)return'';if(el===document.body)return'body';if(el.id)return'#'+esc(el.id);for(const a of ['data-current-plan','data-current-trip','data-open-trip','data-fin-month','data-wish-index'])if(el.hasAttribute?.(a))return`[${a}="${esc(el.getAttribute(a))}"]`;const p=el.parentElement;if(!p)return'';const same=[...p.children].filter(x=>x.tagName===el.tagName);return`${selector(p)} > ${el.tagName.toLowerCase()}:nth-of-type(${same.indexOf(el)+1})`;}
  function snapshot(el){if(!base.has(el))base.set(el,el.getAttribute('style'));}
  function restoreExtras(){for(const [el,s] of base){if(!el.isConnected)continue;s==null?el.removeAttribute('style'):el.setAttribute('style',s);}base.clear();}
  function applyExtras(){if(!window.TwogetherDevV18?.active)return;for(const [key,p] of Object.entries(extras)){let el;try{el=document.querySelector(key);}catch{}if(!el)continue;snapshot(el);Object.entries(p.style||{}).forEach(([k,v])=>{if(k.startsWith('--dev20-'))return;el.style.setProperty(k,v);});}}
  function saveExtras(){localStorage.setItem(EXTRA_KEY,JSON.stringify(extras));}
  function setExtra(prop,val){const el=window.TwogetherDevV18?.selected;if(!el)return;const key=selector(el);if(!key)return;extras[key]=extras[key]||{style:{}};extras[key].style[prop]=val;saveExtras();restoreExtras();applyExtras();}
  function field(label,type,value,cb,opts=[]){const row=document.createElement('label');row.className='dev20-row';const s=document.createElement('span');s.textContent=label;row.appendChild(s);let i;if(type==='select'){i=document.createElement('select');opts.forEach(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;i.appendChild(o);});}else{i=document.createElement('input');i.type=type;}i.value=value??'';i.addEventListener(type==='range'?'input':'change',()=>cb(i.value));row.appendChild(i);return row;}
  function augmentIcons(panel){
    const iconSelect=[...panel.querySelectorAll('select')].find(s=>s.closest('.dev19-group')?.querySelector('h4')?.textContent?.includes('Icon'));
    if(iconSelect&&!iconSelect.dataset.v20Icons){iconSelect.dataset.v20Icons='1';[
      ['🏠','Home'],['✈️','Flight'],['🚆','Train'],['🏨','Hotel'],['🛏️','Bed'],['🍽️','Meal'],['🛒','Groceries'],['⛽','Fuel'],['🚗','Car'],['🅿️','Parking'],['🧾','Receipt'],['💳','Card'],['💶','Money'],['📊','Chart'],['📅','Calendar'],['📍','Location'],['🗺️','Map'],['🌍','World'],['⚙️','Settings'],['✎','Edit'],['⋯','More'],['🔒','Lock'],['🔓','Unlock'],['☆','Star outline'],['★','Star'],['✨','Sparkles'],['✓','Check'],['✕','Close'],['＋','Plus'],['−','Minus'],['‹','Left'],['›','Right'],['↑','Up'],['↓','Down'],['↗','Open']
    ].forEach(([v,t])=>{if([...iconSelect.options].some(o=>o.value===v))return;const o=document.createElement('option');o.value=v;o.textContent=`${v} ${t}`;iconSelect.appendChild(o);});}
  }
  function augmentDev(){
    if(!window.TwogetherDevV18?.active)return;const inspector=$('.dev19-inspector'),panel=inspector&&$('.dev19-panel',inspector),sel=window.TwogetherDevV18?.selected;if(!panel||!sel)return;
    augmentIcons(panel);const key=selector(sel);if(panel.querySelector(`.dev20-advanced[data-key="${CSS.escape(key)}"]`))return;panel.querySelector('.dev20-advanced')?.remove();const cs=getComputedStyle(sel),p=extras[key]?.style||{};const box=document.createElement('section');box.className='dev20-advanced';box.dataset.key=key;box.innerHTML='<h4>Advanced controls</h4>';
    box.append(field('Scale','number',p.scale||1,v=>{const n=Math.max(.1,Math.min(5,Number(v)||1));setExtra('scale',String(n));}));
    box.append(field('Rotate','number',parseFloat(p.rotate)||0,v=>setExtra('rotate',(Number(v)||0)+'deg')));
    box.append(field('Z-index','number',p['z-index']||cs.zIndex||0,v=>setExtra('z-index',String(Number(v)||0))));
    box.append(field('Display','select',p.display||cs.display,v=>setExtra('display',v),[['block','Block'],['inline-block','Inline block'],['flex','Flex'],['grid','Grid'],['inline','Inline'],['none','Hidden']]));
    box.append(field('Gap','text',p.gap||cs.gap||'',v=>setExtra('gap',v)));
    box.append(field('Height','text',p.height||sel.style.height||'',v=>setExtra('height',v||'auto')));
    box.append(field('Letter spacing','text',p['letter-spacing']||cs.letterSpacing||'',v=>setExtra('letter-spacing',v)));
    box.append(field('Line height','text',p['line-height']||cs.lineHeight||'',v=>setExtra('line-height',v)));
    box.append(field('Blur','range',0,v=>setExtra('filter',Number(v)?`blur(${Number(v)}px)`:'none')));
    const actions=document.createElement('div');actions.className='dev20-actions';
    const b=(t,fn)=>{const x=document.createElement('button');x.type='button';x.textContent=t;x.onclick=fn;actions.appendChild(x);};
    b('Select parent',()=>{const parent=sel.parentElement;if(parent){parent.dispatchEvent(new MouseEvent('pointerover',{bubbles:true}));parent.dispatchEvent(new MouseEvent('click',{bubbles:true,altKey:true}));}});
    b('Bring to front',()=>setExtra('z-index','999'));
    b('Reset advanced',()=>{delete extras[key];saveExtras();restoreExtras();applyExtras();box.remove();setTimeout(augmentDev,0);});
    b('Copy CSS',async()=>{const txt=Object.entries({...p}).filter(([k])=>!k.startsWith('--dev20-')).map(([k,v])=>`${k}: ${v};`).join('\n');try{await navigator.clipboard.writeText(txt);}catch{}});
    box.appendChild(actions);const help=document.createElement('p');help.className='dev20-shortcuts';help.textContent='Shortcuts: Alt+click selects directly · Ctrl/Cmd+Z undo · Ctrl/Cmd+Y redo · Arrow keys nudge 1px · Shift+Arrow nudges 10px.';box.appendChild(help);panel.appendChild(box);
  }

  document.addEventListener('keydown',e=>{
    if(!window.TwogetherDevV18?.active||!window.TwogetherDevV18?.selected||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)||e.target.matches('input,textarea,select'))return;e.preventDefault();const step=e.shiftKey?10:1,el=window.TwogetherDevV18.selected,key=selector(el),p=extras[key]?.style||{};let x=Number(p['--dev20-x']||0),y=Number(p['--dev20-y']||0);if(e.key==='ArrowLeft')x-=step;if(e.key==='ArrowRight')x+=step;if(e.key==='ArrowUp')y-=step;if(e.key==='ArrowDown')y+=step;extras[key]=extras[key]||{style:{}};extras[key].style['--dev20-x']=x;extras[key].style['--dev20-y']=y;extras[key].style.transform=`translate(${x}px,${y}px)`;saveExtras();restoreExtras();applyExtras();
  },true);

  let scheduled=false;
  const obs=new MutationObserver(()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;enhanceTripMedia();fixNavigation();syncDevState();});});
  document.addEventListener('DOMContentLoaded',()=>{enhanceTripMedia();fixNavigation();syncDevState();obs.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','data-actor']});});
  document.addEventListener('twogether:v18-rendered',()=>setTimeout(()=>{enhanceTripMedia();syncDevState();},0));
  document.addEventListener('twogether:dev-changed',()=>setTimeout(()=>{syncDevState();if(window.TwogetherDevV18?.active){applyExtras();augmentDev();}else restoreExtras();},0));
  document.addEventListener('click',()=>{if(window.TwogetherDevV18?.active)setTimeout(augmentDev,0)},true);
})();
