(() => {
  'use strict';
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const KEY='twogether_dev_playground_v21';
  const ACTORS=['Principessa','Principe'];
  const copy=v=>JSON.parse(JSON.stringify(v));
  let active=false, selected=null, selectedKey='', patches={}, past=[], future=[];
  let selection=null, marquee=null, context=null, inspector=null, toolbar=null, drop=null;
  let marqueeState=null, moveState=null, editing=null, copiedStyle=null, suppressUntil=0, tab='style';
  const styleBase=new Map(), htmlBase=new Map(), posBase=new Map(), wrappers=new Set();
  try{const s=JSON.parse(localStorage.getItem(KEY)||'{}');patches=s.patches||{};past=s.past||[];future=s.future||[];}catch{}

  function actor(){const a=document.body.dataset.actor||localStorage.getItem('twogether_actor_v1')||'';return ACTORS.includes(a)?a:'';}
  function esc(v){return window.CSS?.escape?CSS.escape(String(v)):String(v).replace(/[^a-zA-Z0-9_-]/g,'\\$&');}
  function selector(el){
    if(!el)return'';if(el===document.body)return'body';if(el.id)return'#'+esc(el.id);
    for(const a of ['data-current-plan','data-current-trip','data-open-trip','data-fin-month','data-fin-view','data-sheet','data-dev21-added']){
      if(el.hasAttribute?.(a))return`[${a}="${esc(el.getAttribute(a))}"]`;
    }
    const p=el.parentElement;if(!p)return'';const ps=selector(p);if(!ps)return'';const same=[...p.children].filter(x=>x.tagName===el.tagName);return`${ps} > ${el.tagName.toLowerCase()}:nth-of-type(${same.indexOf(el)+1})`;
  }
  function resolve(key){try{return document.querySelector(key);}catch{return null;}}
  function persist(){try{localStorage.setItem(KEY,JSON.stringify({patches,past:past.slice(-100),future:future.slice(-100)}));}catch{}}
  function toast(msg,tone='ok'){const el=$('#toast');if(!el)return;el.textContent=msg;el.className='toast show '+tone;clearTimeout(el._dev21);el._dev21=setTimeout(()=>el.className='toast',2500);}
  function emit(){document.dispatchEvent(new CustomEvent('twogether:dev-changed'));}
  function rememberStyle(el){if(el&&!styleBase.has(el))styleBase.set(el,el.getAttribute('style'));}
  function rememberHtml(el){if(el&&!htmlBase.has(el))htmlBase.set(el,el.innerHTML);}
  function rememberPos(el){if(el&&!posBase.has(el))posBase.set(el,{parent:el.parentNode,next:el.nextSibling});}

  function restoreSession(){
    for(const [el,p] of [...posBase.entries()].reverse()){
      if(!el?.isConnected||!p.parent?.isConnected)continue;
      if(p.next&&p.next.parentNode===p.parent)p.parent.insertBefore(el,p.next);else p.parent.appendChild(el);
    }
    posBase.clear();
    wrappers.forEach(w=>{if(!w.isConnected)return;while(w.firstChild)w.parentNode?.insertBefore(w.firstChild,w);w.remove();});
    wrappers.clear();
    for(const [el,s] of styleBase)if(el?.isConnected){if(s==null)el.removeAttribute('style');else el.setAttribute('style',s);}styleBase.clear();
    for(const [el,h] of htmlBase)if(el?.isConnected)el.innerHTML=h;htmlBase.clear();
    $$('[data-dev21-added]').forEach(x=>x.remove());
  }

  function patch(key){if(!patches[key])patches[key]={style:{}};if(!patches[key].style)patches[key].style={};return patches[key];}
  function applyPlacement(el,p){
    const target=resolve(p?.target);if(!el||!target||el===target||el.contains(target))return;
    rememberPos(el);
    if(p.mode==='before'){target.parentNode?.insertBefore(el,target);return;}
    if(p.mode==='after'){target.parentNode?.insertBefore(el,target.nextSibling);return;}
    if(p.mode==='left'||p.mode==='right'){
      rememberPos(target);const parent=target.parentNode;if(!parent)return;
      const wrap=document.createElement('div');wrap.className='dev21-split';wrap.dataset.dev21Wrapper='1';parent.insertBefore(wrap,target);wrappers.add(wrap);
      if(p.mode==='left')wrap.append(el,target);else wrap.append(target,el);
    }
  }
  function applyPatches(){
    if(!active)return;
    for(const [key,p] of Object.entries(patches)){
      if(!p.add||resolve(key))continue;const parent=resolve(p.parent)||$('.sheet.active')||$('main');if(!parent)continue;
      const t=document.createElement('template');t.innerHTML=String(p.html||'<div>Test block</div>').trim();const el=t.content.firstElementChild||document.createElement('div');el.dataset.dev21Added=p.id;el.classList.add('dev21-added');const after=resolve(p.after);if(after?.parentNode===parent)parent.insertBefore(el,after.nextSibling);else parent.appendChild(el);
    }
    for(const [key,p] of Object.entries(patches)){
      const el=resolve(key);if(!el)continue;rememberStyle(el);
      if(p.text!==undefined){rememberHtml(el);el.textContent=p.text;}
      if(p.html!==undefined){rememberHtml(el);el.innerHTML=p.html;}
      for(const [k,v] of Object.entries(p.style||{}))el.style.setProperty(k,String(v));
      if(p.hidden)el.style.setProperty('display','none','important');
    }
    for(const [key,p] of Object.entries(patches))if(p.placement)applyPlacement(resolve(key),p.placement);
  }
  function mutate(fn){past.push(copy(patches));past=past.slice(-100);future=[];restoreSession();fn();persist();applyPatches();refreshSelection();renderInspector();emit();}
  function undo(){if(!past.length)return;finishEdit(false);restoreSession();future.push(copy(patches));patches=past.pop();persist();applyPatches();refreshSelection();renderInspector();emit();}
  function redo(){if(!future.length)return;finishEdit(false);restoreSession();past.push(copy(patches));patches=future.pop();persist();applyPatches();refreshSelection();renderInspector();emit();}
  function reset(){mutate(()=>{patches={};});toast('DEV reset — Ctrl/Cmd+Z can undo it');}
  function setStyle(name,value,key=selectedKey){if(!key)return;mutate(()=>{const p=patch(key);if(value===''||value==null)delete p.style[name];else p.style[name]=String(value);});}
  function setStyles(values,key=selectedKey){if(!key)return;mutate(()=>{Object.assign(patch(key).style,values);});}
  function setText(el,text){const key=selector(el);if(!key)return;mutate(()=>{const p=patch(key);p.text=String(text);delete p.html;});}
  function setHtml(el,html){const key=selector(el);if(!key)return;mutate(()=>{const p=patch(key);p.html=String(html);delete p.text;});}

  function ignore(el){return !el||el===document.body||el===document.documentElement||el.closest?.('.dev21-context,.dev21-inspector,.dev21-toolbar,.dev21-selection,.dev21-marquee,.dev21-drop,.identity-modal');}
  function label(el){if(!el)return'Nothing selected';const h=el.matches('h1,h2,h3,h4')?el:el.querySelector?.(':scope > h1,:scope > h2,:scope > h3,:scope > .section-heading h2,:scope > .page-heading h1');const t=(h?.textContent||'').trim();return t||(el.id?'#'+el.id:'')||(el.classList?.[0]?'.'+el.classList[0]:el.tagName.toLowerCase());}
  function choose(el){if(ignore(el))return;selected=el;selectedKey=selector(el);refreshSelection();renderInspector();}
  function clear(){selected=null;selectedKey='';if(selection)selection.hidden=true;renderInspector();}
  function refreshSelection(){if(!active||!selection)return;if(selectedKey&&!selected?.isConnected)selected=resolve(selectedKey);if(!selected?.isConnected){selection.hidden=true;return;}const r=selected.getBoundingClientRect();if(!r.width||!r.height){selection.hidden=true;return;}selection.hidden=false;selection.style.left=r.left+'px';selection.style.top=r.top+'px';selection.style.width=r.width+'px';selection.style.height=r.height+'px';$('.dev21-selection-label',selection).textContent=label(selected);}

  function selectable(){return $$('section,article,.hero-grid,.wizard-card,.panel,.table-card,.compare-zone,.finance-subview,.trip-gallery-section,.tw-current-trips-section,.tw-current-list,.trip-gallery,.wishlist-wrap,.finance-grid,.kpis,.tw-current-card,.main,.sheet.active').filter(x=>x.getClientRects().length&&!x.closest('.dev21-inspector,.dev21-context,.dev21-toolbar'));}
  function overlap(a,b){const l=Math.max(a.left,b.left),t=Math.max(a.top,b.top),r=Math.min(a.right,b.right),bt=Math.min(a.bottom,b.bottom);return Math.max(0,r-l)*Math.max(0,bt-t);}
  function pickRect(r){
    const area=Math.max(1,r.width*r.height);let best=null,score=-Infinity;
    for(const el of selectable()){
      const e=el.getBoundingClientRect(),ea=Math.max(1,e.width*e.height),hit=overlap(r,e);if(hit<Math.min(100,area*.12))continue;
      let s=(hit/area)*.48+(hit/ea)*.52;if(el.matches('section,article,[id],.tw-current-card,.wizard-card'))s+=.12;if(ea>area*9)s-=.3;if(s>score){best=el;score=s;}
    }
    return best;
  }
  function marqueeDown(e){if(!active||e.button!==0||e.target.closest('.dev21-drag-handle,.dev21-context,.dev21-inspector,.dev21-toolbar,input,textarea,select,[contenteditable="true"]'))return;marqueeState={x:e.clientX,y:e.clientY,id:e.pointerId,drag:false};}
  function marqueeMove(e){if(!marqueeState||e.pointerId!==marqueeState.id)return;const dx=e.clientX-marqueeState.x,dy=e.clientY-marqueeState.y;if(!marqueeState.drag&&Math.hypot(dx,dy)<8)return;marqueeState.drag=true;e.preventDefault();const l=Math.min(marqueeState.x,e.clientX),t=Math.min(marqueeState.y,e.clientY);marquee.hidden=false;Object.assign(marquee.style,{left:l+'px',top:t+'px',width:Math.abs(dx)+'px',height:Math.abs(dy)+'px'});}
  function marqueeUp(e){if(!marqueeState||e.pointerId!==marqueeState.id)return;const s=marqueeState;marqueeState=null;if(!s.drag)return;marquee.hidden=true;suppressUntil=performance.now()+250;e.preventDefault();e.stopPropagation();const l=Math.min(s.x,e.clientX),t=Math.min(s.y,e.clientY),r=Math.max(s.x,e.clientX),b=Math.max(s.y,e.clientY);const found=pickRect({left:l,top:t,right:r,bottom:b,width:r-l,height:b-t});if(found)choose(found);}

  function textNode(el){if(!el)return null;if(el.childElementCount===0&&String(el.textContent||'').trim())return el;if(el.matches('section,article,div'))return el.querySelector(':scope > h1,:scope > h2,:scope > h3,:scope > .section-heading h2,:scope > .page-heading h1,:scope > .panel-head h2');return null;}
  function startEdit(el){el=textNode(el)||el;if(!el||el.childElementCount>0)return toast('Double-click a specific heading or text to edit it','warn');finishEdit(false);choose(el);rememberHtml(el);editing={el,before:el.textContent};el.contentEditable='true';el.classList.add('dev21-inline-edit');el.focus();const s=window.getSelection(),r=document.createRange();r.selectNodeContents(el);s.removeAllRanges();s.addRange(r);}
  function finishEdit(save=true){if(!editing)return;const {el,before}=editing,newText=el.textContent;el.removeAttribute('contenteditable');el.classList.remove('dev21-inline-edit');editing=null;if(htmlBase.has(el)){el.innerHTML=htmlBase.get(el);htmlBase.delete(el);}if(save&&newText!==before)setText(el,newText);}

  function input(labelText,type,value,onChange,options=[]){const row=document.createElement('label');row.className='dev21-field';const s=document.createElement('span');s.textContent=labelText;row.appendChild(s);let el;if(type==='select'){el=document.createElement('select');for(const [v,t] of options){const o=document.createElement('option');o.value=v;o.textContent=t;el.appendChild(o);}}else if(type==='textarea'){el=document.createElement('textarea');}else{el=document.createElement('input');el.type=type;}el.value=value??'';el.addEventListener(type==='color'||type==='range'?'input':'change',()=>onChange(el.value));row.appendChild(el);return row;}
  function group(title){const g=document.createElement('section');g.className='dev21-group';const h=document.createElement('h4');h.textContent=title;g.appendChild(h);return g;}
  function action(text,fn,cls=''){const b=document.createElement('button');b.type='button';b.textContent=text;b.className=cls;b.onclick=fn;return b;}
  function hex(v){if(/^#[0-9a-f]{6}$/i.test(v||''))return v;const m=String(v||'').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);if(!m)return'#ffffff';return'#'+[m[1],m[2],m[3]].map(n=>Number(n).toString(16).padStart(2,'0')).join('');}
  const icons=['plane','train','car','bus','ship','hotel','bed','house','building','utensils','mug-hot','cart-shopping','basket-shopping','gas-pump','square-parking','location-dot','map','map-location-dot','earth-europe','suitcase','passport','ticket','receipt','wallet','credit-card','euro-sign','coins','piggy-bank','chart-line','chart-pie','calendar','clock','bell','heart','star','bookmark','flag','check','xmark','plus','minus','arrow-right','arrow-left','arrow-up','arrow-down','up-right-from-square','pen','trash','copy','clone','layer-group','grip','arrows-up-down-left-right','palette','droplet','font','text-height','border-all','wand-magic-sparkles','gear','sliders','lock','unlock','eye','eye-slash','circle-info','circle-question','camera','image','music','gift','briefcase','laptop','mobile-screen'];
  function iconTarget(){if(!selected)return null;if(selected.matches('i,.pick-icon,.brand-mark,.identity-heart,.question-icon')||(selected.childElementCount===0&&selected.textContent.trim().length<=4))return selected;return selected.querySelector('i,.pick-icon,.brand-mark,.identity-heart,.question-icon');}
  function icon(name){const t=iconTarget();if(!t)return toast('Select an icon or small symbol first','warn');setHtml(t,`<i class="fa-solid fa-${name}" aria-hidden="true"></i>`);}

  function renderInspector(){
    if(!inspector)return;
    const panel=$('.dev21-panel',inspector);panel.replaceChildren();
    $$('.dev21-tabs button',inspector).forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
    $('.dev21-inspector-head h3',inspector).textContent=selected?label(selected):'DEV editor';
    $('.dev21-inspector-head p',inspector).textContent=selected?'Drag MOVE to reorder. Left/right drops create a temporary two-column layout.':'Drag-select a section · double-click text · right-click for tools.';
    if(!selected){const g=group('DEV controls');const p=document.createElement('p');p.style.cssText='font-size:12px;line-height:1.55;color:#786765;margin:0';p.textContent='Single left-click remains normal. Drag a rectangle to select. Double-click text to edit it. Right-click anything for style, layout, icons, duplicate, hide and more.';g.appendChild(p);panel.appendChild(g);return;}
    const cs=getComputedStyle(selected), p=patches[selectedKey]||{style:{}};
    if(tab==='style'){
      const t=textNode(selected);if(t){const g=group('Title / text');g.appendChild(input('Text','textarea',t.textContent,v=>setText(t,v)));panel.appendChild(g);}
      const g=group('Typography');
      g.append(input('Font','select',cs.fontFamily.split(',')[0].replace(/["']/g,''),v=>setStyle('font-family',v),[['Crimson Pro','Crimson Pro'],['Georgia','Georgia'],['Playfair Display','Playfair Display'],['Inter','Inter'],['Arial','Arial'],['monospace','Monospace']]));
      g.append(input('Size','number',parseFloat(cs.fontSize)||16,v=>setStyle('font-size',Math.max(7,Number(v)||16)+'px')));
      g.append(input('Weight','select',cs.fontWeight,v=>setStyle('font-weight',v),[['300','Light'],['400','Regular'],['500','Medium'],['600','Semibold'],['700','Bold'],['800','Heavy']]));
      g.append(input('Align','select',cs.textAlign,v=>setStyle('text-align',v),[['left','Left'],['center','Center'],['right','Right']]));panel.appendChild(g);
      const c=group('Colour & surface');c.append(input('Text','color',hex(cs.color),v=>setStyle('color',v)));c.append(input('Background','color',hex(cs.backgroundColor),v=>setStyle('background-color',v)));c.append(input('Border','color',hex(cs.borderColor),v=>setStyle('border-color',v)));c.append(input('Opacity','range',Math.round((Number(cs.opacity)||1)*100),v=>setStyle('opacity',String(Number(v)/100))));panel.appendChild(c);
      const q=group('Quick finish'),a=document.createElement('div');a.className='dev21-actions';a.append(action('Soft shadow',()=>setStyle('box-shadow','0 14px 36px rgba(55,38,28,.12)')),action('Deep shadow',()=>setStyle('box-shadow','0 24px 64px rgba(46,31,31,.20)')),action('No shadow',()=>setStyle('box-shadow','none')),action('Thin border',()=>setStyle('border','1px solid #dfd3c6')));q.appendChild(a);panel.appendChild(q);
    }else if(tab==='layout'){
      const g=group('Size & spacing');g.append(input('Width','text',p.style?.width||selected.style.width||'',v=>setStyle('width',v||'auto')));g.append(input('Height','text',p.style?.height||selected.style.height||'',v=>setStyle('height',v||'auto')));g.append(input('Max width','text',p.style?.['max-width']||selected.style.maxWidth||'',v=>setStyle('max-width',v||'none')));g.append(input('Padding','number',parseFloat(cs.padding)||0,v=>setStyle('padding',Math.max(0,Number(v)||0)+'px')));g.append(input('Margin','number',parseFloat(cs.margin)||0,v=>setStyle('margin',(Number(v)||0)+'px')));g.append(input('Radius','number',parseFloat(cs.borderRadius)||0,v=>setStyle('border-radius',Math.max(0,Number(v)||0)+'px')));panel.appendChild(g);
      const f=group('Layout');f.append(input('Display','select',cs.display,v=>setStyle('display',v),[['block','Block'],['flex','Flex'],['grid','Grid'],['inline-block','Inline block'],['inline','Inline']]));f.append(input('Gap','text',p.style?.gap||cs.gap||'',v=>setStyle('gap',v)));f.append(input('Columns','text',p.style?.['grid-template-columns']||'',v=>setStyle('grid-template-columns',v)));f.append(input('Align items','select',cs.alignItems,v=>setStyle('align-items',v),[['stretch','Stretch'],['start','Start'],['center','Center'],['end','End']]));panel.appendChild(f);
      const m=group('Position');m.append(input('X offset','number',parseFloat(p.style?.['--dev21-x'])||0,v=>{const x=Number(v)||0,y=parseFloat(p.style?.['--dev21-y'])||0;setStyles({'--dev21-x':x,'transform':`translate(${x}px,${y}px)`});}));m.append(input('Y offset','number',parseFloat(p.style?.['--dev21-y'])||0,v=>{const y=Number(v)||0,x=parseFloat(p.style?.['--dev21-x'])||0;setStyles({'--dev21-y':y,'transform':`translate(${x}px,${y}px)`});}));m.append(input('Z-index','number',p.style?.['z-index']||cs.zIndex||0,v=>setStyle('z-index',String(Number(v)||0))));panel.appendChild(m);
      const q=group('Arrange'),a=document.createElement('div');a.className='dev21-actions';a.append(action('Duplicate',duplicate),action('Hide in DEV',hide,'danger'),action('Reset this',resetOne),action('Bring front',()=>setStyle('z-index','999')));q.appendChild(a);panel.appendChild(q);
    }else if(tab==='icons'){
      const g=group('Font Awesome icon library'),search=document.createElement('input'),grid=document.createElement('div');search.className='dev21-icon-search';search.placeholder='Search icons…';grid.className='dev21-icon-grid';const draw=q=>{grid.replaceChildren();icons.filter(n=>n.includes((q||'').toLowerCase())).forEach(name=>{const b=document.createElement('button');b.type='button';b.title=name;b.innerHTML=`<i class="fa-solid fa-${name}"></i><small>${name}</small>`;b.onclick=()=>icon(name);grid.appendChild(b);});};search.oninput=()=>draw(search.value);draw('');g.append(search,grid);panel.appendChild(g);
    }else{
      const g=group('Advanced transform');
      g.append(input('Scale','number',parseFloat(p.style?.scale)||1,v=>setStyle('scale',String(Math.max(.1,Math.min(5,Number(v)||1))))));
      g.append(input('Rotate','number',parseFloat(p.style?.rotate)||0,v=>setStyle('rotate',(Number(v)||0)+'deg')));
      g.append(input('Letter spacing','text',p.style?.['letter-spacing']||cs.letterSpacing||'',v=>setStyle('letter-spacing',v)));
      g.append(input('Line height','text',p.style?.['line-height']||cs.lineHeight||'',v=>setStyle('line-height',v)));panel.appendChild(g);
      const custom=group('Any CSS property');let prop='',value='';custom.append(input('Property','text','',v=>{prop=v.trim();}));custom.append(input('Value','text','',v=>{value=v;}));const a=document.createElement('div');a.className='dev21-actions';a.append(action('Apply',()=>{if(prop)setStyle(prop,value);}),action('Copy style',async()=>{copiedStyle=copy(p.style||{});try{await navigator.clipboard.writeText(Object.entries(copiedStyle).map(([k,v])=>`${k}: ${v};`).join('\n'));}catch{}toast('DEV style copied');}),action('Paste style',()=>{if(copiedStyle)setStyles(copiedStyle);}),action('Reset element',resetOne));custom.appendChild(a);panel.appendChild(custom);
    }
  }

  function resetOne(){if(!selectedKey)return;mutate(()=>{delete patches[selectedKey];});}
  function hide(){if(!selectedKey)return;mutate(()=>{patch(selectedKey).hidden=true;});clear();}
  function cleanClone(el){const c=el.cloneNode(true);for(const n of [c,...c.querySelectorAll('*')]){n.removeAttribute?.('id');for(const a of [...(n.attributes||[])])if(/^data-(current|open-trip|wish-index|fin-month)/.test(a.name))n.removeAttribute(a.name);}return c.outerHTML;}
  function duplicate(){if(!selected)return;const id=crypto.randomUUID?.()||'dup'+Date.now(),key=`[data-dev21-added="${esc(id)}"]`;mutate(()=>{patches[key]={add:true,id,parent:selector(selected.parentElement),after:selectedKey,html:cleanClone(selected),style:{}};});toast('Duplicated in DEV only');}
  function add(kind){const parent=selected?.parentElement||$('.sheet.active')||$('main');if(!parent)return;const id=crypto.randomUUID?.()||'add'+Date.now(),key=`[data-dev21-added="${esc(id)}"]`,html=kind==='section'?'<section class="dev21-added"><h2>New test section</h2></section>':'<div class="dev21-added"><span>New test text</span></div>';mutate(()=>{patches[key]={add:true,id,parent:selector(parent),after:selectedKey,html,style:{}};});}

  async function deleteReal(){const trip=selected?.closest('[data-open-trip],[data-current-trip]'),month=selected?.closest('[data-fin-month]'),wish=selected?.closest('tr')?.querySelector('[data-wish-index]');if(!trip&&!month&&!wish)return toast('No supported real delete action for this item','warn');if(!confirm('Delete the REAL saved data permanently?'))return;try{if(trip){await window.TwogetherAPI.post('deleteTrip',{id:trip.dataset.openTrip||trip.dataset.currentTrip},actor());await window.TwogetherV18?.refresh(true);}else if(month){await window.TwogetherAPI.post('deleteFinanceMonth',{month:month.dataset.finMonth},actor());document.dispatchEvent(new CustomEvent('twogether:finance-view',{detail:{view:'monthly'}}));}else{wish.click();setTimeout(()=>$('#wishlistMiniBody [data-wish-delete]')?.click(),40);}toast('Deleted');}catch(e){toast(e.message||'Could not delete','warn');}}

  function openInspector(nextTab){tab=nextTab||tab;inspector.hidden=false;renderInspector();}
  function openContext(e,el){choose(el);context.replaceChildren();const addItem=(iconName,text,fn,cls='')=>{const b=document.createElement('button');b.type='button';b.className=cls;b.innerHTML=`<span class="ctx-icon"><i class="fa-solid fa-${iconName}"></i></span>${text}`;b.onclick=()=>{context.hidden=true;fn();};context.appendChild(b);};addItem('pen','Edit title / text',()=>{const t=textNode(selected);t?startEdit(t):openInspector('style');});addItem('palette','Style & colours',()=>openInspector('style'));addItem('arrows-up-down-left-right','Layout & position',()=>openInspector('layout'));addItem('icons','Change icon',()=>openInspector('icons'));addItem('clone','Duplicate whole selection',duplicate);addItem('grip','Move / reorder',()=>toast('Drag the MOVE handle above the selection, then drop left/right/above/below another block.'));context.appendChild(document.createElement('hr'));addItem('font','Add text after',()=>add('text'));addItem('layer-group','Add section after',()=>add('section'));addItem('eye-slash','Hide in DEV',hide);addItem('rotate-left','Reset selected',resetOne);if(selected.closest('[data-open-trip],[data-current-trip],[data-fin-month]')||selected.closest('tr')?.querySelector('[data-wish-index]')){context.appendChild(document.createElement('hr'));addItem('trash','Delete REAL saved item…',deleteReal,'danger');}context.hidden=false;const w=235,h=Math.min(430,context.scrollHeight||360);context.style.left=Math.max(8,Math.min(innerWidth-w-8,e.clientX))+'px';context.style.top=Math.max(8,Math.min(innerHeight-h-8,e.clientY))+'px';}

  function targetAt(x,y){const raw=document.elementFromPoint(x,y);if(!raw||ignore(raw))return null;const semantic=raw.closest('section,article,.panel,.wizard-card,.tw-current-card,.trip-gallery-section,.finance-subview,.hero-grid,.table-card');if(semantic&&semantic!==selected&&!selected?.contains(semantic))return semantic;const div=raw.closest('div');return div&&div!==selected&&!selected?.contains(div)?div:null;}
  function mode(target,x,y){const r=target.getBoundingClientRect(),rx=(x-r.left)/Math.max(1,r.width),ry=(y-r.top)/Math.max(1,r.height);if(rx<.25)return'left';if(rx>.75)return'right';return ry<.5?'before':'after';}
  function showDrop(target,m){if(!target){drop.hidden=true;return;}const r=target.getBoundingClientRect();drop.hidden=false;Object.assign(drop.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});$('span',drop).textContent=m==='left'?'Place left':m==='right'?'Place right':m==='before'?'Place above':'Place below';}
  function moveDown(e){if(!selected)return;e.preventDefault();e.stopPropagation();moveState={id:e.pointerId,target:null,mode:null};e.currentTarget.setPointerCapture?.(e.pointerId);}
  function moveMove(e){if(!moveState||e.pointerId!==moveState.id)return;e.preventDefault();const t=targetAt(e.clientX,e.clientY),m=t?mode(t,e.clientX,e.clientY):null;moveState.target=t;moveState.mode=m;showDrop(t,m);}
  function moveUp(e){if(!moveState||e.pointerId!==moveState.id)return;const s=moveState;moveState=null;drop.hidden=true;if(!s.target||!s.mode)return;mutate(()=>{patch(selectedKey).placement={mode:s.mode,target:selector(s.target)};});}

  function loadIcons(){if($('#twDevFontAwesome'))return;const l=document.createElement('link');l.id='twDevFontAwesome';l.rel='stylesheet';l.href='https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css';document.head.appendChild(l);}
  function install(){if(selection)return;selection=document.createElement('div');selection.className='dev21-selection';selection.hidden=true;selection.innerHTML='<span class="dev21-selection-label"></span><button type="button" class="dev21-drag-handle">MOVE</button>';document.body.appendChild(selection);marquee=document.createElement('div');marquee.className='dev21-marquee';marquee.hidden=true;document.body.appendChild(marquee);drop=document.createElement('div');drop.className='dev21-drop';drop.hidden=true;drop.innerHTML='<span></span>';document.body.appendChild(drop);context=document.createElement('div');context.className='dev21-context';context.hidden=true;document.body.appendChild(context);inspector=document.createElement('aside');inspector.className='dev21-inspector';inspector.hidden=true;inspector.innerHTML='<div class="dev21-inspector-head"><div><h3>DEV editor</h3><p></p></div><button type="button">×</button></div><div class="dev21-tabs"><button type="button" data-tab="style">Style</button><button type="button" data-tab="layout">Layout</button><button type="button" data-tab="icons">Icons</button><button type="button" data-tab="advanced">Advanced</button></div><div class="dev21-panel"></div>';document.body.appendChild(inspector);toolbar=document.createElement('div');toolbar.className='dev21-toolbar';toolbar.hidden=true;toolbar.innerHTML='<button type="button" data-u>Undo</button><button type="button" data-r>Redo</button><button type="button" data-reset>Reset</button><button type="button" data-add>+ Text</button><button type="button" class="dev21-exit" data-exit>Exit DEV</button>';document.body.appendChild(toolbar);const handle=$('.dev21-drag-handle',selection);handle.addEventListener('pointerdown',moveDown);handle.addEventListener('pointermove',moveMove);handle.addEventListener('pointerup',moveUp);$('.dev21-inspector-head button',inspector).onclick=()=>inspector.hidden=true;$$('.dev21-tabs button',inspector).forEach(b=>b.onclick=()=>{tab=b.dataset.tab;renderInspector();});$('[data-u]',toolbar).onclick=undo;$('[data-r]',toolbar).onclick=redo;$('[data-reset]',toolbar).onclick=()=>{if(confirm('Reset the entire DEV playground? You can undo it.'))reset();};$('[data-add]',toolbar).onclick=()=>add('text');$('[data-exit]',toolbar).onclick=exit;}

  function enter(){if(active||!actor())return;loadIcons();install();active=true;document.body.classList.add('dev-playground','dev-v21');document.body.classList.remove('dev-v19');toolbar.hidden=false;applyPatches();renderInspector();refreshSelection();emit();toast('DEV: drag-select sections · double-click text · right-click for tools');}
  function exit(){if(!active)return;finishEdit(true);restoreSession();active=false;selected=null;selectedKey='';document.body.classList.remove('dev-playground','dev-v21','dev-v19');selection.hidden=true;marquee.hidden=true;drop.hidden=true;context.hidden=true;inspector.hidden=true;toolbar.hidden=true;emit();}

  document.addEventListener('pointerdown',marqueeDown,true);
  document.addEventListener('pointermove',marqueeMove,{capture:true,passive:false});
  document.addEventListener('pointerup',marqueeUp,true);
  document.addEventListener('click',e=>{if(active&&performance.now()<suppressUntil){e.preventDefault();e.stopImmediatePropagation();}},true);
  document.addEventListener('dblclick',e=>{if(!active||ignore(e.target))return;const t=textNode(e.target);if(!t)return;e.preventDefault();e.stopImmediatePropagation();startEdit(t);},true);
  document.addEventListener('contextmenu',e=>{if(!active||ignore(e.target))return;e.preventDefault();e.stopImmediatePropagation();openContext(e,e.target);},true);
  document.addEventListener('click',e=>{if(active&&!e.target.closest('.dev21-context')&&context)context.hidden=true;},true);
  document.addEventListener('focusout',e=>{if(editing?.el===e.target)setTimeout(()=>finishEdit(true),0);},true);
  document.addEventListener('keydown',e=>{if(!active)return;if(editing){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();finishEdit(true);}else if(e.key==='Escape'){e.preventDefault();finishEdit(false);}return;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();return;}if(selected&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&!e.target.matches('input,textarea,select')){e.preventDefault();const step=e.shiftKey?10:1,p=patches[selectedKey]||{style:{}},x=parseFloat(p.style?.['--dev21-x'])||0,y=parseFloat(p.style?.['--dev21-y'])||0,nx=x+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),ny=y+(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0);setStyles({'--dev21-x':nx,'--dev21-y':ny,transform:`translate(${nx}px,${ny}px)`});}},true);
  window.addEventListener('scroll',()=>{if(active){refreshSelection();context.hidden=true;}},{passive:true});window.addEventListener('resize',()=>active&&refreshSelection(),{passive:true});
  document.addEventListener('twogether:v18-rendered',()=>{if(!active)return;setTimeout(()=>{restoreSession();applyPatches();refreshSelection();},30);});
  document.addEventListener('DOMContentLoaded',()=>{install();new MutationObserver(()=>{if(active)setTimeout(()=>{applyPatches();refreshSelection();},60);}).observe(document.body,{childList:true,subtree:true});});

  window.__TWOGETHER_USE_V21_DEV__=true;
  window.TwogetherDevV18={enter,exit,undo,redo,reset,get active(){return active;},get selected(){return null;}};
  window.TwogetherDevV21={enter,exit,undo,redo,reset,get active(){return active;},get selected(){return selected;}};
})();
