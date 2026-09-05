(() => {
  'use strict';
  const KEY='twogether_dev_playground_v18';
  const ACTORS=['Principessa','Principe'];
  const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
  const clone=x=>JSON.parse(JSON.stringify(x));
  let active=false,selected=null,patches={},past=[],future=[],snapshots=new Map(),tools=null,editor=null,strip=null,drag=null;
  try{const saved=JSON.parse(localStorage.getItem(KEY)||'{}');patches=saved.patches||{};past=saved.past||[];future=saved.future||[];}catch{}

  function actor(){const a=document.body.dataset.actor||'';return ACTORS.includes(a)?a:'';}
  function persist(){try{localStorage.setItem(KEY,JSON.stringify({patches,past:past.slice(-60),future:future.slice(-60)}));}catch{}}
  function emit(){document.dispatchEvent(new CustomEvent('twogether:dev-changed'));}
  function pushChange(fn){past.push(clone(patches));past=past.slice(-60);future=[];restore();fn();persist();apply();emit();}
  function undo(){if(!past.length)return;restore();future.push(clone(patches));patches=past.pop();persist();apply();emit();}
  function redo(){if(!future.length)return;restore();past.push(clone(patches));patches=future.pop();persist();apply();emit();}
  function reset(){pushChange(()=>{patches={};});}

  function selector(el){
    if(!el)return '';
    if(el===document.body)return 'body';
    for(const attr of ['data-current-plan','data-current-trip','data-open-trip','data-fin-month','data-wish-index','data-dev-v18-added'])if(el.hasAttribute?.(attr))return `[${attr}="${CSS.escape(el.getAttribute(attr))}"]`;
    if(el.id)return '#'+CSS.escape(el.id);
    const parent=el.parentElement;if(!parent)return '';
    const idx=[...parent.children].indexOf(el)+1;return `${selector(parent)} > ${el.tagName.toLowerCase()}:nth-child(${idx})`;
  }

  function saveSnapshot(el,allowText=false){if(!snapshots.has(el))snapshots.set(el,{style:el.getAttribute('style'),text:allowText?el.textContent:null});}
  function restore(){
    for(const [el,base] of snapshots){if(!el.isConnected)continue;base.style==null?el.removeAttribute('style'):el.setAttribute('style',base.style);if(base.text!=null)el.textContent=base.text;}
    snapshots.clear();$$('[data-dev-v18-added]').forEach(el=>el.remove());
  }

  function apply(){
    if(!active)return;
    for(const [key,p] of Object.entries(patches)){
      let el=null;try{el=document.querySelector(key);}catch{}
      if(p.add&&!el){const parent=document.querySelector(p.parent)||$('.sheet.active')||$('main');if(!parent)continue;el=document.createElement(p.tag||'div');el.dataset.devV18Added=p.id;el.className='dev-v18-added';el.textContent=p.text||'Test text';parent.appendChild(el);}
      if(!el)continue;const allowText=p.text!==undefined&&el.children.length===0;saveSnapshot(el,allowText);
      if(p.text!==undefined&&el.children.length===0)el.textContent=p.text;
      for(const [prop,val] of Object.entries(p.style||{}))el.style.setProperty(prop,val);
      if(p.hidden)el.style.setProperty('display','none','important');
    }
    decorateDataDeletes();
  }

  function patchSelected(part){
    if(!selected)return;const key=selector(selected);if(!key)return;
    pushChange(()=>{const prev=patches[key]||{};patches[key]={...prev,...part,style:{...(prev.style||{}),...(part.style||{})}};});
  }

  function rgbToHex(value){
    if(/^#[0-9a-f]{6}$/i.test(value||''))return value;const m=String(value||'').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);if(!m)return '#ffffff';return '#'+[m[1],m[2],m[3]].map(x=>Number(x).toString(16).padStart(2,'0')).join('');
  }

  function addBlock(kind){
    const parent=selected?.closest('.finance-subview.active,.sheet.active,section')||$('.finance-subview.active')||$('.sheet.active')||$('main');if(!parent)return;
    const id=crypto.randomUUID(),key=`[data-dev-v18-added="${id}"]`;
    pushChange(()=>{patches[key]={add:true,id,parent:selector(parent),tag:kind==='section'?'section':'div',text:kind==='category'?'New test category':kind==='section'?'New test section':'Your test text',style:{padding:'18px','border-radius':'14px',border:'1px dashed #b46b6b',margin:'10px 0',background:'#fffafa'}};});
  }

  function duplicateSelected(){
    if(!selected)return;const text=selected.innerText||selected.textContent||'Copy';addBlock('text');const key=Object.keys(patches).at(-1);if(key)pushChange(()=>{patches[key].text=text;});
  }

  function moveSelected(dx,dy){if(!selected)return;const key=selector(selected),p=patches[key]||{};const x=Number(p.x||0)+dx,y=Number(p.y||0)+dy;patchSelected({x,y,style:{position:'relative',transform:`translate(${x}px, ${y}px)`,'z-index':'2'}});}

  function moveSibling(dir){
    if(!selected?.parentElement)return;const parent=selected.parentElement;const siblings=[...parent.children].filter(x=>!x.matches('.dev-v18-tools,.dev-v18-editor,.dev-v18-strip'));const idx=siblings.indexOf(selected);const target=siblings[idx+dir];if(!target)return;
    if(dir<0)parent.insertBefore(selected,target);else parent.insertBefore(target,selected);
    const key=selector(selected);pushChange(()=>{const prev=patches[key]||{};patches[key]={...prev,style:{...(prev.style||{}),order:String(idx+dir)}};});
  }

  function setSelected(el){if(selected&&selected!==el)selected.classList.remove('dev-v18-target');selected=el;if(selected)selected.classList.add('dev-v18-target');positionTools();}
  function clearSelected(){selected?.classList.remove('dev-v18-target');selected=null;if(tools)tools.hidden=true;}
  function positionTools(){if(!active||!selected||!tools)return;const r=selected.getBoundingClientRect();tools.style.left=Math.max(4,Math.min(innerWidth-tools.offsetWidth-4,r.right-74))+'px';tools.style.top=Math.max(4,Math.min(innerHeight-38,r.top+4))+'px';tools.hidden=false;}

  function editorField(label,type,value,onchange,options=[]){const wrap=document.createElement('label');wrap.textContent=label;const input=document.createElement(type==='select'?'select':type==='textarea'?'textarea':'input');if(type!=='select'&&type!=='textarea')input.type=type;if(type==='select')options.forEach(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;input.appendChild(o);});input.value=value;input.addEventListener(type==='color'?'input':'change',()=>onchange(input.value));wrap.appendChild(input);editor.appendChild(wrap);return input;}

  function openEditor(){
    if(!selected||!editor)return;editor.replaceChildren();editor.hidden=false;const computed=getComputedStyle(selected);const title=document.createElement('h3');title.textContent='Edit this element';editor.appendChild(title);
    if(selected.children.length===0)editorField('Text','textarea',selected.textContent,v=>patchSelected({text:v}));
    editorField('Text colour','color',rgbToHex(computed.color),v=>patchSelected({style:{color:v}}));
    editorField('Background','color',rgbToHex(computed.backgroundColor),v=>patchSelected({style:{'background-color':v}}));
    editorField('Font','select',computed.fontFamily.split(',')[0].replace(/["']/g,'').trim(),v=>patchSelected({style:{'font-family':v}}),[['Crimson Pro','Crimson Pro'],['Georgia','Georgia'],['Arial','Arial'],['Verdana','Verdana'],['Trebuchet MS','Trebuchet MS'],['monospace','Monospace']]);
    editorField('Font size','number',parseFloat(computed.fontSize)||16,v=>patchSelected({style:{'font-size':Math.max(8,Math.min(120,Number(v)||16))+'px'}}));
    editorField('Padding','number',parseFloat(computed.padding)||0,v=>patchSelected({style:{padding:Math.max(0,Number(v)||0)+'px'}}));
    editorField('Corner radius','number',parseFloat(computed.borderRadius)||0,v=>patchSelected({style:{'border-radius':Math.max(0,Number(v)||0)+'px'}}));
    const iconTarget=selected.matches('.pick-icon,.brand-mark,.identity-heart')?selected:selected.querySelector('.pick-icon,.brand-mark,.identity-heart');
    if(iconTarget){const originalSelected=selected;editorField('Icon / symbol','select',iconTarget.textContent.trim(),v=>{selected=iconTarget;patchSelected({text:v});selected=originalSelected;},[['♡','♡ Heart outline'],['♥','♥ Heart'],['♕','♕ Principessa'],['♔','♔ Principe'],['✈','✈ Flight'],['⌂','⌂ Home'],['⛽','⛽ Fuel'],['✦','✦ Spark'],['✓','✓ Check'],['＋','＋ Plus'],['→','→ Arrow'],['☕','☕ Coffee'],['⚑','⚑ Flag'],['♫','♫ Music'],['🌿','🌿 Leaf'],['🌍','🌍 World']]);}
    const actions=document.createElement('div');actions.className='dev-actions';
    const button=(text,fn,cls='')=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.className=cls;b.onclick=fn;actions.appendChild(b);};
    button('Move up',()=>moveSibling(-1));button('Move down',()=>moveSibling(1));button('Duplicate',duplicateSelected);button('Hide in DEV',()=>{patchSelected({hidden:true});editor.hidden=true;clearSelected();},'danger');button('+ Text box',()=>addBlock('text'));button('+ Section',()=>addBlock('section'));button('+ Category',()=>addBlock('category'));button('Edit page background',()=>{setSelected(document.body);openEditor();});button('Close',()=>editor.hidden=true);
    editor.appendChild(actions);
  }

  function installUi(){
    if(tools)return;
    tools=document.createElement('div');tools.className='dev-v18-tools';tools.hidden=true;tools.innerHTML='<button type="button" data-dev-edit title="Edit">⋯</button><button type="button" data-dev-drag title="Drag">↕</button><button type="button" data-dev-hide title="Hide in DEV">×</button>';document.body.appendChild(tools);
    editor=document.createElement('aside');editor.className='dev-v18-editor';editor.hidden=true;document.body.appendChild(editor);
    strip=document.createElement('aside');strip.className='dev-v18-strip';strip.hidden=true;strip.innerHTML='<button type="button" data-dev-undo>Undo</button><button type="button" data-dev-redo>Redo</button><button type="button" data-dev-reset>Reset</button><button type="button" data-dev-text>+ Text</button><button type="button" data-dev-section>+ Section</button><button type="button" data-dev-page>Page</button><button type="button" data-dev-done>Exit DEV</button>';document.body.appendChild(strip);
    $('[data-dev-edit]',tools).onclick=openEditor;$('[data-dev-hide]',tools).onclick=()=>{if(selected){patchSelected({hidden:true});clearSelected();}};
    $('[data-dev-undo]',strip).onclick=undo;$('[data-dev-redo]',strip).onclick=redo;$('[data-dev-reset]',strip).onclick=()=>{if(confirm('Reset the DEV playground? You can undo this with Ctrl+Z.'))reset();};$('[data-dev-text]',strip).onclick=()=>addBlock('text');$('[data-dev-section]',strip).onclick=()=>addBlock('section');$('[data-dev-page]',strip).onclick=()=>{setSelected(document.body);openEditor();};$('[data-dev-done]',strip).onclick=exit;
    $('[data-dev-drag]',tools).addEventListener('pointerdown',startDrag);
  }

  function startDrag(e){
    if(!selected)return;e.preventDefault();const node=selected,key=selector(node),p=patches[key]||{},sx=e.clientX,sy=e.clientY,bx=Number(p.x||0),by=Number(p.y||0);saveSnapshot(node,false);drag={node,key,sx,sy,bx,by,x:bx,y:by};e.target.setPointerCapture?.(e.pointerId);
    const move=ev=>{if(!drag)return;drag.x=bx+ev.clientX-sx;drag.y=by+ev.clientY-sy;node.style.position='relative';node.style.transform=`translate(${drag.x}px, ${drag.y}px)`;node.style.zIndex='2';positionTools();};
    const end=ev=>{e.target.removeEventListener('pointermove',move);e.target.removeEventListener('pointerup',end);if(!drag)return;const {x,y}=drag;drag=null;patchSelected({x,y,style:{position:'relative',transform:`translate(${x}px, ${y}px)`,'z-index':'2'}});};
    e.target.addEventListener('pointermove',move);e.target.addEventListener('pointerup',end);
  }

  function decorateDataDeletes(){
    if(!active)return;
    $$('[data-open-trip],[data-current-trip]').forEach(card=>{if(card.querySelector(':scope > .dev-v18-delete'))return;const id=card.dataset.openTrip||card.dataset.currentTrip;if(!id)return;card.style.position='relative';const b=document.createElement('button');b.type='button';b.className='dev-v18-delete';b.textContent='Delete trip';b.dataset.devRealTrip=id;card.appendChild(b);});
    $$('#financeMonths [data-fin-month]').forEach(btn=>{if(btn.querySelector('.dev-v18-delete'))return;btn.style.position='relative';const b=document.createElement('button');b.type='button';b.className='dev-v18-delete';b.textContent='Delete';b.dataset.devRealMonth=btn.dataset.finMonth;btn.appendChild(b);});
    $$('#financeWishlist tbody tr').forEach(row=>{if(!row.querySelector('[data-wish-index]')||row.querySelector('.dev-v18-delete'))return;row.style.position='relative';const b=document.createElement('button');b.type='button';b.className='dev-v18-delete';b.textContent='Delete';b.dataset.devWishIndex=row.querySelector('[data-wish-index]').dataset.wishIndex;const cell=row.lastElementChild;cell?.appendChild(b);});
    $$('[data-current-plan]').forEach(card=>{if(card.querySelector(':scope > .dev-v18-delete'))return;card.style.position='relative';const b=document.createElement('button');b.type='button';b.className='dev-v18-delete';b.textContent='Hide in DEV';b.dataset.devHidePlan='1';card.appendChild(b);});
  }

  async function handleRealDelete(e){
    const trip=e.target.closest?.('[data-dev-real-trip]');if(trip){e.preventDefault();e.stopImmediatePropagation();if(!confirm('Delete this saved trip permanently?'))return;try{await window.TwogetherAPI.post('deleteTrip',{id:trip.dataset.devRealTrip},actor());await window.TwogetherV18?.refresh(true);toast('Trip deleted');}catch(err){toast(err.message||'Could not delete trip','warn');}return true;}
    const month=e.target.closest?.('[data-dev-real-month]');if(month){e.preventDefault();e.stopImmediatePropagation();if(!confirm('Delete this saved finance month permanently?'))return;try{await window.TwogetherAPI.post('deleteFinanceMonth',{month:month.dataset.devRealMonth},actor());document.dispatchEvent(new CustomEvent('twogether:finance-view',{detail:{view:'monthly'}}));toast('Finance month deleted');}catch(err){toast(err.message||'Could not delete month','warn');}return true;}
    const wish=e.target.closest?.('[data-dev-wish-index]');if(wish){e.preventDefault();e.stopImmediatePropagation();if(!confirm('Delete this wishlist item permanently?'))return;const row=wish.closest('tr');row?.querySelector('[data-wish-index]')?.click();setTimeout(()=>$('#wishlistMiniBody [data-wish-delete]')?.click(),50);return true;}
    const hide=e.target.closest?.('[data-dev-hide-plan]');if(hide){e.preventDefault();e.stopImmediatePropagation();const card=hide.closest('[data-current-plan]');if(card){setSelected(card);patchSelected({hidden:true});clearSelected();}return true;}
    return false;
  }

  function enter(){
    if(active||!actor())return;installUi();active=true;document.body.classList.add('dev-playground');strip.hidden=false;apply();decorateDataDeletes();emit();
  }
  function exit(){
    if(!active)return;restore();active=false;document.body.classList.remove('dev-playground');clearSelected();if(editor)editor.hidden=true;if(strip)strip.hidden=true;$$('.dev-v18-delete').forEach(x=>x.remove());emit();
  }

  document.addEventListener('DOMContentLoaded',()=>{installUi();});
  document.addEventListener('pointerover',e=>{if(!active||e.target.closest('.dev-v18-tools,.dev-v18-editor,.dev-v18-strip,.dev-v18-delete,#identityModal'))return;const el=e.target.closest('h1,h2,h3,p,span,button,article,section,label,td,th,.panel,.wizard-card,.table-card,.finance-current,.wishlist-wrap,main');if(!el||el===tools||el===editor||el===strip)return;setSelected(el);});
  document.addEventListener('click',e=>{if(!active)return;handleRealDelete(e);},true);
  document.addEventListener('keydown',e=>{if(!active||!(e.ctrlKey||e.metaKey))return;const key=e.key.toLowerCase();if(key==='z'){e.preventDefault();e.stopImmediatePropagation();e.shiftKey?redo():undo();}else if(key==='y'){e.preventDefault();redo();}},true);
  document.addEventListener('twogether:v18-rendered',()=>{if(active){apply();decorateDataDeletes();}});
  window.addEventListener('resize',positionTools,{passive:true});window.addEventListener('scroll',positionTools,{passive:true});
  window.TwogetherDevV18={enter,exit,undo,redo,reset,get active(){return active;}};
})();
