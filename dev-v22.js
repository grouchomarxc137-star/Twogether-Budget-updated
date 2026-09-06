(() => {
  'use strict';
  const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
  const KEY='twogether_dev_playground_v22';
  const ACTORS=['Principessa','Principe'];
  const copy=v=>JSON.parse(JSON.stringify(v));
  let active=false,selected=null,selectedKey='',editing=null,tab='style';
  let ui={},marqueeState=null,moveState=null,resizeState=null,drawState=null,noteBoxState=null,suppressUntil=0;
  let state={patches:{},annotations:[],notes:[]},past=[],future=[];
  const styleBase=new Map(),htmlBase=new Map(),posBase=new Map();
  try{const s=JSON.parse(localStorage.getItem(KEY)||'{}');if(s.state)state=s.state;past=s.past||[];future=s.future||[];}catch{}

  const PHOSPHOR='https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.1/src/regular/style.css';
  const phIcons=[
    ['heart','Heart'],['heart-straight','Soft heart'],['sparkle','Sparkle'],['star-four','Four-point star'],['flower','Flower'],['butterfly','Butterfly'],['paw-print','Paw'],['crown','Crown'],['diamond','Diamond'],['moon-stars','Moon & stars'],['sun','Sun'],['cloud-sun','Cloud sun'],['confetti','Confetti'],['balloon','Balloon'],['gift','Gift'],['cake','Cake'],['coffee','Coffee'],['ice-cream','Ice cream'],['pizza','Pizza'],['fork-knife','Food'],
    ['airplane-tilt','Flight'],['train','Train'],['car','Car'],['bus','Bus'],['boat','Boat'],['suitcase-rolling','Suitcase'],['map-pin','Map pin'],['map-trifold','Map'],['globe-hemisphere-west','Globe'],['compass','Compass'],['camera','Camera'],['image','Image'],['ticket','Ticket'],['passport','Passport'],['bed','Bed'],['house','House'],['house-heart','Home heart'],
    ['wallet','Wallet'],['credit-card','Card'],['currency-eur','Euro'],['coins','Coins'],['piggy-bank','Piggy bank'],['receipt','Receipt'],['shopping-bag-open','Shopping bag'],['basket','Basket'],['shopping-cart','Cart'],['chart-line-up','Chart'],['calculator','Calculator'],
    ['pencil-simple','Edit'],['pen-nib','Pen'],['highlighter','Highlighter'],['text-t','Text'],['palette','Palette'],['eyedropper','Eyedropper'],['sliders-horizontal','Controls'],['gear-six','Settings'],['dots-three','More'],['copy','Copy'],['duplicate','Duplicate'],['trash','Trash'],['eye','Show'],['eye-slash','Hide'],['lock','Lock'],['lock-open','Unlock'],['arrows-out-cardinal','Move'],['arrows-clockwise','Rotate'],['bounding-box','Resize'],['columns','Columns'],['rows','Rows'],['grid-four','Grid'],['stack','Layers'],['selection','Select'],['square-half','Split'],
    ['check-circle','Done'],['x-circle','Close'],['plus-circle','Add'],['minus-circle','Remove'],['arrow-right','Right'],['arrow-left','Left'],['arrow-up','Up'],['arrow-down','Down'],['arrow-square-out','Open'],['info','Info'],['question','Question'],['bell','Bell'],['bookmark-simple','Bookmark'],['flag','Flag'],['calendar-blank','Calendar'],['clock','Clock'],['music-note','Music'],['laptop','Laptop'],['device-mobile','Mobile']
  ];
  const cuteEmoji=['♡','♥','✦','✧','★','☆','✿','❀','❁','☾','☼','☁','☕','🎀','🌷','🌸','🌼','🪻','🍓','🍒','🍰','🧁','🍨','🥐','🫶','💌','💗','💖','💕','💫','✨','🌙','🪄','🎁','🧳','✈️','🚆','🏡','🗺️','📍','💶','🪙','🛍️','🧸','📷','🎵','🪴','🕯️','📎','✎','✓','→','↗'];

  function actor(){const a=document.body.dataset.actor||localStorage.getItem('twogether_actor_v1')||'';return ACTORS.includes(a)?a:'';}
  function esc(v){return window.CSS?.escape?CSS.escape(String(v)):String(v).replace(/[^a-zA-Z0-9_-]/g,'\\$&');}
  function selector(el){
    if(!el)return'';if(el===document.body)return'body';if(el.id)return'#'+esc(el.id);
    for(const a of ['data-current-plan','data-current-trip','data-open-trip','data-fin-month','data-fin-view','data-sheet','data-wish-index','data-dev22-added'])if(el.hasAttribute?.(a))return`[${a}="${esc(el.getAttribute(a))}"]`;
    const p=el.parentElement;if(!p)return'';const ps=selector(p);if(!ps)return'';const same=[...p.children].filter(x=>x.tagName===el.tagName);return`${ps} > ${el.tagName.toLowerCase()}:nth-of-type(${same.indexOf(el)+1})`;
  }
  function resolve(key){try{return document.querySelector(key);}catch{return null;}}
  function persist(){try{localStorage.setItem(KEY,JSON.stringify({state,past:past.slice(-80),future:future.slice(-80)}));}catch{}}
  function toast(msg,tone='ok'){const el=$('#toast');if(!el)return;el.textContent=msg;el.className='toast show '+tone;clearTimeout(el._dev22);el._dev22=setTimeout(()=>el.className='toast',2500);}
  function emit(){document.dispatchEvent(new CustomEvent('twogether:dev-changed'));}
  function rememberStyle(el){if(el&&!styleBase.has(el))styleBase.set(el,el.getAttribute('style'));}
  function rememberHtml(el){if(el&&!htmlBase.has(el))htmlBase.set(el,el.innerHTML);}
  function rememberPos(el){if(el&&!posBase.has(el))posBase.set(el,{parent:el.parentNode,next:el.nextSibling});}
  function snapshot(){return copy(state);}
  function pushHistory(){past.push(snapshot());past=past.slice(-80);future=[];}
  function patch(key){if(!state.patches[key])state.patches[key]={style:{}};if(!state.patches[key].style)state.patches[key].style={};return state.patches[key];}

  function restoreSession(){
    finishEdit(false);
    for(const [el,p] of [...posBase.entries()].reverse()){
      if(!el?.isConnected||!p.parent?.isConnected)continue;
      if(p.next&&p.next.parentNode===p.parent)p.parent.insertBefore(el,p.next);else p.parent.appendChild(el);
    }
    posBase.clear();
    for(const [el,s] of styleBase)if(el?.isConnected){if(s==null)el.removeAttribute('style');else el.setAttribute('style',s);}styleBase.clear();
    for(const [el,h] of htmlBase)if(el?.isConnected)el.innerHTML=h;htmlBase.clear();
    $$('[data-dev22-added]').forEach(x=>x.remove());
    $('.dev22-origin-ghost')?.remove();
  }

  function applyState(){
    if(!active)return;
    for(const [key,p] of Object.entries(state.patches)){
      if(!p.add||resolve(key))continue;
      const parent=resolve(p.parent)||$('.sheet.active')||$('main')||document.body;
      const t=document.createElement('template');t.innerHTML=String(p.html||'<div>DEV block</div>').trim();const el=t.content.firstElementChild||document.createElement('div');el.dataset.dev22Added=p.id;parent.appendChild(el);
    }
    for(const [key,p] of Object.entries(state.patches)){
      const el=resolve(key);if(!el)continue;rememberStyle(el);
      if(p.text!==undefined){rememberHtml(el);el.textContent=p.text;}
      if(p.html!==undefined){rememberHtml(el);el.innerHTML=p.html;}
      Object.entries(p.style||{}).forEach(([k,v])=>el.style.setProperty(k,String(v)));
      if(p.hidden)el.style.setProperty('display','none','important');
      if(p.free){
        rememberPos(el);const body=document.body;body.appendChild(el);el.style.position='absolute';el.style.left=Number(p.free.x||0)+'px';el.style.top=Number(p.free.y||0)+'px';if(p.free.width)el.style.width=Number(p.free.width)+'px';if(p.free.height)el.style.height=Number(p.free.height)+'px';el.style.margin='0';el.style.zIndex=String(p.free.z||22000);
      }
    }
    renderNotes();renderAnnotations();refreshSelection();
  }
  function mutate(fn,msg){pushHistory();restoreSession();fn();persist();applyState();renderInspector();emit();if(msg)toast(msg);}
  function undo(){if(!past.length)return;restoreSession();future.push(snapshot());state=past.pop();persist();applyState();renderInspector();emit();}
  function redo(){if(!future.length)return;restoreSession();past.push(snapshot());state=future.pop();persist();applyState();renderInspector();emit();}
  function reset(){mutate(()=>{state={patches:{},annotations:[],notes:[]};},'DEV reset — Undo restores it');}
  function setStyle(name,value,key=selectedKey){if(!key)return;mutate(()=>{const p=patch(key);if(value===''||value==null)delete p.style[name];else p.style[name]=String(value);});}
  function setStyles(values,key=selectedKey){if(!key)return;mutate(()=>Object.assign(patch(key).style,values));}
  function setText(el,text){const key=selector(el);if(!key)return;mutate(()=>{const p=patch(key);p.text=String(text);delete p.html;});}
  function setHtml(el,html){const key=selector(el);if(!key)return;mutate(()=>{const p=patch(key);p.html=String(html);delete p.text;});}

  function ignore(el){return !el||el===document.documentElement||el.closest?.('.dev22-context,.dev22-inspector,.dev22-toolbar,.dev22-selection,.dev22-marquee,.dev22-canvas,.dev22-note,.identity-modal');}
  function label(el){if(!el)return'Nothing selected';const h=el.matches?.('h1,h2,h3,h4')?el:el.querySelector?.(':scope > h1,:scope > h2,:scope > h3,:scope > .section-heading h2,:scope > .page-heading h1');const t=(h?.textContent||'').trim();return t||(el.id?'#'+el.id:'')||(el.classList?.[0]?'.'+el.classList[0]:el.tagName?.toLowerCase()||'element');}
  function choose(el){if(ignore(el))return;selected=el;selectedKey=selector(el);refreshSelection();renderInspector();}
  function clearSelection(){selected=null;selectedKey='';if(ui.selection)ui.selection.hidden=true;renderInspector();}
  function refreshSelection(){
    if(!active||!ui.selection)return;
    if(selectedKey&&!selected?.isConnected)selected=resolve(selectedKey);
    if(!selected?.isConnected){ui.selection.hidden=true;return;}
    const r=selected.getBoundingClientRect();if(!r.width||!r.height){ui.selection.hidden=true;return;}
    ui.selection.hidden=false;Object.assign(ui.selection.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});$('.dev22-selection-label',ui.selection).textContent=label(selected);
  }

  function selectable(){return $$('section,article,main,.main,.sheet.active,.hero-grid,.wizard-card,.panel,.table-card,.compare-zone,.finance-subview,.trip-gallery-section,.tw-current-trips-section,.tw-current-list,.trip-gallery,.wishlist-wrap,.wishlist-table-wrap,.finance-grid,.kpis,.tw-current-card,.wishlist-table,.wishlist-table tbody,.wishlist-table tbody tr,.section-heading,.page-heading').filter(x=>x.getClientRects().length&&!ignore(x));}
  function overlap(a,b){const l=Math.max(a.left,b.left),t=Math.max(a.top,b.top),r=Math.min(a.right,b.right),bt=Math.min(a.bottom,b.bottom);return Math.max(0,r-l)*Math.max(0,bt-t);}
  function pickRect(r){const area=Math.max(1,r.width*r.height);let best=null,score=-Infinity;for(const el of selectable()){const e=el.getBoundingClientRect(),ea=Math.max(1,e.width*e.height),hit=overlap(r,e);if(hit<Math.min(120,area*.1))continue;let s=(hit/area)*.44+(hit/ea)*.56;if(el.matches('section,article,[id],.tw-current-card,.wizard-card,.wishlist-wrap'))s+=.15;if(ea>area*12)s-=.35;if(s>score){best=el;score=s;}}return best;}
  function marqueeDown(e){if(!active||currentDrawTool()!=='select'||e.button!==0||e.target.closest?.('.dev22-move-handle,.dev22-resize-handle,.dev22-context,.dev22-inspector,.dev22-toolbar,input,textarea,select,[contenteditable="true"],button,a'))return;marqueeState={x:e.clientX,y:e.clientY,id:e.pointerId,drag:false};}
  function marqueeMove(e){if(!marqueeState||e.pointerId!==marqueeState.id)return;const dx=e.clientX-marqueeState.x,dy=e.clientY-marqueeState.y;if(!marqueeState.drag&&Math.hypot(dx,dy)<8)return;marqueeState.drag=true;e.preventDefault();const l=Math.min(marqueeState.x,e.clientX),t=Math.min(marqueeState.y,e.clientY);ui.marquee.hidden=false;Object.assign(ui.marquee.style,{left:l+'px',top:t+'px',width:Math.abs(dx)+'px',height:Math.abs(dy)+'px'});}
  function marqueeUp(e){if(!marqueeState||e.pointerId!==marqueeState.id)return;const s=marqueeState;marqueeState=null;if(!s.drag)return;ui.marquee.hidden=true;suppressUntil=performance.now()+220;e.preventDefault();e.stopPropagation();const l=Math.min(s.x,e.clientX),t=Math.min(s.y,e.clientY),r=Math.max(s.x,e.clientX),b=Math.max(s.y,e.clientY);const found=pickRect({left:l,top:t,right:r,bottom:b,width:r-l,height:b-t});if(found)choose(found);}

  function textNode(el){if(!el)return null;if(el.childElementCount===0&&String(el.textContent||'').trim())return el;if(el.matches('section,article,div'))return el.querySelector(':scope > h1,:scope > h2,:scope > h3,:scope > p,:scope > .section-heading h2,:scope > .page-heading h1,:scope > .panel-head h2');return null;}
  function startEdit(el){el=textNode(el)||el;if(!el||el.childElementCount>0)return toast('Double-click a specific text or heading','warn');finishEdit(false);choose(el);rememberHtml(el);editing={el,before:el.textContent};el.contentEditable='true';el.classList.add('dev21-inline-edit');el.focus();const s=window.getSelection(),r=document.createRange();r.selectNodeContents(el);s.removeAllRanges();s.addRange(r);}
  function finishEdit(save=true){if(!editing)return;const {el,before}=editing,newText=el.textContent;el.removeAttribute('contenteditable');el.classList.remove('dev21-inline-edit');editing=null;if(htmlBase.has(el)){el.innerHTML=htmlBase.get(el);htmlBase.delete(el);}if(save&&newText!==before)setText(el,newText);}

  function beginMove(e){
    if(!selected||e.button!==0)return;e.preventDefault();e.stopPropagation();finishEdit(true);
    const r=selected.getBoundingClientRect();rememberStyle(selected);rememberPos(selected);
    const ghost=document.createElement('div');ghost.className='dev22-origin-ghost';Object.assign(ghost.style,{left:(r.left+scrollX)+'px',top:(r.top+scrollY)+'px',width:r.width+'px',height:r.height+'px'});document.body.appendChild(ghost);
    document.body.appendChild(selected);selected.classList.add('dev22-dragging');Object.assign(selected.style,{position:'absolute',left:(r.left+scrollX)+'px',top:(r.top+scrollY)+'px',width:r.width+'px',margin:'0',zIndex:'29970'});
    moveState={id:e.pointerId,offsetX:e.pageX-(r.left+scrollX),offsetY:e.pageY-(r.top+scrollY),width:r.width,height:r.height};
  }
  function movePointer(e){
    if(!moveState||e.pointerId!==moveState.id)return;e.preventDefault();
    const x=Math.max(0,e.pageX-moveState.offsetX),y=Math.max(0,e.pageY-moveState.offsetY);selected.style.left=x+'px';selected.style.top=y+'px';
    const edge=55;if(e.clientY<edge)scrollBy({top:-16,behavior:'auto'});else if(innerHeight-e.clientY<edge)scrollBy({top:16,behavior:'auto'});if(e.clientX<edge)scrollBy({left:-12,behavior:'auto'});else if(innerWidth-e.clientX<edge)scrollBy({left:12,behavior:'auto'});refreshSelection();
  }
  function endMove(e){
    if(!moveState||e.pointerId!==moveState.id)return;const m=moveState;moveState=null;
    const x=parseFloat(selected.style.left)||0,y=parseFloat(selected.style.top)||0,w=selected.getBoundingClientRect().width||m.width,h=selected.getBoundingClientRect().height||m.height;selected.classList.remove('dev22-dragging');$('.dev22-origin-ghost')?.remove();
    pushHistory();restoreSession();const p=patch(selectedKey);p.free={x,y,width:w,height:h,z:22000};persist();applyState();refreshSelection();renderInspector();emit();toast('Free position saved in DEV');
  }

  function beginResize(e,corner){if(!selected||e.button!==0)return;e.preventDefault();e.stopPropagation();const r=selected.getBoundingClientRect();resizeState={id:e.pointerId,corner,startX:e.clientX,startY:e.clientY,width:r.width,height:r.height};rememberStyle(selected);}
  function resizePointer(e){if(!resizeState||e.pointerId!==resizeState.id)return;e.preventDefault();const dx=e.clientX-resizeState.startX,dy=e.clientY-resizeState.startY;let w=resizeState.width+(resizeState.corner.includes('e')?dx:-dx),h=resizeState.height+(resizeState.corner.includes('s')?dy:-dy);w=Math.max(40,w);h=Math.max(24,h);selected.style.width=w+'px';selected.style.height=h+'px';refreshSelection();}
  function endResize(e){if(!resizeState||e.pointerId!==resizeState.id)return;resizeState=null;const r=selected.getBoundingClientRect();setStyles({width:r.width+'px',height:r.height+'px'});}

  function field(labelText,type,value,onChange,options=[]){const row=document.createElement('label');row.className='dev22-field';const s=document.createElement('span');s.textContent=labelText;row.appendChild(s);let el;if(type==='select'){el=document.createElement('select');for(const [v,t] of options){const o=document.createElement('option');o.value=v;o.textContent=t;el.appendChild(o);}}else if(type==='textarea'){el=document.createElement('textarea');}else{el=document.createElement('input');el.type=type;}el.value=value??'';el.addEventListener(type==='color'||type==='range'?'input':'change',()=>onChange(el.value));row.appendChild(el);return row;}
  function group(title){const g=document.createElement('section');g.className='dev22-group';const h=document.createElement('h4');h.textContent=title;g.appendChild(h);return g;}
  function action(text,fn,cls=''){const b=document.createElement('button');b.type='button';b.textContent=text;b.className=cls;b.onclick=fn;return b;}
  function hex(v){if(/^#[0-9a-f]{6}$/i.test(v||''))return v;const m=String(v||'').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);if(!m)return'#ffffff';return'#'+[m[1],m[2],m[3]].map(n=>Number(n).toString(16).padStart(2,'0')).join('');}
  function cssValue(v,fallback=''){return v&&v!=='normal'&&v!=='auto'?v:fallback;}

  function duplicateSelected(){if(!selected||!selected.parentElement)return;const id='add_'+Date.now();const key=`[data-dev22-added="${id}"]`;mutate(()=>{state.patches[key]={add:true,id,parent:selector(selected.parentElement),html:selected.outerHTML.replace(/\sid="[^"]*"/,'').replace(/\sdata-dev22-added="[^"]*"/,'') ,style:{}};},'Duplicated in DEV');}
  function hideSelected(){if(!selectedKey)return;mutate(()=>{patch(selectedKey).hidden=true;},'Hidden in DEV');clearSelection();}
  function resetSelected(){if(!selectedKey)return;mutate(()=>{delete state.patches[selectedKey];},'Element reset');}
  function bringFront(){setStyle('z-index','30000');setStyle('position',getComputedStyle(selected).position==='static'?'relative':getComputedStyle(selected).position);}
  function sendBack(){setStyle('z-index','0');}
  function addBlock(kind='text'){
    const id='add_'+Date.now(),key=`[data-dev22-added="${id}"]`,parent=selector($('.sheet.active')||$('main')||document.body);
    const html=kind==='section'?`<section data-dev22-added="${id}" class="dev21-added"><h2>New DEV section</h2><p>Double-click this text to edit it.</p></section>`:`<div data-dev22-added="${id}" class="dev21-added">Double-click to edit this DEV text box.</div>`;
    mutate(()=>{state.patches[key]={add:true,id,parent,html,style:{position:'absolute',left:(scrollX+innerWidth*.35)+'px',top:(scrollY+innerHeight*.35)+'px',width:kind==='section'?'360px':'250px','z-index':'22000'}};},kind==='section'?'Section added':'Text box added');setTimeout(()=>choose(resolve(key)),20);
  }

  function ensurePhosphor(){if(document.querySelector('link[data-dev22-phosphor]'))return;const l=document.createElement('link');l.rel='stylesheet';l.href=PHOSPHOR;l.dataset.dev22Phosphor='1';document.head.appendChild(l);}
  function iconTarget(){if(!selected)return null;if(selected.matches?.('i,.pick-icon,.brand-mark,.identity-heart,.question-icon,.dev22-inline-icon')||(selected.childElementCount===0&&selected.textContent.trim().length<=4))return selected;return selected.querySelector?.('i,.pick-icon,.brand-mark,.identity-heart,.question-icon,.dev22-inline-icon');}
  function applyIcon(type,value){
    if(!selected)return;ensurePhosphor();let t=iconTarget();
    const markup=type==='ph'?`<i class="ph ph-${value}" aria-hidden="true"></i>`:`<span aria-hidden="true">${value}</span>`;
    if(t){setHtml(t,markup);return;}
    const key=selectedKey;if(!key)return;rememberHtml(selected);const current=(state.patches[key]?.html!==undefined?state.patches[key].html:selected.innerHTML);mutate(()=>{const p=patch(key);p.html=`<span class="dev22-inline-icon" style="display:inline-flex;vertical-align:middle;margin-right:.45em">${markup}</span>${current}`;delete p.text;});
  }

  function renderInspector(){
    if(!ui.inspector)return;const panel=$('.dev22-panel',ui.inspector);panel.replaceChildren();$$('.dev22-tabs button',ui.inspector).forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
    $('.dev22-inspector-head h3',ui.inspector).textContent=selected?label(selected):'DEV playground';$('.dev22-inspector-head p',ui.inspector).textContent=selected?'Move freely with MOVE · resize from corners · right-click for more.':'Drag a rectangle to select · double-click text · single-click works normally.';
    if(!selected){const g=group('How to use');const p=document.createElement('p');p.textContent='Select mode: hold left-click and draw a rectangle around a section. Double-click any text to edit. Once selected, drag MOVE and the real object follows your cursor anywhere on the page. Use Draw tools below for markup notes.';g.appendChild(p);panel.appendChild(g);return;}
    const cs=getComputedStyle(selected),sp=state.patches[selectedKey]?.style||{};
    if(tab==='style'){
      const g=group('Appearance');g.append(field('Text color','color',hex(cs.color),v=>setStyle('color',v)));g.append(field('Background','color',hex(cs.backgroundColor),v=>setStyle('background-color',v)));g.append(field('Opacity','range',Math.round((parseFloat(cs.opacity)||1)*100),v=>setStyle('opacity',String(Number(v)/100))));g.append(field('Radius','text',sp['border-radius']||cssValue(cs.borderRadius),v=>setStyle('border-radius',v)));g.append(field('Border color','color',hex(cs.borderColor),v=>setStyle('border-color',v)));g.append(field('Border width','text',sp['border-width']||cssValue(cs.borderWidth),v=>setStyle('border-width',v)));g.append(field('Border style','select',sp['border-style']||cs.borderStyle,v=>setStyle('border-style',v),[['none','None'],['solid','Solid'],['dashed','Dashed'],['dotted','Dotted'],['double','Double']]));g.append(field('Shadow','select',sp['box-shadow']||'none',v=>setStyle('box-shadow',v),[['none','None'],['0 6px 18px rgba(45,32,22,.08)','Soft'],['0 14px 36px rgba(45,32,22,.14)','Floating'],['0 24px 70px rgba(45,32,22,.22)','Strong'],['inset 0 0 0 1px rgba(130,90,40,.12)','Inset line']]));panel.appendChild(g);
      const page=group('Page / surface');const a=document.createElement('div');a.className='dev22-actions';a.append(action('Use as page background',()=>setStyle('background-color',hex(cs.backgroundColor),'body')));a.append(action('Clear page background',()=>setStyle('background-color','', 'body')));page.appendChild(a);panel.appendChild(page);
    }else if(tab==='layout'){
      const g=group('Size & position');g.append(field('Width','text',sp.width||selected.style.width||cssValue(cs.width),v=>setStyle('width',v)));g.append(field('Height','text',sp.height||selected.style.height||cssValue(cs.height),v=>setStyle('height',v)));g.append(field('Min width','text',sp['min-width']||cssValue(cs.minWidth),v=>setStyle('min-width',v)));g.append(field('Max width','text',sp['max-width']||cssValue(cs.maxWidth),v=>setStyle('max-width',v)));g.append(field('Z-index','number',sp['z-index']||cs.zIndex||0,v=>setStyle('z-index',String(Number(v)||0))));g.append(field('Overflow','select',sp.overflow||cs.overflow,v=>setStyle('overflow',v),[['visible','Visible'],['hidden','Hidden'],['auto','Auto'],['scroll','Scroll']]));panel.appendChild(g);
      const box=group('Spacing');box.append(field('Padding','text',sp.padding||cssValue(cs.padding),v=>setStyle('padding',v)));box.append(field('Margin','text',sp.margin||cssValue(cs.margin),v=>setStyle('margin',v)));box.append(field('Gap','text',sp.gap||cssValue(cs.gap),v=>setStyle('gap',v)));panel.appendChild(box);
      const flow=group('Layout system');flow.append(field('Display','select',sp.display||cs.display,v=>setStyle('display',v),[['block','Block'],['inline-block','Inline block'],['flex','Flex'],['grid','Grid'],['inline','Inline'],['contents','Contents']]));flow.append(field('Grid columns','text',sp['grid-template-columns']||cs.gridTemplateColumns||'',v=>setStyle('grid-template-columns',v)));flow.append(field('Flex direction','select',sp['flex-direction']||cs.flexDirection,v=>setStyle('flex-direction',v),[['row','Row'],['column','Column'],['row-reverse','Row reverse'],['column-reverse','Column reverse']]));flow.append(field('Justify','select',sp['justify-content']||cs.justifyContent,v=>setStyle('justify-content',v),[['flex-start','Start'],['center','Center'],['space-between','Space between'],['space-around','Space around'],['flex-end','End']]));flow.append(field('Align','select',sp['align-items']||cs.alignItems,v=>setStyle('align-items',v),[['stretch','Stretch'],['flex-start','Start'],['center','Center'],['flex-end','End'],['baseline','Baseline']]));panel.appendChild(flow);
      const acts=group('Free position');const aa=document.createElement('div');aa.className='dev22-actions';aa.append(action('Center in viewport',()=>{const r=selected.getBoundingClientRect();mutate(()=>{patch(selectedKey).free={x:scrollX+(innerWidth-r.width)/2,y:scrollY+(innerHeight-r.height)/2,width:r.width,height:r.height,z:22000};});}));aa.append(action('Return to flow',()=>mutate(()=>{delete patch(selectedKey).free;})));acts.appendChild(aa);panel.appendChild(acts);
    }else if(tab==='lines'){
      const g=group('Columns, rows & separators');g.append(field('Separator color','color',hex(sp['--dev-separator-color']||cs.borderColor),v=>setStyle('--dev-separator-color',v)));g.append(field('Separator width','text',sp['--dev-separator-width']||'1px',v=>setStyle('--dev-separator-width',v)));g.append(field('Separator style','select',sp['--dev-separator-style']||'solid',v=>setStyle('--dev-separator-style',v),[['solid','Solid'],['dashed','Dashed'],['dotted','Dotted'],['double','Double'],['none','None']]));g.append(field('Cell padding','text',sp['--dev-cell-padding']||'10px',v=>setStyle('--dev-cell-padding',v)));g.append(field('Column template','text',sp['grid-template-columns']||cs.gridTemplateColumns||'',v=>setStyle('grid-template-columns',v)));g.append(field('Row template','text',sp['grid-template-rows']||cs.gridTemplateRows||'',v=>setStyle('grid-template-rows',v)));panel.appendChild(g);
      const outline=group('Outline / guides');outline.append(field('Outline','text',sp.outline||cssValue(cs.outline),v=>setStyle('outline',v)));outline.append(field('Outline offset','text',sp['outline-offset']||cssValue(cs.outlineOffset),v=>setStyle('outline-offset',v)));panel.appendChild(outline);
    }else if(tab==='content'){
      const t=textNode(selected);if(t){const g=group('Text');g.append(field('Text','textarea',t.textContent,v=>setText(t,v)));g.append(field('Font','select',cs.fontFamily.split(',')[0].replace(/["']/g,''),v=>setStyle('font-family',v),[['Crimson Pro','Crimson Pro'],['Georgia','Georgia'],['Playfair Display','Playfair Display'],['Inter','Inter'],['Arial','Arial'],['system-ui','System UI'],['monospace','Monospace']]));g.append(field('Size','text',sp['font-size']||cs.fontSize,v=>setStyle('font-size',v)));g.append(field('Weight','select',sp['font-weight']||cs.fontWeight,v=>setStyle('font-weight',v),[['300','Light'],['400','Regular'],['500','Medium'],['600','Semibold'],['700','Bold'],['800','Extra bold']]));g.append(field('Align','select',sp['text-align']||cs.textAlign,v=>setStyle('text-align',v),[['left','Left'],['center','Center'],['right','Right'],['justify','Justify']]));g.append(field('Line height','text',sp['line-height']||cs.lineHeight,v=>setStyle('line-height',v)));g.append(field('Letter spacing','text',sp['letter-spacing']||cs.letterSpacing,v=>setStyle('letter-spacing',v)));panel.appendChild(g);}
      const add=group('Create / duplicate');const a=document.createElement('div');a.className='dev22-actions';a.append(action('Add text box',()=>addBlock('text')));a.append(action('Add section',()=>addBlock('section')));a.append(action('Duplicate selected',duplicateSelected));a.append(action('Hide in DEV',hideSelected));add.appendChild(a);panel.appendChild(add);
    }else if(tab==='icons'){
      ensurePhosphor();const g=group('Cute & useful icons');const search=document.createElement('input');search.className='dev22-icon-search';search.placeholder='Search icons…';g.appendChild(search);const grid=document.createElement('div');grid.className='dev22-icon-grid';g.appendChild(grid);
      const render=q=>{grid.replaceChildren();const term=String(q||'').toLowerCase();phIcons.filter(([,name])=>!term||name.toLowerCase().includes(term)).forEach(([name,title])=>{const b=document.createElement('button');b.type='button';b.title=title;b.innerHTML=`<i class="ph ph-${name}"></i><small>${title}</small>`;b.onclick=()=>applyIcon('ph',name);grid.appendChild(b);});if(!term||'cute emoji decorative'.includes(term))cuteEmoji.forEach(em=>{const b=document.createElement('button');b.type='button';b.title='Decorative symbol';b.innerHTML=`<span class="emoji">${em}</span><small>Decorative</small>`;b.onclick=()=>applyIcon('emoji',em);grid.appendChild(b);});};search.addEventListener('input',()=>render(search.value));render('');panel.appendChild(g);
    }else{
      const g=group('Advanced actions');const a=document.createElement('div');a.className='dev22-actions';a.append(action('Bring to front',bringFront));a.append(action('Send backward',sendBack));a.append(action('Duplicate',duplicateSelected));a.append(action('Reset selected',resetSelected));a.append(action('Hide in DEV',hideSelected,'danger'));a.append(action('Copy CSS',async()=>{const p=state.patches[selectedKey]?.style||{};const txt=Object.entries(p).map(([k,v])=>`${k}: ${v};`).join('\n');try{await navigator.clipboard.writeText(txt);toast('CSS copied');}catch{toast('Copy unavailable','warn');}}));g.appendChild(a);panel.appendChild(g);
      const custom=group('Custom CSS property');let prop='',val='';custom.append(field('Property','text','',v=>prop=v));custom.append(field('Value','text','',v=>val=v));custom.appendChild(action('Apply custom property',()=>{if(prop.trim())setStyle(prop.trim(),val);}));panel.appendChild(custom);
    }
  }

  function showContext(x,y,el){choose(el);const c=ui.context;c.replaceChildren();const item=(glyph,text,fn,cls='')=>{const b=document.createElement('button');b.type='button';b.className=cls;b.innerHTML=`<span class="ctx-glyph">${glyph}</span><span>${text}</span>`;b.onclick=()=>{c.hidden=true;fn();};c.appendChild(b);};item('↔','Move freely',()=>toast('Drag MOVE above the selected object'));item('✎','Edit text',()=>startEdit(selected));item('◈','Open style controls',()=>{tab='style';ui.inspector.hidden=false;renderInspector();});item('▦','Layout & columns',()=>{tab='layout';ui.inspector.hidden=false;renderInspector();});item('│','Separators / lines',()=>{tab='lines';ui.inspector.hidden=false;renderInspector();});item('✦','Change icon / symbol',()=>{tab='icons';ui.inspector.hidden=false;renderInspector();});c.appendChild(document.createElement('hr'));item('⧉','Duplicate whole selection',duplicateSelected);item('↑','Bring to front',bringFront);item('↓','Send backward',sendBack);item('＋','Add text box',()=>addBlock('text'));item('▣','Add section',()=>addBlock('section'));c.appendChild(document.createElement('hr'));item('↺','Reset selected',resetSelected);item('⊘','Hide in DEV',hideSelected,'danger');c.hidden=false;const w=254,h=Math.min(430,c.scrollHeight||380);c.style.left=Math.max(8,Math.min(innerWidth-w-8,x))+'px';c.style.top=Math.max(8,Math.min(innerHeight-h-8,y))+'px';}

  function currentDrawTool(){return ui.tool?.value||'select';}
  function resizeCanvas(){if(!ui.canvas)return;const dpr=Math.max(1,devicePixelRatio||1),w=Math.max(document.documentElement.scrollWidth,innerWidth),h=Math.max(document.documentElement.scrollHeight,innerHeight);if(ui.canvas._cssW===w&&ui.canvas._cssH===h)return;ui.canvas._cssW=w;ui.canvas._cssH=h;ui.canvas.style.width=w+'px';ui.canvas.style.height=h+'px';ui.canvas.width=Math.round(w*dpr);ui.canvas.height=Math.round(h*dpr);renderAnnotations();if(ui.noteLayer){ui.noteLayer.style.width=w+'px';ui.noteLayer.style.height=h+'px';}}
  function ctx(){const c=ui.canvas.getContext('2d');const dpr=Math.max(1,devicePixelRatio||1);c.setTransform(dpr,0,0,dpr,0,0);return c;}
  function drawStroke(c,s){const pts=s.points||[];if(!pts.length)return;c.save();c.lineCap='round';c.lineJoin='round';c.lineWidth=s.width||3;c.strokeStyle=s.color||'#d45b73';c.globalAlpha=s.tool==='highlight'?.25:1;c.globalCompositeOperation=s.tool==='eraser'?'destination-out':'source-over';if(s.tool==='rect'){const a=pts[0],b=pts[pts.length-1];c.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);}else if(s.tool==='arrow'){const a=pts[0],b=pts[pts.length-1];c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();const ang=Math.atan2(b.y-a.y,b.x-a.x),len=12+(s.width||3)*1.5;c.beginPath();c.moveTo(b.x,b.y);c.lineTo(b.x-len*Math.cos(ang-.45),b.y-len*Math.sin(ang-.45));c.moveTo(b.x,b.y);c.lineTo(b.x-len*Math.cos(ang+.45),b.y-len*Math.sin(ang+.45));c.stroke();}else{c.beginPath();c.moveTo(pts[0].x,pts[0].y);for(let i=1;i<pts.length;i++)c.lineTo(pts[i].x,pts[i].y);c.stroke();}c.restore();}
  function renderAnnotations(temp=null){if(!ui.canvas||!active)return;resizeCanvasGuard=true;const c=ctx();c.clearRect(0,0,ui.canvas._cssW||0,ui.canvas._cssH||0);state.annotations.forEach(s=>drawStroke(c,s));if(temp)drawStroke(c,temp);resizeCanvasGuard=false;}
  let resizeCanvasGuard=false;
  function canvasDown(e){const tool=currentDrawTool();if(!active||tool==='select')return;e.preventDefault();e.stopPropagation();const p={x:e.pageX,y:e.pageY};if(tool==='text'){noteBoxState={id:e.pointerId,start:p,last:p};createNotePreview(p,p);return;}drawState={id:e.pointerId,stroke:{tool,color:ui.drawColor?.value||'#d45b73',width:Number(ui.drawWidth?.value||3),points:[p]}};}
  function canvasMove(e){if(drawState&&e.pointerId===drawState.id){e.preventDefault();const s=drawState.stroke;s.points.push({x:e.pageX,y:e.pageY});if(s.tool==='rect'||s.tool==='arrow')s.points=[s.points[0],{x:e.pageX,y:e.pageY}];renderAnnotations(s);}if(noteBoxState&&e.pointerId===noteBoxState.id){noteBoxState.last={x:e.pageX,y:e.pageY};createNotePreview(noteBoxState.start,noteBoxState.last);}}
  function canvasUp(e){if(drawState&&e.pointerId===drawState.id){const s=drawState.stroke;drawState=null;pushHistory();state.annotations.push(s);persist();renderAnnotations();emit();}if(noteBoxState&&e.pointerId===noteBoxState.id){const a=noteBoxState.start,b=noteBoxState.last||a;noteBoxState=null;ui.notePreview?.remove();ui.notePreview=null;const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),w=Math.max(140,Math.abs(b.x-a.x)),h=Math.max(70,Math.abs(b.y-a.y));pushHistory();const note={id:'note_'+Date.now(),x,y,w,h,text:'Type your note…',background:'rgba(255,251,224,.92)',color:'#4d433d'};state.notes.push(note);persist();renderNotes();setTimeout(()=>{const el=$(`[data-dev22-note="${note.id}"]`);if(el){el.contentEditable='true';el.focus();const r=document.createRange(),s=window.getSelection();r.selectNodeContents(el);s.removeAllRanges();s.addRange(r);}},0);}}
  function createNotePreview(a,b){ui.notePreview?.remove();const d=document.createElement('div');d.className='dev22-note-box-preview';Object.assign(d.style,{left:Math.min(a.x,b.x)+'px',top:Math.min(a.y,b.y)+'px',width:Math.abs(b.x-a.x)+'px',height:Math.abs(b.y-a.y)+'px'});document.body.appendChild(d);ui.notePreview=d;}

  function renderNotes(){if(!ui.noteLayer||!active)return;ui.noteLayer.replaceChildren();for(const n of state.notes){const el=document.createElement('div');el.className='dev22-note';el.dataset.dev22Note=n.id;el.textContent=n.text;Object.assign(el.style,{left:n.x+'px',top:n.y+'px',width:n.w+'px',height:n.h+'px',background:n.background||'rgba(255,251,224,.92)',color:n.color||'#4d433d'});const h=document.createElement('button');h.type='button';h.className='dev22-note-handle';h.textContent='↔';h.title='Move note';el.appendChild(h);h.addEventListener('pointerdown',e=>beginNoteMove(e,n,el));el.addEventListener('dblclick',e=>{e.stopPropagation();el.contentEditable='true';h.contentEditable='false';el.focus();});el.addEventListener('blur',()=>{if(el.contentEditable==='true'){el.contentEditable='false';const txt=[...el.childNodes].filter(x=>x!==h).map(x=>x.textContent).join('').trim();pushHistory();n.text=txt||' ';const r=el.getBoundingClientRect();n.w=r.width;n.h=r.height;persist();renderNotes();}},true);el.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();const color=prompt('Note background color (CSS value)',n.background||'rgba(255,251,224,.92)');if(color!==null){pushHistory();n.background=color;persist();renderNotes();}});ui.noteLayer.appendChild(el);}}
  let noteMove=null;
  function beginNoteMove(e,n,el){e.preventDefault();e.stopPropagation();const r=el.getBoundingClientRect();noteMove={id:e.pointerId,n,el,dx:e.pageX-(r.left+scrollX),dy:e.pageY-(r.top+scrollY)};}
  function noteMovePointer(e){if(!noteMove||e.pointerId!==noteMove.id)return;e.preventDefault();const x=e.pageX-noteMove.dx,y=e.pageY-noteMove.dy;noteMove.el.style.left=x+'px';noteMove.el.style.top=y+'px';}
  function noteMoveUp(e){if(!noteMove||e.pointerId!==noteMove.id)return;pushHistory();noteMove.n.x=parseFloat(noteMove.el.style.left)||0;noteMove.n.y=parseFloat(noteMove.el.style.top)||0;const r=noteMove.el.getBoundingClientRect();noteMove.n.w=r.width;noteMove.n.h=r.height;noteMove=null;persist();}

  function buildUi(){
    if(ui.selection)return;
    ui.marquee=document.createElement('div');ui.marquee.className='dev22-marquee';ui.marquee.hidden=true;document.body.appendChild(ui.marquee);
    ui.selection=document.createElement('div');ui.selection.className='dev22-selection';ui.selection.hidden=true;ui.selection.innerHTML='<span class="dev22-selection-label"></span><button type="button" class="dev22-move-handle">MOVE</button><i class="dev22-resize-handle nw" data-corner="nw"></i><i class="dev22-resize-handle ne" data-corner="ne"></i><i class="dev22-resize-handle sw" data-corner="sw"></i><i class="dev22-resize-handle se" data-corner="se"></i>';document.body.appendChild(ui.selection);$('.dev22-move-handle',ui.selection).addEventListener('pointerdown',beginMove);$$('.dev22-resize-handle',ui.selection).forEach(h=>h.addEventListener('pointerdown',e=>beginResize(e,h.dataset.corner)));
    ui.context=document.createElement('div');ui.context.className='dev22-context';ui.context.hidden=true;document.body.appendChild(ui.context);
    ui.inspector=document.createElement('aside');ui.inspector.className='dev22-inspector';ui.inspector.hidden=true;ui.inspector.innerHTML='<div class="dev22-inspector-head"><div><h3>DEV playground</h3><p></p></div><button type="button" data-close>×</button></div><div class="dev22-tabs"><button data-tab="style">Style</button><button data-tab="layout">Layout</button><button data-tab="lines">Lines</button><button data-tab="content">Content</button><button data-tab="icons">Icons</button><button data-tab="more">More</button></div><div class="dev22-panel"></div>';document.body.appendChild(ui.inspector);$('[data-close]',ui.inspector).onclick=()=>ui.inspector.hidden=true;$$('.dev22-tabs button',ui.inspector).forEach(b=>b.onclick=()=>{tab=b.dataset.tab;renderInspector();});
    ui.canvas=document.createElement('canvas');ui.canvas.className='dev22-canvas';document.body.appendChild(ui.canvas);ui.canvas.addEventListener('pointerdown',canvasDown);ui.canvas.addEventListener('pointermove',canvasMove);ui.canvas.addEventListener('pointerup',canvasUp);ui.canvas.addEventListener('pointercancel',canvasUp);
    ui.noteLayer=document.createElement('div');ui.noteLayer.className='dev22-note-layer';document.body.appendChild(ui.noteLayer);
    ui.toolbar=document.createElement('div');ui.toolbar.className='dev22-toolbar';ui.toolbar.innerHTML='<button type="button" data-undo>↶ Undo</button><button type="button" data-redo>↷ Redo</button><span class="sep"></span><select data-tool title="Tool"><option value="select">Select</option><option value="pen">Pen</option><option value="highlight">Highlight</option><option value="eraser">Eraser</option><option value="rect">Rectangle</option><option value="arrow">Arrow</option><option value="text">Text box</option></select><input type="color" data-color value="#d45b73" title="Annotation color"><select data-width title="Thickness"><option value="2">Thin</option><option value="4" selected>Medium</option><option value="8">Thick</option><option value="18">Highlight</option></select><button type="button" data-clear-draw>Clear markup</button><span class="sep"></span><button type="button" data-add-text>+ Text</button><button type="button" data-add-section>+ Section</button><button type="button" data-reset>Reset</button><button type="button" class="dev22-exit" data-exit>Exit DEV</button>';document.body.appendChild(ui.toolbar);ui.tool=$('[data-tool]',ui.toolbar);ui.drawColor=$('[data-color]',ui.toolbar);ui.drawWidth=$('[data-width]',ui.toolbar);$('[data-undo]',ui.toolbar).onclick=undo;$('[data-redo]',ui.toolbar).onclick=redo;$('[data-reset]',ui.toolbar).onclick=reset;$('[data-exit]',ui.toolbar).onclick=exit;$('[data-add-text]',ui.toolbar).onclick=()=>addBlock('text');$('[data-add-section]',ui.toolbar).onclick=()=>addBlock('section');$('[data-clear-draw]',ui.toolbar).onclick=()=>mutate(()=>{state.annotations=[];state.notes=[];},'Markup cleared');ui.tool.addEventListener('change',syncDrawMode);
    syncDrawMode();
  }
  function syncDrawMode(){if(!ui.canvas)return;const tool=currentDrawTool();ui.canvas.classList.toggle('draw-active',tool!=='select');if(tool==='highlight'&&Number(ui.drawWidth.value)<12)ui.drawWidth.value='18';if(tool==='eraser')ui.drawWidth.value='18';}
  function showUi(){buildUi();[ui.marquee,ui.selection,ui.context,ui.inspector,ui.canvas,ui.noteLayer,ui.toolbar].forEach(x=>{if(x)x.hidden=false;});ui.marquee.hidden=true;ui.selection.hidden=!selected;ui.context.hidden=true;ui.inspector.hidden=true;resizeCanvas();renderNotes();renderAnnotations();}
  function hideUi(){Object.values(ui).forEach(x=>{if(x instanceof HTMLElement||x instanceof HTMLCanvasElement)x.hidden=true;});}

  function enter(){if(active)return;if(!actor())return toast('Choose Principessa or Principe first','warn');active=true;document.body.classList.add('dev-v22');document.body.classList.remove('dev-v21','dev-playground','dev-v19');ensurePhosphor();showUi();applyState();const badge=$('#loggedUserBadge');if(badge)badge.textContent='DEV';const toggle=$('#twDevToggle');if(toggle)toggle.textContent='Exit DEV';emit();}
  function exit(){if(!active)return;finishEdit(true);active=false;restoreSession();document.body.classList.remove('dev-v22');hideUi();selected=null;selectedKey='';const a=actor(),badge=$('#loggedUserBadge');if(badge&&a)badge.textContent=a;const toggle=$('#twDevToggle');if(toggle)toggle.textContent='Dev';emit();}

  document.addEventListener('pointerdown',e=>{if(!active)return;if(performance.now()<suppressUntil)return;marqueeDown(e);},true);
  document.addEventListener('pointermove',e=>{marqueeMove(e);movePointer(e);resizePointer(e);noteMovePointer(e);},true);
  document.addEventListener('pointerup',e=>{marqueeUp(e);endMove(e);endResize(e);noteMoveUp(e);},true);
  document.addEventListener('dblclick',e=>{if(!active||ignore(e.target)||e.target.closest('button,a,input,select,textarea'))return;e.preventDefault();e.stopPropagation();startEdit(e.target);},true);
  document.addEventListener('contextmenu',e=>{if(!active||ignore(e.target)||e.target.closest('.dev22-note'))return;e.preventDefault();e.stopPropagation();showContext(e.clientX,e.clientY,e.target);},true);
  document.addEventListener('pointerdown',e=>{if(active&&ui.context&&!ui.context.hidden&&!e.target.closest('.dev22-context'))ui.context.hidden=true;},true);
  document.addEventListener('keydown',e=>{
    if(!active)return;const mod=e.ctrlKey||e.metaKey;if(mod&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}if(mod&&e.key.toLowerCase()==='y'){e.preventDefault();redo();return;}if(e.key==='Escape'){finishEdit(true);ui.context&&(ui.context.hidden=true);clearSelection();ui.tool&&(ui.tool.value='select');syncDrawMode();return;}if(editing&&e.key==='Enter'&&!e.shiftKey){e.preventDefault();finishEdit(true);return;}
    if(selected&&!e.target.matches('input,textarea,select,[contenteditable="true"]')&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const step=e.shiftKey?10:1,r=selected.getBoundingClientRect(),free=state.patches[selectedKey]?.free||{x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height,z:22000};if(e.key==='ArrowLeft')free.x-=step;if(e.key==='ArrowRight')free.x+=step;if(e.key==='ArrowUp')free.y-=step;if(e.key==='ArrowDown')free.y+=step;mutate(()=>{patch(selectedKey).free=free;});}
  },true);
  window.addEventListener('scroll',refreshSelection,{passive:true});window.addEventListener('resize',()=>{refreshSelection();if(active)resizeCanvas();});
  new MutationObserver(()=>{if(active){requestAnimationFrame(()=>{refreshSelection();resizeCanvas();applyState();});}}).observe(document.body,{childList:true,subtree:true});

  const api={get active(){return active;},enter,exit,undo,redo,reset};
  window.TwogetherDevV22=api;window.TwogetherDevV21=api;window.TwogetherDevV18=api;
  document.addEventListener('DOMContentLoaded',()=>{const dev=$('#twDevToggle');if(dev)dev.title='Open DEV visual playground';});
})();
