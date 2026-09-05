(() => {
  'use strict';
  const KEY='twogether_dev_playground_v19';
  const ACTORS=['Principessa','Principe'];
  const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
  const clone=v=>JSON.parse(JSON.stringify(v));
  let active=false,selected=null,hovered=null,float=null,inspector=null,bottom=null,tab='layout',snapshots=new Map(),drag=null;
  let patches={},past=[],future=[];
  try{const x=JSON.parse(localStorage.getItem(KEY)||'{}');patches=x.patches||{};past=x.past||[];future=x.future||[];}catch{}

  function actor(){const a=document.body.dataset.actor||'';return ACTORS.includes(a)?a:'';}
  function persist(){try{localStorage.setItem(KEY,JSON.stringify({patches,past:past.slice(-100),future:future.slice(-100)}));}catch{}}
  function emit(){document.dispatchEvent(new CustomEvent('twogether:dev-changed'));}
  function toast(msg,tone='ok'){const el=$('#toast');if(!el)return;el.textContent=msg;el.className='toast show '+tone;clearTimeout(el._d19);el._d19=setTimeout(()=>el.className='toast',2600);}
  function safeCss(v){return window.CSS?.escape?CSS.escape(String(v)):String(v).replace(/[^a-zA-Z0-9_-]/g,'\\$&');}

  function selector(el){
    if(!el)return '';
    if(el===document.body)return 'body';
    if(el.id)return '#'+safeCss(el.id);
    for(const attr of ['data-current-plan','data-current-trip','data-open-trip','data-fin-month','data-dev19-added']){
      if(el.hasAttribute?.(attr)){const val=el.getAttribute(attr);return `[${attr}="${safeCss(val)}"]`;}
    }
    const parent=el.parentElement;if(!parent)return '';
    const stable=selector(parent);if(!stable)return '';
    const same=[...parent.children].filter(x=>x.tagName===el.tagName),idx=same.indexOf(el)+1;
    return `${stable} > ${el.tagName.toLowerCase()}:nth-of-type(${idx})`;
  }
  function resolve(key){try{return document.querySelector(key);}catch{return null;}}
  function saveBase(el){if(!el||snapshots.has(el))return;snapshots.set(el,{style:el.getAttribute('style'),text:el.childElementCount===0?el.textContent:null});}
  function restoreBase(){
    for(const [el,b] of snapshots){if(!el.isConnected)continue;b.style==null?el.removeAttribute('style'):el.setAttribute('style',b.style);if(b.text!=null)el.textContent=b.text;}
    snapshots.clear();$$('[data-dev19-added]').forEach(x=>x.remove());
  }
  function apply(){
    if(!active)return;
    for(const [key,p] of Object.entries(patches)){
      let el=resolve(key);
      if(p.add&&!el){const parent=resolve(p.parent)||$('.sheet.active')||$('main');if(!parent)continue;el=document.createElement(p.tag||'div');el.dataset.dev19Added=p.id;el.className='dev19-added';el.textContent=p.text||'New test block';parent.appendChild(el);}
      if(!el)continue;saveBase(el);
      if(p.text!==undefined&&el.childElementCount===0)el.textContent=p.text;
      Object.entries(p.style||{}).forEach(([k,v])=>el.style.setProperty(k,v));
      if(p.hidden)el.style.setProperty('display','none','important');
    }
  }
  function mutate(fn){past.push(clone(patches));past=past.slice(-100);future=[];restoreBase();fn();persist();apply();renderInspector();emit();}
  function undo(){if(!past.length)return;restoreBase();future.push(clone(patches));patches=past.pop();persist();apply();renderInspector();emit();}
  function redo(){if(!future.length)return;restoreBase();past.push(clone(patches));patches=future.pop();persist();apply();renderInspector();emit();}
  function reset(){mutate(()=>{patches={};});toast('DEV playground reset — Ctrl+Z can undo it');}
  function patchSelected(part,target=selected){if(!target)return;const key=selector(target);if(!key)return;mutate(()=>{const old=patches[key]||{};patches[key]={...old,...part,style:{...(old.style||{}),...(part.style||{})}};});}

  function selectedPatch(){const key=selector(selected);return key?(patches[key]||{}):{};}
  function rgbToHex(v){if(/^#[0-9a-f]{6}$/i.test(v||''))return v;const m=String(v||'').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);if(!m)return '#ffffff';return '#'+[m[1],m[2],m[3]].map(x=>Number(x).toString(16).padStart(2,'0')).join('');}
  function computed(){return selected?getComputedStyle(selected):null;}

  function setHover(el){if(hovered===el)return;hovered?.classList.remove('dev19-hover');hovered=el;if(hovered&&!hovered.classList.contains('dev19-selected'))hovered.classList.add('dev19-hover');positionFloat();}
  function setSelected(el,open=true){selected?.classList.remove('dev19-selected');selected=el;selected?.classList.add('dev19-selected');setHover(el);if(open){inspector.hidden=false;renderInspector();}positionFloat();}
  function clearSelected(){selected?.classList.remove('dev19-selected');selected=null;renderInspector();}
  function candidate(node){if(!node||node===document.documentElement||node===document.body)return null;if(node.closest?.('.dev19-float,.dev19-inspector,.dev19-bottom,.identity-modal'))return null;return node;}
  function positionFloat(){if(!active||!hovered||!float){if(float)float.hidden=true;return;}const r=hovered.getBoundingClientRect();if(!r.width||!r.height){float.hidden=true;return;}float.hidden=false;requestAnimationFrame(()=>{const w=float.offsetWidth||150;let x=Math.min(innerWidth-w-8,Math.max(8,r.right-w));let y=r.top-42;if(y<8)y=Math.min(innerHeight-42,r.top+8);float.style.left=x+'px';float.style.top=y+'px';});}

  function field(label,type,value,onChange,opts=[]){const row=document.createElement('label');row.className='dev19-field';const s=document.createElement('span');s.textContent=label;row.appendChild(s);let input;if(type==='select'){input=document.createElement('select');opts.forEach(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;input.appendChild(o);});}else if(type==='textarea'){input=document.createElement('textarea');}else{input=document.createElement('input');input.type=type;}input.value=value??'';const evt=type==='color'||type==='range'?'input':'change';input.addEventListener(evt,()=>onChange(input.value));row.appendChild(input);return row;}
  function group(title){const g=document.createElement('section');g.className='dev19-group';const h=document.createElement('h4');h.textContent=title;g.appendChild(h);return g;}
  function quickButton(text,fn,cls=''){const b=document.createElement('button');b.type='button';b.textContent=text;b.className=cls;b.onclick=fn;return b;}

  function currentIconTarget(){if(!selected)return null;if(selected.childElementCount===0&&selected.textContent.trim().length<=4)return selected;return selected.querySelector?.('.pick-icon,.brand-mark,.identity-heart,.tw-trip-emoji')||null;}
  function addBlock(kind){
    const parent=selected?.closest?.('.finance-subview.active,.sheet.active,section')||$('.finance-subview.active')||$('.sheet.active')||$('main');if(!parent)return;
    const id=(crypto.randomUUID?.()||String(Date.now())+Math.random()),key=`[data-dev19-added="${id}"]`;
    const text=kind==='section'?'New test section':kind==='category'?'New test category':'Your test text';
    mutate(()=>{patches[key]={add:true,id,parent:selector(parent),tag:kind==='section'?'section':'div',text,style:{padding:'16px',margin:'10px 0','border-radius':'14px',border:'1px dashed #c78686','background-color':'#fffafa'}};});
    setTimeout(()=>{const el=resolve(key);if(el)setSelected(el,true);},0);
  }
  function duplicate(){if(!selected)return;const parent=selected.parentElement;if(!parent)return;const id=(crypto.randomUUID?.()||String(Date.now())),key=`[data-dev19-added="${id}"]`;const text=selected.innerText||selected.textContent||'Duplicate';mutate(()=>{patches[key]={add:true,id,parent:selector(parent),tag:'div',text,style:{padding:'14px',margin:'8px 0','border-radius':'12px',border:'1px dashed #c78686','background-color':'#fffafa'}};});}

  function renderInspector(){
    if(!inspector)return;const panel=$('.dev19-panel',inspector);panel.replaceChildren();
    $$('.dev19-tabs button',inspector).forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
    if(!selected){const g=group('Select something');const p=document.createElement('p');p.textContent='Hover anywhere on the site, then click the paint/edit control. You can style, move, duplicate or hide almost any visible element.';p.style.color='#776663';p.style.fontSize='13px';g.appendChild(p);panel.appendChild(g);return;}
    const cs=computed(),p=selectedPatch();
    if(tab==='layout'){
      const g=group('Position & size');
      const x=Number(p.x||0),y=Number(p.y||0);
      g.append(field('Move X','number',x,v=>patchSelected({x:Number(v)||0,style:{position:'relative',transform:`translate(${Number(v)||0}px, ${Number(p.y||0)}px)`,'z-index':'4'}})));
      g.append(field('Move Y','number',y,v=>patchSelected({y:Number(v)||0,style:{position:'relative',transform:`translate(${Number(p.x||0)}px, ${Number(v)||0}px)`,'z-index':'4'}})));
      g.append(field('Width','text',selected.style.width||'',v=>patchSelected({style:{width:v||'auto'}})));
      g.append(field('Max width','text',selected.style.maxWidth||'',v=>patchSelected({style:{'max-width':v||'none'}})));
      g.append(field('Padding','number',parseFloat(cs.padding)||0,v=>patchSelected({style:{padding:Math.max(0,Number(v)||0)+'px'}})));
      g.append(field('Margin','number',parseFloat(cs.margin)||0,v=>patchSelected({style:{margin:(Number(v)||0)+'px'}})));
      g.append(field('Corner radius','number',parseFloat(cs.borderRadius)||0,v=>patchSelected({style:{'border-radius':Math.max(0,Number(v)||0)+'px'}})));
      panel.appendChild(g);
      const q=group('Quick layout');q.classList.add('dev19-quick');q.append(quickButton('↕ Move / drag',()=>toast('Use the ↕ button beside the selected element and drag it freely.')));q.append(quickButton('Duplicate',duplicate));q.append(quickButton('Hide in DEV',()=>{patchSelected({hidden:true});clearSelected();},'dev19-danger'));q.append(quickButton('Reset this',()=>{const key=selector(selected);mutate(()=>{delete patches[key];});}));panel.appendChild(q);
    }else if(tab==='style'){
      const t=group('Typography');const fonts=[['Crimson Pro','Crimson Pro'],['Georgia','Georgia'],['Playfair Display','Playfair Display'],['Arial','Arial'],['Inter','Inter'],['Trebuchet MS','Trebuchet MS'],['monospace','Monospace']];
      const cur=cs.fontFamily.split(',')[0].replace(/["']/g,'').trim();t.append(field('Font family','select',fonts.some(x=>x[0]===cur)?cur:'Crimson Pro',v=>patchSelected({style:{'font-family':v}}),fonts));
      t.append(field('Font size','number',parseFloat(cs.fontSize)||16,v=>patchSelected({style:{'font-size':Math.max(8,Math.min(120,Number(v)||16))+'px'}})));
      t.append(field('Font weight','select',cs.fontWeight,v=>patchSelected({style:{'font-weight':v}}),[['400','Regular'],['500','Medium'],['600','Semibold'],['700','Bold'],['800','Heavy']]));
      t.append(field('Text align','select',cs.textAlign,v=>patchSelected({style:{'text-align':v}}),[['left','Left'],['center','Center'],['right','Right']]));panel.appendChild(t);
      const c=group('Colors & surface');c.append(field('Text color','color',rgbToHex(cs.color),v=>patchSelected({style:{color:v}})));c.append(field('Background','color',rgbToHex(cs.backgroundColor),v=>patchSelected({style:{'background-color':v}})));c.append(field('Border color','color',rgbToHex(cs.borderColor),v=>patchSelected({style:{'border-color':v}})));c.append(field('Opacity','range',Math.round((Number(cs.opacity)||1)*100),v=>patchSelected({style:{opacity:String(Number(v)/100)}})));c.append(field('Page background','color',rgbToHex(getComputedStyle(document.body).backgroundColor),v=>{const old=selected;selected=document.body;patchSelected({style:{'background-color':v}});selected=old;}));panel.appendChild(c);
      const sh=group('Finish');sh.classList.add('dev19-quick');sh.append(quickButton('Soft shadow',()=>patchSelected({style:{'box-shadow':'0 14px 34px rgba(55,38,28,.10)'}})));sh.append(quickButton('No shadow',()=>patchSelected({style:{'box-shadow':'none'}})));sh.append(quickButton('Thin border',()=>patchSelected({style:{border:'1px solid #dfd3c6'}})));sh.append(quickButton('No border',()=>patchSelected({style:{border:'0'}})));panel.appendChild(sh);
    }else if(tab==='content'){
      const g=group('Content');
      if(selected.childElementCount===0)g.append(field('Text','textarea',selected.textContent,v=>patchSelected({text:v})));
      else{const p=document.createElement('p');p.textContent='Select a heading, label, icon or other leaf element to edit its exact text without replacing its children.';p.style.fontSize='12px';p.style.color='#786a67';g.appendChild(p);}panel.appendChild(g);
      const q=group('Create & arrange');q.classList.add('dev19-quick');q.append(quickButton('+ Text box',()=>addBlock('text')));q.append(quickButton('+ Section',()=>addBlock('section')));q.append(quickButton('+ Category',()=>addBlock('category')));q.append(quickButton('Duplicate',duplicate));q.append(quickButton('Hide in DEV',()=>{patchSelected({hidden:true});clearSelected();},'dev19-danger'));panel.appendChild(q);
      addRealDelete(panel);
    }else{
      const g=group('Icon / symbol');const target=currentIconTarget();
      if(target){const options=[['♡','♡ Heart outline'],['♥','♥ Heart'],['♕','♕ Crown'],['♔','♔ Crown outline'],['✦','✦ Spark'],['✧','✧ Spark outline'],['✈','✈ Flight'],['⌂','⌂ Home'],['●','● Dot'],['✓','✓ Check'],['＋','＋ Plus'],['→','→ Arrow'],['↗','↗ Open'],['☕','☕ Coffee'],['⚑','⚑ Flag'],['♫','♫ Music'],['🌿','🌿 Leaf'],['🌍','🌍 World'],['💶','💶 Euro'],['🧳','🧳 Luggage'],['📍','📍 Pin']];g.append(field('Choose icon','select',target.textContent.trim(),v=>patchSelected({text:v},target),options));}
      else{const p=document.createElement('p');p.textContent='Select an icon, symbol, badge or a very short text element to change its symbol.';p.style.fontSize='12px';p.style.color='#786a67';g.appendChild(p);}panel.appendChild(g);
    }
  }

  function addRealDelete(panel){
    if(!selected)return;const trip=selected.closest?.('[data-open-trip],[data-current-trip]');const month=selected.closest?.('[data-fin-month]');const wish=selected.closest?.('tr')?.querySelector?.('[data-wish-index]');if(!trip&&!month&&!wish)return;
    const g=group('Real saved data');const b=quickButton('Delete saved item permanently',async()=>{if(!confirm('This deletes the real saved data, not just the DEV preview. Continue?'))return;try{
      if(trip){const id=trip.dataset.openTrip||trip.dataset.currentTrip;await window.TwogetherAPI.post('deleteTrip',{id},actor());await window.TwogetherV18?.refresh(true);}
      else if(month){await window.TwogetherAPI.post('deleteFinanceMonth',{month:month.dataset.finMonth},actor());document.dispatchEvent(new CustomEvent('twogether:finance-view',{detail:{view:'monthly'}}));}
      else if(wish){wish.click();setTimeout(()=>$('#wishlistMiniBody [data-wish-delete]')?.click(),60);}
      toast('Saved item deleted');clearSelected();
    }catch(e){toast(e.message||'Could not delete item','warn');}},'dev19-danger');g.appendChild(b);panel.appendChild(g);
  }

  function install(){
    if(float)return;
    float=document.createElement('div');float.className='dev19-float';float.hidden=true;float.innerHTML='<button data-d19-move title="Drag anywhere">↕</button><button data-d19-edit title="Edit">✎</button><button data-d19-icon title="Icon">✦</button><button data-d19-copy title="Duplicate">⧉</button><button data-d19-hide title="Hide in DEV">×</button>';document.body.appendChild(float);
    inspector=document.createElement('aside');inspector.className='dev19-inspector';inspector.hidden=true;inspector.innerHTML='<div class="dev19-head"><div class="dev19-head-row"><div><h3>Dev Playground</h3><p>Customize and experiment in real time.</p></div><button type="button" data-d19-close>×</button></div><div class="dev19-tabs"><button data-tab="layout" class="active">Layout</button><button data-tab="style">Style</button><button data-tab="content">Content</button><button data-tab="icon">Icon</button></div></div><div class="dev19-panel"></div>';document.body.appendChild(inspector);
    bottom=document.createElement('div');bottom.className='dev19-bottom';bottom.hidden=true;bottom.innerHTML='<button data-d19-text>＋ Text</button><button data-d19-block>＋ Block</button><button data-d19-undo>↶ Undo</button><button data-d19-redo>↷ Redo</button><button data-d19-reset>Reset</button><button data-d19-exit>Exit DEV</button>';document.body.appendChild(bottom);
    $('[data-d19-edit]',float).onclick=()=>setSelected(hovered,true);$('[data-d19-icon]',float).onclick=()=>{setSelected(hovered,true);tab='icon';renderInspector();};$('[data-d19-copy]',float).onclick=()=>{setSelected(hovered,false);duplicate();};$('[data-d19-hide]',float).onclick=()=>{setSelected(hovered,false);patchSelected({hidden:true});clearSelected();};$('[data-d19-move]',float).addEventListener('pointerdown',startDrag);
    $('[data-d19-close]',inspector).onclick=()=>inspector.hidden=true;$$('.dev19-tabs button',inspector).forEach(b=>b.onclick=()=>{tab=b.dataset.tab;renderInspector();});
    $('[data-d19-text]',bottom).onclick=()=>addBlock('text');$('[data-d19-block]',bottom).onclick=()=>addBlock('section');$('[data-d19-undo]',bottom).onclick=undo;$('[data-d19-redo]',bottom).onclick=redo;$('[data-d19-reset]',bottom).onclick=()=>{if(confirm('Reset your DEV playground? Ctrl+Z can undo the reset.'))reset();};$('[data-d19-exit]',bottom).onclick=exit;
  }

  function startDrag(e){
    if(!hovered)return;e.preventDefault();setSelected(hovered,false);const node=selected,key=selector(node),p=patches[key]||{},sx=e.clientX,sy=e.clientY,bx=Number(p.x||0),by=Number(p.y||0);saveBase(node);past.push(clone(patches));past=past.slice(-100);future=[];drag={node,key,sx,sy,bx,by,x:bx,y:by};e.currentTarget.setPointerCapture?.(e.pointerId);
    const move=ev=>{if(!drag)return;drag.x=bx+ev.clientX-sx;drag.y=by+ev.clientY-sy;node.style.position='relative';node.style.transform=`translate(${drag.x}px, ${drag.y}px)`;node.style.zIndex='4';positionFloat();};
    const end=ev=>{e.currentTarget.removeEventListener('pointermove',move);e.currentTarget.removeEventListener('pointerup',end);if(!drag)return;const d=drag;drag=null;const old=patches[key]||{};patches[key]={...old,x:d.x,y:d.y,style:{...(old.style||{}),position:'relative',transform:`translate(${d.x}px, ${d.y}px)`,'z-index':'4'}};persist();restoreBase();apply();renderInspector();emit();};
    e.currentTarget.addEventListener('pointermove',move);e.currentTarget.addEventListener('pointerup',end);
  }

  function enter(){if(active||!actor())return;install();active=true;document.body.classList.add('dev-v19');bottom.hidden=false;inspector.hidden=false;apply();renderInspector();emit();}
  function exit(){if(!active)return;restoreBase();active=false;document.body.classList.remove('dev-v19');hovered?.classList.remove('dev19-hover');selected?.classList.remove('dev19-selected');hovered=selected=null;float.hidden=true;inspector.hidden=true;bottom.hidden=true;emit();}

  document.addEventListener('DOMContentLoaded',install);
  document.addEventListener('pointerover',e=>{if(!active)return;const el=candidate(e.target);if(el)setHover(el);},true);
  document.addEventListener('pointermove',()=>{if(active&&!drag)positionFloat();},{passive:true});
  window.addEventListener('scroll',()=>{if(active)positionFloat();},{passive:true});window.addEventListener('resize',()=>{if(active)positionFloat();},{passive:true});
  document.addEventListener('click',e=>{if(!active||e.target.closest('.dev19-float,.dev19-inspector,.dev19-bottom'))return;if(e.altKey){e.preventDefault();e.stopImmediatePropagation();setSelected(candidate(e.target),true);}},true);
  document.addEventListener('keydown',e=>{if(!active)return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();}else if(e.key==='Escape'&&!inspector.hidden){inspector.hidden=true;}},true);
  document.addEventListener('twogether:v18-rendered',()=>{if(active){restoreBase();apply();}});

  window.TwogetherDevV18={enter,exit,undo,redo,reset,get active(){return active;},get selected(){return selected;}};
})();
