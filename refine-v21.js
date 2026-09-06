(() => {
  'use strict';
  const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];

  /* ---------- Current trip media + compact layout helpers ---------- */
  const FLAG={Italy:'1f1ee-1f1f9',Netherlands:'1f1f3-1f1f1',Tunisia:'1f1f9-1f1f3',Portugal:'1f1f5-1f1f9',Spain:'1f1ea-1f1f8',France:'1f1eb-1f1f7',Germany:'1f1e9-1f1ea',Belgium:'1f1e7-1f1ea','United Kingdom':'1f1ec-1f1e7'};
  const CITY_IMAGES={
    ariana:'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Ariana_-_Tunisia.jpg/800px-Ariana_-_Tunisia.jpg',
    amsterdam:'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?auto=format&fit=crop&w=900&q=82',
    lonato:'https://images.unsplash.com/photo-1520175480921-4edfa2983e0f?auto=format&fit=crop&w=900&q=82',
    lisbon:'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=900&q=82',
    lisboa:'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=900&q=82',
    porto:'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=900&q=82'
  };
  const COUNTRY_IMAGES={
    Italy:'https://images.unsplash.com/photo-1520175480921-4edfa2983e0f?auto=format&fit=crop&w=900&q=82',
    Netherlands:'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?auto=format&fit=crop&w=900&q=82',
    Portugal:'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=900&q=82',
    Tunisia:'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Ariana_-_Tunisia.jpg/800px-Ariana_-_Tunisia.jpg',
    Spain:'https://images.unsplash.com/photo-1509840841025-9088ba78a826?auto=format&fit=crop&w=900&q=82',
    France:'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=900&q=82',
    Germany:'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?auto=format&fit=crop&w=900&q=82',
    Belgium:'https://images.unsplash.com/photo-1491557345352-5929e343eb89?auto=format&fit=crop&w=900&q=82'
  };
  const FALLBACK='https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=82';
  const failedImages=new Set();
  function setTripImage(art,url,fallback){
    if(!url||failedImages.has(url)){art.style.backgroundImage=`linear-gradient(180deg,rgba(255,255,255,.02),rgba(25,18,10,.2)),url("${fallback||FALLBACK}")`;return;}
    const img=new Image();img.onload=()=>{if(art.isConnected)art.style.backgroundImage=`linear-gradient(180deg,rgba(255,255,255,.02),rgba(25,18,10,.2)),url("${url}")`;};img.onerror=()=>{failedImages.add(url);if(art.isConnected)art.style.backgroundImage=`linear-gradient(180deg,rgba(255,255,255,.02),rgba(25,18,10,.2)),url("${fallback||FALLBACK}")`;};img.src=url;
  }
  function enhanceTripCards(){
    $$('#twCurrentTrips .tw-current-card').forEach(card=>{
      const art=$('.tw-trip-art',card);if(!art)return;
      $('.tw-trip-monogram',art)?.remove();
      const country=$('.trip-country',card)?.textContent?.trim()||'';
      const city=$('h3',card)?.textContent?.trim().toLowerCase()||'';
      const url=CITY_IMAGES[city]||COUNTRY_IMAGES[country]||FALLBACK;
      setTripImage(art,url,COUNTRY_IMAGES[country]||FALLBACK);
      if(city==='ariana'||country==='Tunisia')art.title='Ariana, Tunisia — DrFO.Jr.Tn / Wikimedia Commons (CC BY-SA 3.0)';
      const flag=$('.tw-trip-emoji',art);if(flag&&FLAG[country])flag.innerHTML=`<img alt="${country} flag" src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${FLAG[country]}.svg">`;
    });
  }

  /* ---------- Wishlist adaptive sizing ---------- */
  function compactWishlist(){
    const root=$('#financeWishlist'),table=$('.wishlist-table',root);if(!root||!table)return;
    const rows=$$('tbody tr',table).filter(r=>r.querySelector('.wishlist-item-name'));
    let item=10,note=4;
    rows.forEach(r=>{
      item=Math.max(item,($.textContent?$.textContent:'').length); // harmless guard for older browsers
      item=Math.max(item,($('.wishlist-item-name',r)?.textContent||'').trim().length);
      const noteText=($('.wishlist-note-text',r)?.textContent||'').trim();const link=$('.wishlist-open-link',r)?9:0;
      note=Math.max(note,noteText.length+link);
    });
    root.style.setProperty('--wish-item-ch',String(Math.min(34,Math.max(10,item+2))));
    root.style.setProperty('--wish-note-ch',String(Math.min(48,Math.max(5,note+2))));
  }

  /* ---------- DEV v21 visual editor ---------- */
  const KEY='twogether_dev_playground_v21';
  const ACTORS=['Principessa','Principe'];
  const clone=v=>JSON.parse(JSON.stringify(v));
  let active=false,selected=null,selectedKey='',patches={},past=[],future=[];
  let selectionBox=null,marquee=null,context=null,inspector=null,toolbar=null,dropBox=null;
  let editNode=null,editBefore='',marqueeState=null,moveState=null,suppressClickUntil=0,inspectorTab='appearance',mutationTimer=0;
  const styleBases=new Map(),contentBases=new Map(),positionBases=new Map(),wrappers=new Set();
  let copiedStyle=null;
  try{const s=JSON.parse(localStorage.getItem(KEY)||'{}');patches=s.patches||{};past=s.past||[];future=s.future||[];}catch{}

  function actor(){const a=document.body.dataset.actor||localStorage.getItem('twogether_actor_v1')||'';return ACTORS.includes(a)?a:'';}
  function safeCss(v){return window.CSS?.escape?CSS.escape(String(v)):String(v).replace(/[^a-zA-Z0-9_-]/g,'\\$&');}
  function selector(el){
    if(!el)return'';if(el===document.body)return'body';if(el.id)return'#'+safeCss(el.id);
    for(const attr of ['data-current-plan','data-current-trip','data-open-trip','data-fin-month','data-fin-view','data-sheet','data-dev21-added'])if(el.hasAttribute?.(attr)){const v=el.getAttribute(attr);return`[${attr}="${safeCss(v)}"]`;}
    const p=el.parentElement;if(!p)return'';const parent=selector(p);if(!parent)return'';const same=[...p.children].filter(x=>x.tagName===el.tagName),i=same.indexOf(el)+1;return`${parent} > ${el.tagName.toLowerCase()}:nth-of-type(${i})`;
  }
  function resolve(key){try{return document.querySelector(key);}catch{return null;}}
  function persist(){try{localStorage.setItem(KEY,JSON.stringify({patches,past:past.slice(-120),future:future.slice(-120)}));}catch{}}
  function emit(){document.dispatchEvent(new CustomEvent('twogether:dev-changed'));}
  function toast(msg,tone='ok'){const el=$('#toast');if(!el)return;el.textContent=msg;el.className='toast show '+tone;clearTimeout(el._v21);el._v21=setTimeout(()=>el.className='toast',2600);}
  function captureStyle(el){if(el&&!styleBases.has(el))styleBases.set(el,el.getAttribute('style'));}
  function captureContent(el){if(el&&!contentBases.has(el))contentBases.set(el,el.innerHTML);}
  function capturePosition(el){if(el&&!positionBases.has(el))positionBases.set(el,{parent:el.parentNode,next:el.nextSibling});}
  function restoreSession(){
    for(const [el,pos] of [...positionBases.entries()].reverse())if(el?.isConnected&&pos.parent?.isConnected){if(pos.next&&pos.next.parentNode===pos.parent)pos.parent.insertBefore(el,pos.next);else pos.parent.appendChild(el);}positionBases.clear();
    wrappers.forEach(w=>{if(!w.isConnected)return;while(w.firstChild)w.parentNode?.insertBefore(w.firstChild,w);w.remove();});wrappers.clear();
    for(const [el,s] of styleBases)if(el?.isConnected){s==null?el.removeAttribute('style'):el.setAttribute('style',s);}styleBases.clear();
    for(const [el,h] of contentBases)if(el?.isConnected)el.innerHTML=h;contentBases.clear();
    $$('[data-dev21-added]').forEach(x=>x.remove());
  }
  function patchFor(key){return patches[key]||(patches[key]={style:{}});}
  function mutate(fn){past.push(clone(patches));past=past.slice(-120);future=[];restoreSession();fn();persist();applyPatches();syncSelection();renderInspector();emit();}
  function undo(){if(!past.length)return;finishInline(false);restoreSession();future.push(clone(patches));patches=past.pop();persist();applyPatches();syncSelection();renderInspector();emit();}
  function redo(){if(!future.length)return;finishInline(false);restoreSession();past.push(clone(patches));patches=future.pop();persist();applyPatches();syncSelection();renderInspector();emit();}
  function reset(){mutate(()=>{patches={};});toast('DEV reset — Ctrl/Cmd+Z can undo it');}
  function patchStyle(prop,value,key=selectedKey){if(!key)return;mutate(()=>{const p=patchFor(key);p.style=p.style||{};if(value===''||value==null)delete p.style[prop];else p.style[prop]=String(value);});}
  function patchMany(style,key=selectedKey){if(!key)return;mutate(()=>{const p=patchFor(key);p.style={...(p.style||{}),...style};});}
  function patchText(el,text){const key=selector(el);if(!key)return;mutate(()=>{const p=patchFor(key);p.text=String(text);delete p.html;});}
  function patchHtml(el,html){const key=selector(el);if(!key)return;mutate(()=>{const p=patchFor(key);p.html=String(html);delete p.text;});}
  function resetSelected(){if(!selectedKey)return;mutate(()=>{delete patches[selectedKey];});}

  function addFromPatch(key,p){
    if(resolve(key)||!p.add)return;const parent=resolve(p.parent)||$('.sheet.active')||$('main');if(!parent)return;
    const template=document.createElement('template');template.innerHTML=String(p.html||'<div>Test block</div>').trim();const el=template.content.firstElementChild||document.createElement('div');el.dataset.dev21Added=p.id;el.classList.add('dev21-added');
    const after=resolve(p.after);if(after?.parentNode===parent)parent.insertBefore(el,after.nextSibling);else parent.appendChild(el);
  }
  function applyPlacement(el,placement){
    const target=resolve(placement?.target);if(!el||!target||el===target||el.contains(target))return;
    capturePosition(el);
    if(placement.mode==='before'){target.parentNode?.insertBefore(el,target);return;}
    if(placement.mode==='after'){target.parentNode?.insertBefore(el,target.nextSibling);return;}
    if(placement.mode==='left'||placement.mode==='right'){
      capturePosition(target);const parent=target.parentNode;if(!parent)return;const wrap=document.createElement('div');wrap.className='dev21-split';wrap.dataset.dev21Wrapper='1';parent.insertBefore(wrap,target);wrappers.add(wrap);if(placement.mode==='left'){wrap.append(el,target);}else{wrap.append(target,el);}
    }
  }
  function applyPatches(){
    if(!active)return;
    Object.entries(patches).forEach(([k,p])=>addFromPatch(k,p));
    Object.entries(patches).forEach(([k,p])=>{const el=resolve(k);if(!el)return;captureStyle(el);if(p.text!==undefined){captureContent(el);el.textContent=p.text;}if(p.html!==undefined){captureContent(el);el.innerHTML=p.html;}Object.entries(p.style||{}).forEach(([a,v])=>el.style.setProperty(a,v));if(p.hidden)el.style.setProperty('display','none','important');});
    Object.entries(patches).forEach(([k,p])=>{if(p.placement)applyPlacement(resolve(k),p.placement);});
  }

  function candidate(el){if(!el||el===document.documentElement||el===document.body)return null;if(el.closest?.('.dev21-context,.dev21-inspector,.dev21-toolbar,.dev21-selection,.dev21-marquee,.dev21-drop,.identity-modal'))return null;return el;}
  function semanticName(el){if(!el)return'Nothing selected';const h=el.matches('h1,h2,h3,h4')?el:el.querySelector?.(':scope > h1,:scope > h2,:scope > h3,:scope > .section-heading h2,:scope > .page-heading h1');const title=(h?.textContent||'').trim();if(title)return title;return el.id?`#${el.id}`:(el.classList?.[0]?`.${el.classList[0]}`:el.tagName.toLowerCase());}
  function select(el){el=candidate(el);if(!el)return;selected=el;selectedKey=selector(el);syncSelection();renderInspector();}
  function clearSelection(){selected=null;selectedKey='';if(selectionBox)selectionBox.hidden=true;renderInspector();}
  function syncSelection(){
    if(!active||!selectionBox)return;if(selectedKey&&!selected?.isConnected)selected=resolve(selectedKey);if(!selected?.isConnected){selectionBox.hidden=true;return;}const r=selected.getBoundingClientRect();if(!r.width||!r.height){selectionBox.hidden=true;return;}selectionBox.hidden=false;selectionBox.style.left=r.left+'px';selectionBox.style.top=r.top+'px';selectionBox.style.width=r.width+'px';selectionBox.style.height=r.height+'px';$('.dev21-selection-label',selectionBox).textContent=semanticName(selected);
  }

  function selectableElements(){return $$('section,article,.hero-grid,.wizard-card,.panel,.table-card,.compare-zone,.finance-subview,.trip-gallery-section,.tw-current-trips-section,.tw-current-list,.trip-gallery,.wishlist-wrap,.finance-grid,.kpis,.tw-current-card,.main,.sheet.active').filter(el=>!el.closest('.dev21-inspector,.dev21-context,.dev21-toolbar')&&el.getClientRects().length);}
  function intersection(a,b){const l=Math.max(a.left,b.left),t=Math.max(a.top,b.top),r=Math.min(a.right,b.right),bt=Math.min(a.bottom,b.bottom);return Math.max(0,r-l)*Math.max(0,bt-t);}
  function pickFromRect(r){
    const area=Math.max(1,r.width*r.height);let best=null,bestScore=-1;
    selectableElements().forEach(el=>{const e=el.getBoundingClientRect(),ea=Math.max(1,e.width*e.height),i=intersection(r,e);if(i<Math.min(120,area*.14)||i/ea<.12)return;let score=(i/area)*.45+(i/ea)*.55;if(el.matches('section,article,[id],.tw-current-card,.wizard-card'))score+=.12;if(ea>area*9)score-=.28;if(score>bestScore){best=el;bestScore=score;}});
    if(best)return best;const cx=r.left+r.width/2,cy=r.top+r.height/2;return candidate(document.elementFromPoint(cx,cy))?.closest?.('section,article,.panel,.wizard-card,.tw-current-card,.finance-subview,div')||null;
  }

  function startMarquee(e){if(!active||e.button!==0||e.target.closest('.dev21-drag-handle,.dev21-context,.dev21-inspector,.dev21-toolbar,input,textarea,select,[contenteditable="true"]'))return;marqueeState={sx:e.clientX,sy:e.clientY,lastX:e.clientX,lastY:e.clientY,dragging:false,pointerId:e.pointerId,target:e.target};}
  function moveMarquee(e){if(!marqueeState||e.pointerId!==marqueeState.pointerId)return;const dx=e.clientX-marqueeState.sx,dy=e.clientY-marqueeState.sy;if(!marqueeState.dragging&&Math.hypot(dx,dy)<8)return;marqueeState.dragging=true;marqueeState.lastX=e.clientX;marqueeState.lastY=e.clientY;e.preventDefault();const left=Math.min(marqueeState.sx,e.clientX),top=Math.min(marqueeState.sy,e.clientY),w=Math.abs(dx),h=Math.abs(dy);marquee.hidden=false;Object.assign(marquee.style,{left:left+'px',top:top+'px',width:w+'px',height:h+'px'});}
  function endMarquee(e){if(!marqueeState||e.pointerId!==marqueeState.pointerId)return;const s=marqueeState;marqueeState=null;if(!s.dragging)return;const left=Math.min(s.sx,e.clientX),top=Math.min(s.sy,e.clientY),right=Math.max(s.sx,e.clientX),bottom=Math.max(s.sy,e.clientY),r={left,top,right,bottom,width:right-left,height:bottom-top};marquee.hidden=true;suppressClickUntil=performance.now()+260;e.preventDefault();e.stopPropagation();const el=pickFromRect(r);if(el)select(el);}

  function textTarget(el){if(!el)return null;if(el.childElementCount===0&&String(el.textContent||'').trim())return el;if(el.matches('section,article,div'))return el.querySelector(':scope > h1,:scope > h2,:scope > h3,:scope > .section-heading h2,:scope > .page-heading h1,:scope > .panel-head h2');return null;}
  function beginInline(el){el=textTarget(el)||el;if(!el||el.childElementCount>0)return toast('Double-click a specific text or heading to edit it','warn');finishInline(false);select(el);captureContent(el);editNode=el;editBefore=el.textContent;el.contentEditable='true';el.classList.add('dev21-inline-edit');el.focus();const sel=window.getSelection(),range=document.createRange();range.selectNodeContents(el);sel.removeAllRanges();sel.addRange(range);}
  function finishInline(commit=true){if(!editNode)return;const el=editNode,newText=el.textContent;el.contentEditable='false';el.removeAttribute('contenteditable');el.classList.remove('dev21-inline-edit');editNode=null;if(commit&&newText!==editBefore){if(contentBases.has(el)){const original=contentBases.get(el);el.innerHTML=original;contentBases.delete(el);}patchText(el,newText);}else if(contentBases.has(el)){el.innerHTML=contentBases.get(el);contentBases.delete(el);}editBefore='';}

  function field(label,type,value,onchange,options=[]){const row=document.createElement('label');row.className='dev21-field';const span=document.createElement('span');span.textContent=label;row.appendChild(span);let input;if(type==='select'){input=document.createElement('select');options.forEach(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;input.appendChild(o);});}else if(type==='textarea'){input=document.createElement('textarea');}else{input=document.createElement('input');input.type=type;}input.value=value??'';input.addEventListener(type==='color'||type==='range'?'input':'change',()=>onchange(input.value));row.appendChild(input);return row;}
  function group(title){const g=document.createElement('section');g.className='dev21-group';const h=document.createElement('h4');h.textContent=title;g.appendChild(h);return g;}
  function btn(text,fn,cls=''){const b=document.createElement('button');b.type='button';b.textContent=text;b.className=cls;b.onclick=fn;return b;}
  function rgbHex(v){if(/^#[0-9a-f]{6}$/i.test(v||''))return v;const m=String(v||'').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);if(!m)return'#ffffff';return'#'+[m[1],m[2],m[3]].map(x=>Number(x).toString(16).padStart(2,'0')).join('');}
  const ICONS=['plane','train','car','bus','ship','hotel','bed','house','building','utensils','mug-hot','cart-shopping','basket-shopping','gas-pump','square-parking','location-dot','map','map-location-dot','earth-europe','suitcase','passport','ticket','receipt','wallet','credit-card','euro-sign','coins','piggy-bank','chart-line','chart-pie','calendar','clock','bell','heart','star','bookmark','flag','check','xmark','plus','minus','arrow-right','arrow-left','arrow-up','arrow-down','up-right-from-square','pen','pencil','trash','copy','clone','layer-group','grip','arrows-up-down-left-right','palette','droplet','font','text-height','border-all','wand-magic-sparkles','sparkles','gear','sliders','lock','unlock','eye','eye-slash','circle-info','circle-question','camera','image','music','gift','briefcase','laptop','mobile-screen'];
  function iconTarget(){if(!selected)return null;if(selected.matches('i,.pick-icon,.brand-mark,.identity-heart,.question-icon')||selected.childElementCount===0&&selected.textContent.trim().length<=4)return selected;return selected.querySelector('i,.pick-icon,.brand-mark,.identity-heart,.question-icon');}
  function applyIcon(name){let target=iconTarget();if(!target){toast('Select an icon or small symbol first','warn');return;}patchHtml(target,`<i class="fa-solid fa-${name}" aria-hidden="true"></i>`);}

  function renderInspector(){
    if(!inspector)return;const panel=$('.dev21-panel',inspector);panel.replaceChildren();$$('.dev21-tabs button',inspector).forEach(x=>x.classList.toggle('active',x.dataset.tab===inspectorTab));$('.dev21-inspector-head h3',inspector).textContent=selected?semanticName(selected):'DEV editor';$('.dev21-inspector-head p',inspector).textContent=selected?'Right-click for quick actions · drag the MOVE handle to reorder or create columns.':'Drag a rectangle to select a section, double-click text to edit, or right-click anything.';
    if(!selected){const g=group('How to use DEV');const p=document.createElement('p');p.style.cssText='font-size:12px;line-height:1.55;color:#786765;margin:0';p.textContent='Single left-click behaves normally. Drag a selection rectangle over a section. Double-click text to edit it. Right-click any element for styling, icons, duplication, hiding, or advanced layout.';g.appendChild(p);panel.appendChild(g);return;}
    const cs=getComputedStyle(selected),p=patches[selectedKey]||{};
    if(inspectorTab==='appearance'){
      const title=textTarget(selected);if(title){const g=group('Text / title');g.append(field('Title or text','textarea',title.textContent,v=>patchText(title,v)));panel.appendChild(g);}
      const type=group('Typography');const fonts=[['Crimson Pro','Crimson Pro'],['Georgia','Georgia'],['Playfair Display','Playfair Display'],['Inter','Inter'],['Arial','Arial'],['Trebuchet MS','Trebuchet MS'],['monospace','Monospace']];type.append(field('Font','select',cs.fontFamily.split(',')[0].replace(/["']/g,''),v=>patchStyle('font-family',v),fonts));type.append(field('Size','number',parseFloat(cs.fontSize)||16,v=>patchStyle('font-size',Math.max(7,Number(v)||16)+'px')));type.append(field('Weight','select',cs.fontWeight,v=>patchStyle('font-weight',v),[['300','Light'],['400','Regular'],['500','Medium'],['600','Semibold'],['700','Bold'],['800','Heavy']]));type.append(field('Align','select',cs.textAlign,v=>patchStyle('text-align',v),[['left','Left'],['center','Center'],['right','Right']]));panel.appendChild(type);
      const surf=group('Colour & surface');surf.append(field('Text','color',rgbHex(cs.color),v=>patchStyle('color',v)));surf.append(field('Background','color',rgbHex(cs.backgroundColor),v=>patchStyle('background-color',v)));surf.append(field('Border','color',rgbHex(cs.borderColor),v=>patchStyle('border-color',v)));surf.append(field('Opacity','range',Math.round((Number(cs.opacity)||1)*100),v=>patchStyle('opacity',String(Number(v)/100))));panel.appendChild(surf);
      const quick=group('Finish');const a=document.createElement('div');a.className='dev21-actions';a.append(btn('Soft shadow',()=>patchStyle('box-shadow','0 14px 36px rgba(55,38,28,.12)')),btn('Deep shadow',()=>patchStyle('box-shadow','0 24px 64px rgba(46,31,31,.20)')),btn('No shadow',()=>patchStyle('box-shadow','none')),btn('Thin border',()=>patchStyle('border','1px solid #dfd3c6')));quick.appendChild(a);panel.appendChild(quick);
    }else if(inspectorTab==='layout'){
      const g=group('Size & spacing');g.append(field('Width','text',p.style?.width||selected.style.width||'',v=>patchStyle('width',v||'auto')));g.append(field('Height','text',p.style?.height||selected.style.height||'',v=>patchStyle('height',v||'auto')));g.append(field('Max width','text',p.style?.['max-width']||selected.style.maxWidth||'',v=>patchStyle('max-width',v||'none')));g.append(field('Padding','number',parseFloat(cs.padding)||0,v=>patchStyle('padding',Math.max(0,Number(v)||0)+'px')));g.append(field('Margin','number',parseFloat(cs.margin)||0,v=>patchStyle('margin',(Number(v)||0)+'px')));g.append(field('Radius','number',parseFloat(cs.borderRadius)||0,v=>patchStyle('border-radius',Math.max(0,Number(v)||0)+'px')));panel.appendChild(g);
      const flow=group('Layout');flow.append(field('Display','select',cs.display,v=>patchStyle('display',v),[['block','Block'],['flex','Flex'],['grid','Grid'],['inline-block','Inline block'],['inline','Inline']]));flow.append(field('Gap','text',p.style?.gap||cs.gap||'',v=>patchStyle('gap',v)));flow.append(field('Columns','text',p.style?.['grid-template-columns']||'',v=>patchStyle('grid-template-columns',v)));flow.append(field('Align items','select',cs.alignItems,v=>patchStyle('align-items',v),[['stretch','Stretch'],['start','Start'],['center','Center'],['end','End']]));flow.append(field('Justify','select',cs.justifyContent,v=>patchStyle('justify-content',v),[['start','Start'],['center','Center'],['space-between','Space between'],['end','End']]));panel.appendChild(flow);
      const move=group('Position');move.append(field('X offset','number',parseFloat(p.style?.['--dev21-x'])||0,v=>{const x=Number(v)||0,y=parseFloat(p.style?.['--dev21-y'])||0;patchMany({'--dev21-x':x,'transform':`translate(${x}px,${y}px)`});}));move.append(field('Y offset','number',parseFloat(p.style?.['--dev21-y'])||0,v=>{const y=Number(v)||0,x=parseFloat(p.style?.['--dev21-x'])||0;patchMany({'--dev21-y':y,'transform':`translate(${x}px,${y}px)`});}));move.append(field('Z-index','number',p.style?.['z-index']||cs.zIndex||0,v=>patchStyle('z-index',String(Number(v)||0))));panel.appendChild(move);
      const act=group('Arrange');const a=document.createElement('div');a.className='dev21-actions';a.append(btn('Duplicate',duplicateSelected),btn('Hide in DEV',hideSelected,'danger'),btn('Reset this',resetSelected),btn('Bring front',()=>patchStyle('z-index','999')));act.appendChild(a);panel.appendChild(act);
    }else if(inspectorTab==='icons'){
      const g=group('Icon library');const search=document.createElement('input');search.className='dev21-icon-search';search.placeholder='Search icons…';const grid=document.createElement('div');grid.className='dev21-icon-grid';function draw(q=''){grid.replaceChildren();ICONS.filter(n=>n.includes(q.toLowerCase())).forEach(name=>{const b=document.createElement('button');b.type='button';b.title=name;b.innerHTML=`<i class="fa-solid fa-${name}" aria-hidden="true"></i><small>${name}</small>`;b.onclick=()=>applyIcon(name);grid.appendChild(b);});}search.oninput=()=>draw(search.value);draw();g.append(search,grid);panel.appendChild(g);
      const info=document.createElement('p');info.style.cssText='font-size:11px;color:#806f6b;line-height:1.5;margin:0';info.textContent='Icons are loaded from Font Awesome Free only while DEV is active. Select an existing icon/symbol, then choose a replacement.';panel.appendChild(info);
    }else{
      const t=group('Transform');t.append(field('Scale','number',parseFloat(p.style?.scale)||1,v=>patchStyle('scale',String(Math.max(.1,Math.min(5,Number(v)||1)))));t.append(field('Rotate','number',parseFloat(p.style?.rotate)||0,v=>patchStyle('rotate',(Number(v)||0)+'deg')));t.append(field('Letter spacing','text',p.style?.['letter-spacing']||cs.letterSpacing||'',v=>patchStyle('letter-spacing',v)));t.append(field('Line height','text',p.style?.['line-height']||cs.lineHeight||'',v=>patchStyle('line-height',v)));panel.appendChild(t);
      const custom=group('Custom CSS property');let prop='',val='';custom.append(field('Property','text','',v=>prop=v.trim()));custom.append(field('Value','text','',v=>val=v));const apply=document.createElement('div');apply.className='dev21-actions';apply.append(btn('Apply property',()=>{if(prop)patchStyle(prop,val);}),btn('Copy CSS',async()=>{const txt=Object.entries(p.style||{}).map(([k,v])=>`${k}: ${v};`).join('\n');copiedStyle=clone(p.style||{});try{await navigator.clipboard.writeText(txt);}catch{}toast('DEV style copied');}),btn('Paste copied style',()=>{if(copiedStyle)patchMany(copiedStyle);}),btn('Reset element',resetSelected));custom.appendChild(apply);panel.appendChild(custom);
    }
  }

  function showInspector(tab){inspectorTab=tab||inspectorTab;inspector.hidden=false;renderInspector();}
  function hideSelected(){if(!selectedKey)return;mutate(()=>{patchFor(selectedKey).hidden=true;});clearSelection();}
  function sanitizeClone(el){const c=el.cloneNode(true);[c,...c.querySelectorAll('*')].forEach(n=>{n.removeAttribute?.('id');for(const a of [...(n.attributes||[])])if(/^data-(current|open-trip|wish-index|fin-month)/.test(a.name))n.removeAttribute(a.name);});return c.outerHTML;}
  function duplicateSelected(){if(!selected)return;const id=crypto.randomUUID?.()||('d'+Date.now()),key=`[data-dev21-added="${safeCss(id)}"]`,parent=selector(selected.parentElement),after=selectedKey,html=sanitizeClone(selected);mutate(()=>{patches[key]={add:true,id,parent,after,html,style:{}};});toast('Duplicated in DEV only');}
  function addBlock(kind){const parent=selected?.parentElement||$('.sheet.active')||$('main');if(!parent)return;const id=crypto.randomUUID?.()||('a'+Date.now()),key=`[data-dev21-added="${safeCss(id)}"]`,tag=kind==='section'?'section':'div',text=kind==='section'?'New test section':'New test text';const html=`<${tag} class="dev21-added"><${kind==='section'?'h2':'span'}>${text}</${kind==='section'?'h2':'span'}></${tag}>`;mutate(()=>{patches[key]={add:true,id,parent:selector(parent),after:selectedKey,html,style:{}};});setTimeout(()=>{const el=resolve(key);if(el)select(el);},0);}

  async function deleteReal(){
    if(!selected)return;const trip=selected.closest('[data-open-trip],[data-current-trip]'),month=selected.closest('[data-fin-month]'),wish=selected.closest('tr')?.querySelector('[data-wish-index]');if(!trip&&!month&&!wish)return toast('This selected item has no supported permanent delete action','warn');if(!confirm('Delete the REAL saved data permanently? This is not a DEV-only hide.'))return;
    try{if(trip){await window.TwogetherAPI.post('deleteTrip',{id:trip.dataset.openTrip||trip.dataset.currentTrip},actor());await window.TwogetherV18?.refresh(true);}else if(month){await window.TwogetherAPI.post('deleteFinanceMonth',{month:month.dataset.finMonth},actor());document.dispatchEvent(new CustomEvent('twogether:finance-view',{detail:{view:'monthly'}}));}else if(wish){wish.click();setTimeout(()=>$('#wishlistMiniBody [data-wish-delete]')?.click(),40);}toast('Deleted');}catch(e){toast(e.message||'Could not delete','warn');}
  }

  function openContext(e,el){select(el);context.replaceChildren();const item=(icon,label,fn,cls='')=>{const b=document.createElement('button');b.type='button';b.className=cls;b.innerHTML=`<span class="ctx-icon"><i class="fa-solid fa-${icon}"></i></span>${label}`;b.onclick=()=>{context.hidden=true;fn();};context.appendChild(b);};
    item('pen','Edit title / text',()=>{const t=textTarget(selected);if(t)beginInline(t);else showInspector('appearance');});item('palette','Style & colours',()=>showInspector('appearance'));item('arrows-up-down-left-right','Layout & position',()=>showInspector('layout'));item('icons','Change icon',()=>showInspector('icons'));item('clone','Duplicate whole selection',duplicateSelected);item('grip','Move / reorder',()=>toast('Drag the MOVE handle above the selected box, then drop left/right/above/below another section.'));const hr=document.createElement('hr');context.appendChild(hr);item('font','Add text after',()=>addBlock('text'));item('layer-group','Add section after',()=>addBlock('section'));item('eye-slash','Hide in DEV',hideSelected);item('rotate-left','Reset selected',resetSelected);if(selected.closest('[data-open-trip],[data-current-trip],[data-fin-month]')||selected.closest('tr')?.querySelector('[data-wish-index]')){const hr2=document.createElement('hr');context.appendChild(hr2);item('trash','Delete REAL saved item…',deleteReal,'danger');}
    context.hidden=false;const w=240,h=Math.min(430,context.scrollHeight||360);context.style.left=Math.max(8,Math.min(innerWidth-w-8,e.clientX))+'px';context.style.top=Math.max(8,Math.min(innerHeight-h-8,e.clientY))+'px';
  }

  function dropTargetAt(x,y){let el=document.elementFromPoint(x,y);if(!el)return null;if(el.closest('.dev21-selection,.dev21-context,.dev21-inspector,.dev21-toolbar'))return null;el=el.closest('section,article,.panel,.wizard-card,.tw-current-card,.trip-gallery-section,.finance-subview,.hero-grid,.table-card,div');if(!el||el===selected||selected?.contains(el))return null;return el;}
  function dropMode(target,x,y){const r=target.getBoundingClientRect(),rx=(x-r.left)/Math.max(1,r.width),ry=(y-r.top)/Math.max(1,r.height);if(rx<.24)return'left';if(rx>.76)return'right';return ry<.5?'before':'after';}
  function showDrop(target,mode){if(!target){dropBox.hidden=true;return;}const r=target.getBoundingClientRect();dropBox.hidden=false;dropBox.style.left=r.left+'px';dropBox.style.top=r.top+'px';dropBox.style.width=r.width+'px';dropBox.style.height=r.height+'px';$('span',dropBox).textContent=mode==='left'?'Place left':mode==='right'?'Place right':mode==='before'?'Place above':'Place below';}
  function startMove(e){if(!selected)return;e.preventDefault();e.stopPropagation();moveState={pointerId:e.pointerId,target:null,mode:null};e.currentTarget.setPointerCapture?.(e.pointerId);}
  function moveSelectedPointer(e){if(!moveState||e.pointerId!==moveState.pointerId)return;e.preventDefault();const target=dropTargetAt(e.clientX,e.clientY),mode=target?dropMode(target,e.clientX,e.clientY):null;moveState.target=target;moveState.mode=mode;showDrop(target,mode);}
  function endMove(e){if(!moveState||e.pointerId!==moveState.pointerId)return;const s=moveState;moveState=null;dropBox.hidden=true;if(!s.target||!s.mode)return;const targetKey=selector(s.target);mutate(()=>{patchFor(selectedKey).placement={mode:s.mode,target:targetKey};});}

  function loadFontAwesome(){if($('#twDevFontAwesome'))return;const l=document.createElement('link');l.id='twDevFontAwesome';l.rel='stylesheet';l.href='https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css';document.head.appendChild(l);}
  function installUI(){if(selectionBox)return;
    selectionBox=document.createElement('div');selectionBox.className='dev21-selection';selectionBox.hidden=true;selectionBox.innerHTML='<span class="dev21-selection-label"></span><button type="button" class="dev21-drag-handle" title="Drag to move/reorder">MOVE</button>';document.body.appendChild(selectionBox);
    marquee=document.createElement('div');marquee.className='dev21-marquee';marquee.hidden=true;document.body.appendChild(marquee);
    dropBox=document.createElement('div');dropBox.className='dev21-drop';dropBox.hidden=true;dropBox.innerHTML='<span></span>';document.body.appendChild(dropBox);
    context=document.createElement('div');context.className='dev21-context';context.hidden=true;document.body.appendChild(context);
    inspector=document.createElement('aside');inspector.className='dev21-inspector';inspector.hidden=true;inspector.innerHTML='<div class="dev21-inspector-head"><div><h3>DEV editor</h3><p></p></div><button type="button" aria-label="Close editor">×</button></div><div class="dev21-tabs"><button type="button" data-tab="appearance">Style</button><button type="button" data-tab="layout">Layout</button><button type="button" data-tab="icons">Icons</button><button type="button" data-tab="advanced">Advanced</button></div><div class="dev21-panel"></div>';document.body.appendChild(inspector);
    toolbar=document.createElement('div');toolbar.className='dev21-toolbar';toolbar.hidden=true;toolbar.innerHTML='<button type="button" data-u>Undo</button><button type="button" data-r>Redo</button><button type="button" data-reset>Reset</button><button type="button" data-add>+ Text</button><button type="button" class="dev21-exit" data-exit>Exit DEV</button>';document.body.appendChild(toolbar);
    $('.dev21-drag-handle',selectionBox).addEventListener('pointerdown',startMove);$('.dev21-drag-handle',selectionBox).addEventListener('pointermove',moveSelectedPointer);$('.dev21-drag-handle',selectionBox).addEventListener('pointerup',endMove);
    $('.dev21-inspector-head button',inspector).onclick=()=>inspector.hidden=true;$$('.dev21-tabs button',inspector).forEach(b=>b.onclick=()=>{inspectorTab=b.dataset.tab;renderInspector();});$('[data-u]',toolbar).onclick=undo;$('[data-r]',toolbar).onclick=redo;$('[data-reset]',toolbar).onclick=()=>{if(confirm('Reset the entire DEV playground? You can undo this with Ctrl/Cmd+Z.'))reset();};$('[data-add]',toolbar).onclick=()=>addBlock('text');$('[data-exit]',toolbar).onclick=exit;
  }

  function enter(){if(active||!actor())return;loadFontAwesome();installUI();active=true;document.body.classList.add('dev-playground','dev-v21');document.body.classList.remove('dev-v19');toolbar.hidden=false;applyPatches();renderInspector();syncSelection();emit();toast('DEV playground: drag-select sections · double-click text · right-click for tools');}
  function exit(){if(!active)return;finishInline(true);restoreSession();active=false;selected=null;selectedKey='';document.body.classList.remove('dev-playground','dev-v21','dev-v19');if(selectionBox)selectionBox.hidden=true;if(marquee)marquee.hidden=true;if(dropBox)dropBox.hidden=true;if(context)context.hidden=true;if(inspector)inspector.hidden=true;if(toolbar)toolbar.hidden=true;emit();}

  document.addEventListener('pointerdown',startMarquee,true);document.addEventListener('pointermove',moveMarquee,{capture:true,passive:false});document.addEventListener('pointerup',endMarquee,true);
  document.addEventListener('click',e=>{if(active&&performance.now()<suppressClickUntil){e.preventDefault();e.stopImmediatePropagation();}},true);
  document.addEventListener('dblclick',e=>{if(!active||e.target.closest('.dev21-context,.dev21-inspector,.dev21-toolbar,.dev21-selection'))return;const t=textTarget(candidate(e.target));if(!t)return;e.preventDefault();e.stopImmediatePropagation();beginInline(t);},true);
  document.addEventListener('contextmenu',e=>{if(!active||e.target.closest('.dev21-context,.dev21-inspector,.dev21-toolbar,.dev21-selection'))return;e.preventDefault();e.stopImmediatePropagation();openContext(e,candidate(e.target));},true);
  document.addEventListener('click',e=>{if(active&&!e.target.closest('.dev21-context')&&context)context.hidden=true;},true);
  document.addEventListener('keydown',e=>{if(!active)return;if(editNode){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();finishInline(true);}else if(e.key==='Escape'){e.preventDefault();finishInline(false);}return;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();return;}if(selected&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&!e.target.matches('input,textarea,select')){e.preventDefault();const step=e.shiftKey?10:1,p=patches[selectedKey]||{},x=parseFloat(p.style?.['--dev21-x'])||0,y=parseFloat(p.style?.['--dev21-y'])||0,nx=x+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),ny=y+(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0);patchMany({'--dev21-x':nx,'--dev21-y':ny,transform:`translate(${nx}px,${ny}px)`});}},true);
  document.addEventListener('focusout',e=>{if(editNode&&e.target===editNode)setTimeout(()=>finishInline(true),0);},true);
  window.addEventListener('scroll',()=>{if(active){syncSelection();context.hidden=true;}},{passive:true});window.addEventListener('resize',()=>active&&syncSelection(),{passive:true});
  document.addEventListener('twogether:v18-rendered',()=>{enhanceTripCards();if(active){clearTimeout(mutationTimer);mutationTimer=setTimeout(()=>{restoreSession();applyPatches();syncSelection();},30);}});
  document.addEventListener('twogether:finance-view',()=>setTimeout(compactWishlist,40));
  document.addEventListener('twogether:state-refreshed',()=>{setTimeout(()=>window.TwogetherV18?.refresh(false),0);});

  document.addEventListener('DOMContentLoaded',()=>{
    installUI();enhanceTripCards();compactWishlist();
    const trips=$('#twCurrentTrips');if(trips)new MutationObserver(()=>requestAnimationFrame(enhanceTripCards)).observe(trips,{childList:true,subtree:true});
    const wish=$('#financeWishlist');if(wish)new MutationObserver(()=>requestAnimationFrame(compactWishlist)).observe(wish,{childList:true,subtree:true,characterData:true});
    const mo=new MutationObserver(()=>{if(active){clearTimeout(mutationTimer);mutationTimer=setTimeout(()=>{applyPatches();syncSelection();},80);}});mo.observe(document.body,{childList:true,subtree:true});
  });

  /* Replace the legacy DEV controller while leaving its inactive listeners harmless. */
  window.__TWOGETHER_USE_V21_DEV__=true;
  window.TwogetherDevV18={enter,exit,undo,redo,reset,get active(){return active;},get selected(){return null;}};
  window.TwogetherDevV21={enter,exit,undo,redo,reset,get active(){return active;},get selected(){return selected;}};
})();
