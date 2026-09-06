(() => {
'use strict';

const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const KEY='twogether_dev_direct_v22c';
const LEGACY_KEY='twogether_dev_playground_v22b';
const MIN_TRACK=42;
let state={free:{},styles:{},tables:{},flex:{}};
let session=new Map(),drag=null,splitDrag=null,layer=null,currentLayout=null,observer=null,scheduled=false,wrapped=false;

try{const saved=JSON.parse(localStorage.getItem(KEY)||'{}');state={free:saved.free||{},styles:saved.styles||{},tables:saved.tables||{},flex:saved.flex||{}};}catch{}
const clone=v=>JSON.parse(JSON.stringify(v));
const active=()=>document.body.classList.contains('dev-v22')&&!!window.TwogetherDevV22?.active;
const esc=v=>window.CSS?.escape?CSS.escape(String(v)):String(v).replace(/[^\w-]/g,'\\$&');
function selector(el){
  if(!el)return'';
  if(el===document.body)return'body';
  if(el.id)return'#'+esc(el.id);
  for(const a of ['data-current-plan','data-current-trip','data-open-trip','data-fin-month','data-fin-view','data-sheet','data-wish-index','data-dev22b-added']){
    if(el.hasAttribute?.(a))return`[${a}="${esc(el.getAttribute(a))}"]`;
  }
  const p=el.parentElement;if(!p)return'';
  const same=[...p.children].filter(x=>x.tagName===el.tagName);
  return `${selector(p)}>${el.tagName.toLowerCase()}:nth-of-type(${same.indexOf(el)+1})`;
}
function resolve(k){try{return document.querySelector(k)}catch{return null}}
function save(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch{}}
function toast(msg,type='ok'){
  const el=$('#toast');if(!el)return;
  el.textContent=msg;el.className='toast show '+type;clearTimeout(el._v22c);el._v22c=setTimeout(()=>el.className='toast',2100);
}
function remember(el){
  if(!el||session.has(el))return;
  session.set(el,{style:el.getAttribute('style'),parent:el.parentNode,next:el.nextSibling});
}
function restoreSession(){
  if(drag)finishFreeDrag(null,true);
  if(splitDrag)finishSplitDrag(null,true);
  for(const [el,s] of [...session.entries()].reverse()){
    if(!el?.isConnected||!s.parent?.isConnected)continue;
    if(el.parentNode!==s.parent){
      if(s.next&&s.next.parentNode===s.parent)s.parent.insertBefore(el,s.next);else s.parent.appendChild(el);
    }
  }
  for(const [el,s] of session){
    if(!el?.isConnected)continue;
    if(s.style==null)el.removeAttribute('style');else el.setAttribute('style',s.style);
    el.classList.remove('dev22c-floating','dev22c-layout-target','dev22c-custom-separators');
    el.removeAttribute('data-dev22c-floating');
  }
  session.clear();
  currentLayout?.classList.remove('dev22c-layout-target','dev22c-custom-separators');
  currentLayout=null;
  layer?.replaceChildren();
}
function applyStyleMap(k,map){
  const el=resolve(k);if(!el)return;
  remember(el);Object.entries(map||{}).forEach(([n,v])=>el.style.setProperty(n,String(v)));
}
function applyFree(k,f){
  const el=resolve(k);if(!el)return;
  remember(el);
  if(el.parentNode!==document.body)document.body.appendChild(el);
  el.classList.add('dev22c-floating');el.dataset.dev22cFloating='1';
  Object.assign(el.style,{position:'absolute',left:`${Math.max(0,Number(f.x)||0)}px`,top:`${Math.max(0,Number(f.y)||0)}px`,width:f.w?`${Math.max(40,Number(f.w))}px`:el.style.width,height:f.h?`${Math.max(28,Number(f.h))}px`:el.style.height,margin:'0',zIndex:String(f.z||22000)});
}
function tableRows(table){return [...table.rows].filter(r=>r.getClientRects().length)}
function applyTable(k,t){
  const table=resolve(k);if(!table||table.tagName!=='TABLE')return;
  remember(table);table.style.tableLayout='fixed';if(t.width)table.style.width=t.width+'px';
  const rows=tableRows(table);
  rows.forEach((row,ri)=>{
    remember(row);if(t.rows?.[ri])row.style.height=t.rows[ri]+'px';
    [...row.cells].forEach((cell,ci)=>{remember(cell);if(t.cols?.[ci])cell.style.width=t.cols[ci]+'px';});
  });
}
function applyFlex(k,f){
  const el=resolve(k);if(!el)return;
  remember(el);const children=[...el.children].filter(x=>x.getClientRects().length&&!x.closest('.dev22c-divider-layer'));
  children.forEach((ch,i)=>{
    if(!f.sizes?.[i])return;remember(ch);
    ch.style.flex=`0 0 ${f.sizes[i]}px`;
    if(f.axis==='x')ch.style.width=f.sizes[i]+'px';else ch.style.height=f.sizes[i]+'px';
  });
}
function applyAll(){
  if(!active())return;
  Object.entries(state.styles).forEach(([k,m])=>applyStyleMap(k,m));
  Object.entries(state.tables).forEach(([k,t])=>applyTable(k,t));
  Object.entries(state.flex).forEach(([k,f])=>applyFlex(k,f));
  Object.entries(state.free).forEach(([k,f])=>applyFree(k,f));
  scheduleDividers();
}

function migrateLegacyFree(){
  try{
    const raw=localStorage.getItem(LEGACY_KEY);if(!raw)return;
    const data=JSON.parse(raw),patches=data?.st?.patches||{};let changed=false;
    Object.entries(patches).forEach(([k,p])=>{
      if(!p?.free)return;
      if(!state.free[k])state.free[k]=clone(p.free);
      delete p.free;changed=true;
    });
    if(changed){localStorage.setItem(LEGACY_KEY,JSON.stringify(data));save();}
  }catch{}
}

function scoreRect(r,b){
  return Math.abs(r.left-b.left)+Math.abs(r.top-b.top)+Math.abs(r.right-b.right)+Math.abs(r.bottom-b.bottom)+Math.abs(r.width-b.width)*.3+Math.abs(r.height-b.height)*.3;
}
function selectedTarget(){
  const box=$('.dev22-selection:not([hidden])');if(!box)return null;
  const b=box.getBoundingClientRect();if(!b.width||!b.height)return null;
  const pts=[[b.left+b.width/2,b.top+b.height/2],[b.left+Math.min(12,b.width/3),b.top+Math.min(12,b.height/3)],[b.right-Math.min(12,b.width/3),b.bottom-Math.min(12,b.height/3)]];
  const set=new Set();
  pts.forEach(([x,y])=>document.elementsFromPoint(Math.max(1,Math.min(innerWidth-1,x)),Math.max(1,Math.min(innerHeight-1,y))).forEach(el=>{
    for(let n=el;n&&n!==document.documentElement;n=n.parentElement){
      if(n===document.body)break;
      if(n.closest?.('.dev22-selection,.dev22-inspector,.dev22-toolbar,.dev22-context,.dev22c-divider-layer,.dev22-note,.identity-modal'))continue;
      set.add(n);
    }
  }));
  $$('[data-dev22c-floating="1"]').forEach(el=>set.add(el));
  let best=null,bestScore=Infinity;
  for(const el of set){const r=el.getBoundingClientRect();if(!r.width||!r.height)continue;const s=scoreRect(r,b);if(s<bestScore){best=el;bestScore=s;}}
  return bestScore<Math.max(28,(b.width+b.height)*.08)?best:null;
}
function syncSelection(el){
  const box=$('.dev22-selection:not([hidden])');if(!box||!el?.isConnected)return;
  const r=el.getBoundingClientRect();Object.assign(box.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});
}

function startFreeDrag(e){
  if(!active()||e.button!==0)return;
  const el=selectedTarget();if(!el)return;
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
  const k=selector(el),r=el.getBoundingClientRect();remember(el);
  const ghost=document.createElement('div');ghost.className='dev22-origin-ghost dev22c-origin';Object.assign(ghost.style,{left:r.left+scrollX+'px',top:r.top+scrollY+'px',width:r.width+'px',height:r.height+'px'});document.body.appendChild(ghost);
  if(el.parentNode!==document.body)document.body.appendChild(el);
  el.classList.add('dev22-dragging','dev22c-floating');el.dataset.dev22cFloating='1';
  Object.assign(el.style,{position:'absolute',left:r.left+scrollX+'px',top:r.top+scrollY+'px',width:r.width+'px',height:r.height+'px',margin:'0',zIndex:'29970'});
  drag={id:e.pointerId,el,k,ghost,dx:e.pageX-(r.left+scrollX),dy:e.pageY-(r.top+scrollY),w:r.width,h:r.height};
  syncSelection(el);scheduleDividers();
}
function moveFreeDrag(e){
  if(!drag||e.pointerId!==drag.id)return;
  e.preventDefault();
  const x=Math.max(0,e.pageX-drag.dx),y=Math.max(0,e.pageY-drag.dy);
  drag.el.style.left=x+'px';drag.el.style.top=y+'px';
  const edge=55;if(e.clientY<edge)scrollBy(0,-16);else if(innerHeight-e.clientY<edge)scrollBy(0,16);
  syncSelection(drag.el);scheduleDividers();
}
function finishFreeDrag(e,cancel=false){
  if(!drag||(!cancel&&e&&e.pointerId!==drag.id))return;
  const d=drag;drag=null;
  d.el.classList.remove('dev22-dragging');d.ghost?.remove();
  if(cancel)return;
  const r=d.el.getBoundingClientRect();state.free[d.k]={x:parseFloat(d.el.style.left)||r.left+scrollX,y:parseFloat(d.el.style.top)||r.top+scrollY,w:r.width||d.w,h:r.height||d.h,z:22000};save();syncSelection(d.el);scheduleDividers();toast('Free position saved in DEV');
}
function clearDirectFor(el){
  if(!el)return;const k=selector(el);delete state.free[k];delete state.styles[k];delete state.tables[k];delete state.flex[k];save();
  const snap=session.get(el);if(snap){if(el.parentNode!==snap.parent&&snap.parent?.isConnected){if(snap.next&&snap.next.parentNode===snap.parent)snap.parent.insertBefore(el,snap.next);else snap.parent.appendChild(el)}if(snap.style==null)el.removeAttribute('style');else el.setAttribute('style',snap.style);session.delete(el);}
  el.classList.remove('dev22c-floating');el.removeAttribute('data-dev22c-floating');syncSelection(el);scheduleDividers();
}

function ensureLayer(){
  if(layer?.isConnected)return layer;
  layer=document.createElement('div');layer.className='dev22c-divider-layer';document.body.appendChild(layer);return layer;
}
function pxTracks(v){const out=[];String(v||'').replace(/(-?\d+(?:\.\d+)?)px/g,(_,n)=>{out.push(+n);return _});return out.filter(n=>Number.isFinite(n)&&n>0)}
function visibleChildren(el){return [...el.children].filter(x=>x.getClientRects().length&&!x.matches('.dev22c-divider-layer,.dev22-selection,.dev22-context,.dev22-inspector,.dev22-toolbar'))}
function layoutTarget(el){
  if(!el)return null;
  const table=el.closest?.('table');if(table&&table.getClientRects().length)return table;
  for(let n=el,depth=0;n&&n!==document.body&&depth<5;n=n.parentElement,depth++){
    const cs=getComputedStyle(n),kids=visibleChildren(n);
    if((cs.display==='grid'||cs.display==='inline-grid')&&pxTracks(cs.gridTemplateColumns).length>1)return n;
    if((cs.display==='flex'||cs.display==='inline-flex')&&kids.length>1)return n;
  }
  return null;
}
function linesOpen(){return !!$('.dev22-inspector:not([hidden]) .dev22-tabs [data-tab="lines"].active')}
function makeDivider(meta){
  const b=document.createElement('button');b.type='button';b.className=`dev22c-divider ${meta.axis==='x'?'col':'row'}`;b.setAttribute('aria-label',meta.axis==='x'?'Drag column divider':'Drag row divider');
  if(meta.axis==='x')Object.assign(b.style,{left:(meta.pos-6)+'px',top:meta.start+'px',width:'12px',height:Math.max(16,meta.length)+'px'});
  else Object.assign(b.style,{left:meta.start+'px',top:(meta.pos-6)+'px',width:Math.max(16,meta.length)+'px',height:'12px'});
  const line=document.createElement('span');b.appendChild(line);b.onpointerdown=e=>startSplitDrag(e,meta);ensureLayer().appendChild(b);
}
function markLayout(el){
  if(currentLayout&&currentLayout!==el)currentLayout.classList.remove('dev22c-layout-target','dev22c-custom-separators');
  currentLayout=el;if(!el)return;
  el.classList.add('dev22c-layout-target');
  const sw=el.style.getPropertyValue('--dev-separator-width').trim();el.classList.toggle('dev22c-custom-separators',!!sw&&sw!=='0'&&sw!=='0px');
}
function renderGridDividers(el){
  const cs=getComputedStyle(el),r=el.getBoundingClientRect(),cols=pxTracks(cs.gridTemplateColumns),rows=pxTracks(cs.gridTemplateRows),gapX=parseFloat(cs.columnGap)||0,gapY=parseFloat(cs.rowGap)||0;
  const left=r.left+(parseFloat(cs.borderLeftWidth)||0)+(parseFloat(cs.paddingLeft)||0),top=r.top+(parseFloat(cs.borderTopWidth)||0)+(parseFloat(cs.paddingTop)||0);
  const contentH=Math.max(10,r.height-(parseFloat(cs.borderTopWidth)||0)-(parseFloat(cs.borderBottomWidth)||0)-(parseFloat(cs.paddingTop)||0)-(parseFloat(cs.paddingBottom)||0));
  const contentW=Math.max(10,r.width-(parseFloat(cs.borderLeftWidth)||0)-(parseFloat(cs.borderRightWidth)||0)-(parseFloat(cs.paddingLeft)||0)-(parseFloat(cs.paddingRight)||0));
  let x=left;for(let i=0;i<cols.length-1;i++){x+=cols[i];makeDivider({type:'grid',axis:'x',target:el,index:i,pos:x+gapX/2,start:top,length:contentH,sizes:cols,gap:gapX});x+=gapX;}
  let y=top;for(let i=0;i<rows.length-1;i++){y+=rows[i];makeDivider({type:'grid',axis:'y',target:el,index:i,pos:y+gapY/2,start:left,length:contentW,sizes:rows,gap:gapY});y+=gapY;}
}
function renderTableDividers(table){
  const r=table.getBoundingClientRect(),rows=tableRows(table);if(!rows.length)return;
  const cells=[...rows[0].cells].filter(c=>c.getClientRects().length);
  for(let i=0;i<cells.length-1;i++){const a=cells[i].getBoundingClientRect(),b=cells[i+1].getBoundingClientRect();makeDivider({type:'table',axis:'x',target:table,index:i,pos:(a.right+b.left)/2,start:r.top,length:r.height});}
  for(let i=0;i<rows.length-1;i++){const a=rows[i].getBoundingClientRect(),b=rows[i+1].getBoundingClientRect();makeDivider({type:'table',axis:'y',target:table,index:i,pos:(a.bottom+b.top)/2,start:r.left,length:r.width});}
}
function renderFlexDividers(el){
  const cs=getComputedStyle(el),kids=visibleChildren(el),r=el.getBoundingClientRect(),vertical=cs.flexDirection.startsWith('column');
  for(let i=0;i<kids.length-1;i++){
    const a=kids[i].getBoundingClientRect(),b=kids[i+1].getBoundingClientRect();
    if(vertical)makeDivider({type:'flex',axis:'y',target:el,index:i,pos:(a.bottom+b.top)/2,start:r.left,length:r.width});
    else makeDivider({type:'flex',axis:'x',target:el,index:i,pos:(a.right+b.left)/2,start:r.top,length:r.height});
  }
}
function updateDividers(){
  scheduled=false;ensureLayer().replaceChildren();
  if(!active()||!linesOpen()){markLayout(null);document.body.classList.remove('dev22c-lines-on');return;}
  const target=layoutTarget(selectedTarget());if(!target){markLayout(null);document.body.classList.remove('dev22c-lines-on');return;}
  markLayout(target);document.body.classList.add('dev22c-lines-on');
  const cs=getComputedStyle(target);
  if(target.tagName==='TABLE')renderTableDividers(target);else if(cs.display.includes('grid'))renderGridDividers(target);else if(cs.display.includes('flex'))renderFlexDividers(target);
}
function scheduleDividers(){if(scheduled)return;scheduled=true;requestAnimationFrame(updateDividers)}

function startSplitDrag(e,meta){
  if(!active()||e.button!==0)return;e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
  const target=meta.target,k=selector(target);remember(target);
  if(meta.type==='grid'){
    const cs=getComputedStyle(target),sizes=meta.axis==='x'?pxTracks(cs.gridTemplateColumns):pxTracks(cs.gridTemplateRows);
    splitDrag={id:e.pointerId,type:'grid',axis:meta.axis,target,k,index:meta.index,start:e[meta.axis==='x'?'clientX':'clientY'],sizes};
  }else if(meta.type==='table'){
    const rows=tableRows(target),cols=rows.length?[...rows[0].cells].map(c=>c.getBoundingClientRect().width):[];
    const heights=rows.map(r=>r.getBoundingClientRect().height);rows.forEach(r=>{remember(r);[...r.cells].forEach(remember)});
    splitDrag={id:e.pointerId,type:'table',axis:meta.axis,target,k,index:meta.index,start:e[meta.axis==='x'?'clientX':'clientY'],sizes:meta.axis==='x'?cols:heights,width:target.getBoundingClientRect().width};
  }else{
    const kids=visibleChildren(target),sizes=kids.map(ch=>{const r=ch.getBoundingClientRect();return meta.axis==='x'?r.width:r.height});kids.forEach(remember);
    splitDrag={id:e.pointerId,type:'flex',axis:meta.axis,target,k,index:meta.index,start:e[meta.axis==='x'?'clientX':'clientY'],sizes,kids};
  }
  document.body.classList.add('dev22c-splitting');
}
function adjustedPair(base,i,delta){
  const sizes=base.slice(),sum=sizes[i]+sizes[i+1];let a=Math.max(MIN_TRACK,Math.min(sum-MIN_TRACK,sizes[i]+delta));sizes[i]=a;sizes[i+1]=sum-a;return sizes;
}
function moveSplitDrag(e){
  if(!splitDrag||e.pointerId!==splitDrag.id)return;e.preventDefault();
  const d=splitDrag,coord=e[d.axis==='x'?'clientX':'clientY'],sizes=adjustedPair(d.sizes,d.index,coord-d.start);
  d.live=sizes;
  if(d.type==='grid'){
    if(d.axis==='x')d.target.style.gridTemplateColumns=sizes.map(n=>n.toFixed(1)+'px').join(' ');else d.target.style.gridTemplateRows=sizes.map(n=>n.toFixed(1)+'px').join(' ');
  }else if(d.type==='table'){
    const rows=tableRows(d.target);d.target.style.tableLayout='fixed';d.target.style.width=d.width+'px';
    if(d.axis==='x')rows.forEach(r=>[...r.cells].forEach((c,i)=>{if(sizes[i])c.style.width=sizes[i].toFixed(1)+'px'}));
    else rows.forEach((r,i)=>{if(sizes[i])r.style.height=sizes[i].toFixed(1)+'px'});
  }else{
    d.kids.forEach((ch,i)=>{if(!sizes[i])return;ch.style.flex=`0 0 ${sizes[i].toFixed(1)}px`;if(d.axis==='x')ch.style.width=sizes[i].toFixed(1)+'px';else ch.style.height=sizes[i].toFixed(1)+'px';});
  }
  syncSelection(selectedTarget());scheduleDividers();
}
function finishSplitDrag(e,cancel=false){
  if(!splitDrag||(!cancel&&e&&e.pointerId!==splitDrag.id))return;
  const d=splitDrag;splitDrag=null;document.body.classList.remove('dev22c-splitting');
  if(cancel)return;
  const sizes=d.live||d.sizes;
  if(d.type==='grid'){
    state.styles[d.k]=state.styles[d.k]||{};state.styles[d.k][d.axis==='x'?'grid-template-columns':'grid-template-rows']=sizes.map(n=>n.toFixed(1)+'px').join(' ');
  }else if(d.type==='table'){
    const old=state.tables[d.k]||{};state.tables[d.k]={...old,width:d.width,cols:d.axis==='x'?sizes:(old.cols||[]),rows:d.axis==='y'?sizes:(old.rows||[])};
  }else state.flex[d.k]={axis:d.axis,sizes};
  save();scheduleDividers();toast(d.axis==='x'?'Column divider moved':'Row divider moved');
}

function handleInspectorAction(e){
  if(!active())return;
  const btn=e.target.closest?.('button');if(!btn)return;
  const txt=(btn.textContent||'').trim().toLowerCase();
  if(btn.matches('[data-reset]')){state={free:{},styles:{},tables:{},flex:{}};save();restoreSession();setTimeout(applyAll,0);return;}
  const el=selectedTarget();if(!el)return;
  if(txt.includes('return to normal flow')||txt.includes('reset selected'))clearDirectFor(el);
  if(txt.includes('center on screen'))setTimeout(()=>{const target=selectedTarget()||el,r=target.getBoundingClientRect(),k=selector(target);remember(target);state.free[k]={x:scrollX+(innerWidth-r.width)/2,y:scrollY+(innerHeight-r.height)/2,w:r.width,h:r.height,z:22000};save();applyFree(k,state.free[k]);syncSelection(target);},0);
}

function wrapApi(){
  const api=window.TwogetherDevV22;if(!api||wrapped)return false;wrapped=true;
  const enter=api.enter?.bind(api),exit=api.exit?.bind(api),reset=api.reset?.bind(api);
  if(enter)api.enter=function(){const out=enter();setTimeout(()=>{migrateLegacyFree();applyAll();},0);return out};
  if(exit)api.exit=function(){restoreSession();return exit()};
  if(reset)api.reset=function(){state={free:{},styles:{},tables:{},flex:{}};save();restoreSession();const out=reset();setTimeout(applyAll,0);return out};
  return true;
}
function install(){
  migrateLegacyFree();wrapApi();ensureLayer();
  document.addEventListener('pointerdown',e=>{if(active()&&e.target.closest?.('.dev22-move-handle'))startFreeDrag(e)},true);
  document.addEventListener('pointermove',e=>{moveFreeDrag(e);moveSplitDrag(e)},true);
  document.addEventListener('pointerup',e=>{finishFreeDrag(e);finishSplitDrag(e)},true);
  document.addEventListener('pointercancel',e=>{finishFreeDrag(e);finishSplitDrag(e)},true);
  document.addEventListener('click',e=>{
    if(active()&&(e.target.closest?.('.dev22-exit')||e.target.closest?.('#twDevToggle')))restoreSession();
    handleInspectorAction(e);setTimeout(scheduleDividers,0);
  },true);
  document.addEventListener('twogether:dev-changed',()=>{
    wrapApi();migrateLegacyFree();
    if(active())setTimeout(applyAll,0);else{layer?.replaceChildren();document.body.classList.remove('dev22c-lines-on','dev22c-splitting');}
  });
  window.addEventListener('scroll',scheduleDividers,{passive:true});window.addEventListener('resize',scheduleDividers,{passive:true});
  observer=new MutationObserver(records=>{
    if(records.some(r=>r.target?.classList?.contains('dev22-selection')||r.target?.closest?.('.dev22-inspector')||r.type==='childList'))scheduleDividers();
  });
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['style','class','hidden']});
  if(active())setTimeout(applyAll,0);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
