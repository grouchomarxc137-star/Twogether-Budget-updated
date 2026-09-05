(() => {
  'use strict';
  const KEY='twogether_dev_playground_v17';
  let active=false,selected=null,patches={},past=[],future=[],originals=new Map(),panel,handle,bar;
  try{const saved=JSON.parse(localStorage.getItem(KEY)||'{}');patches=saved.patches||{};past=saved.past||[];future=saved.future||[];}catch{}
  const clone=x=>JSON.parse(JSON.stringify(x));
  function persist(){try{localStorage.setItem(KEY,JSON.stringify({patches,past:past.slice(-60),future:future.slice(-60)}));}catch{}}
  function change(fn){past.push(clone(patches));past=past.slice(-60);future=[];restore();fn();persist();apply();}
  function undo(){if(!past.length)return;restore();future.push(clone(patches));patches=past.pop();persist();apply();}
  function redo(){if(!future.length)return;restore();past.push(clone(patches));patches=future.pop();persist();apply();}
  function selector(el){
    for(const attr of ['data-current-plan','data-current-trip','data-open-trip','data-fin-month','data-dev-added'])if(el.hasAttribute(attr))return `[${attr}="${CSS.escape(el.getAttribute(attr))}"]`;
    if(el.id)return '#'+CSS.escape(el.id);
    if(el===document.body)return 'body';
    const parent=el.parentElement;if(!parent)return '';
    return selector(parent)+' > '+el.tagName.toLowerCase()+':nth-child('+([...parent.children].indexOf(el)+1)+')';
  }
  function restore(){
    for(const [el,base] of originals){if(!el.isConnected)continue;base.style===null?el.removeAttribute('style'):el.setAttribute('style',base.style);if(base.text!==null)el.textContent=base.text;}
    originals.clear();document.querySelectorAll('[data-dev-added]').forEach(el=>el.remove());
  }
  function apply(){
    if(!active)return;
    for(const [key,p] of Object.entries(patches)){
      let el;try{el=document.querySelector(key);}catch{continue;}
      if(p.add&&!el){const parent=document.querySelector(p.parent)||document.querySelector('main');el=document.createElement(p.tag||'div');el.dataset.devAdded=p.id;el.className='dev-test-block';el.textContent=p.text||'Test text';parent.appendChild(el);}
      if(!el)continue;
      if(!originals.has(el))originals.set(el,{style:el.getAttribute('style'),text:p.text!==undefined&&!p.add?el.textContent:null});
      if(p.text!==undefined&&el.textContent!==p.text)el.textContent=p.text;
      for(const [prop,value] of Object.entries(p.style||{}))el.style.setProperty(prop,value);
      if(p.hidden)el.style.setProperty('display','none','important');
    }
  }
  function editPatch(values){if(!selected)return;const key=selector(selected);change(()=>{patches[key]={...patches[key],...values,style:{...patches[key]?.style,...values.style}};});}
  function add(kind){
    const parent=selected?.closest('section')||document.querySelector('.finance-subview.active')||document.querySelector('.sheet.active')||document.querySelector('main');
    const id=crypto.randomUUID(),key=`[data-dev-added="${id}"]`;
    change(()=>patches[key]={add:true,id,parent:selector(parent),tag:kind==='section'?'section':'div',text:kind==='category'?'New test category':kind==='section'?'New test section':'Your test text',style:{padding:'20px',border:'1px dashed #ad5757'}});
  }
  function openEditor(){
    if(!selected)return;panel.replaceChildren();panel.hidden=false;
    const title=document.createElement('strong');title.textContent='Edit '+selected.tagName.toLowerCase();panel.appendChild(title);
    function field(label,type,value,onchange){const wrap=document.createElement('label');wrap.textContent=label;const input=document.createElement(type==='select'?'select':'input');if(type!=='select')input.type=type;input.value=value;input.addEventListener('change',()=>onchange(input.value));wrap.appendChild(input);panel.appendChild(wrap);return input;}
    const computed=getComputedStyle(selected);
    if(!selected.children.length||selected.hasAttribute('data-dev-added'))field('Text','text',selected.textContent,v=>editPatch({text:v}));
    field('Text colour','color','#5b4545',v=>editPatch({style:{color:v}}));
    field('Background','color','#fffaf5',v=>editPatch({style:{'background-color':v}}));
    field('Font size','number',parseFloat(computed.fontSize),v=>editPatch({style:{'font-size':Math.max(8,Math.min(150,Number(v)))+'px'}}));
    const font=field('Font','select','',v=>editPatch({style:{'font-family':v}}));
    for(const name of ['Crimson Pro','Georgia','Arial','Verdana','monospace']){const o=document.createElement('option');o.value=name;o.textContent=name;font.appendChild(o);}
    const icons=field('Symbol','select','',v=>{if(!selected.children.length)editPatch({text:v});else{const leaf=selected.querySelector('.pick-icon,.brand-mark,span');if(leaf){selected=leaf;editPatch({text:v});}}});
    for(const symbol of ['♡','♥','♕','♔','✈','⌂','☀','☾','✦','✓','＋','☕','⚑','♫','🌿','🌍']){const o=document.createElement('option');o.value=symbol;o.textContent=symbol;icons.appendChild(o);}
    const p=patches[selector(selected)]||{};
    field('Horizontal position (px)','number',p.x||0,v=>move(Number(v),patches[selector(selected)]?.y||0));
    field('Vertical position (px)','number',p.y||0,v=>move(patches[selector(selected)]?.x||0,Number(v)));
    field('Padding (px)','number',parseFloat(computed.padding)||0,v=>editPatch({style:{padding:Math.max(0,Number(v))+'px'}}));
    function button(text,fn){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=fn;panel.appendChild(b);}
    button('Hide in DEV',()=>{editPatch({hidden:true});panel.hidden=true;handle.hidden=true;});
    button('Duplicate as test block',()=>{const text=selected.textContent;add('text');const key=Object.keys(patches).at(-1);change(()=>patches[key].text=text);});
    button('Add text box',()=>add('text'));button('Add section',()=>add('section'));button('Add category',()=>add('category'));
    button('Page background',()=>{selected=document.body;openEditor();});button('Close',()=>panel.hidden=true);
  }
  function move(x,y){editPatch({x,y,style:{position:'relative',translate:`${x}px ${y}px`}});}
  function enter(){
    if(!document.body.dataset.actor)return;active=true;document.body.classList.add('dev-playground');bar.hidden=false;
    const badge=document.querySelector('#loggedUserBadge');badge.textContent='DEV';badge.title='Leave DEV';apply();
  }
  function exit(){if(!active)return;restore();active=false;document.body.classList.remove('dev-playground');bar.hidden=panel.hidden=handle.hidden=true;document.querySelector('#loggedUserBadge').textContent=document.body.dataset.actor;}
  document.addEventListener('DOMContentLoaded',()=>{
    bar=document.createElement('aside');bar.className='dev-bar';bar.hidden=true;
    for(const [label,fn] of [['Undo',undo],['Redo',redo],['Reset',()=>change(()=>patches={})],['Add text',()=>add('text')],['Done',exit]]){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=fn;bar.appendChild(b);}document.body.appendChild(bar);
    panel=document.createElement('aside');panel.className='dev-editor';panel.hidden=true;document.body.appendChild(panel);
    handle=document.createElement('button');handle.className='dev-handle';handle.textContent='⋯';handle.title='Edit or drag this element';handle.hidden=true;document.body.appendChild(handle);handle.onclick=openEditor;
    handle.addEventListener('pointerdown',e=>{if(!selected)return;if(!originals.has(selected))originals.set(selected,{style:selected.getAttribute('style'),text:null});const node=selected,startX=e.clientX,startY=e.clientY,key=selector(node),p=patches[key]||{};handle.setPointerCapture(e.pointerId);let moved=false;
      const drag=ev=>{const dx=ev.clientX-startX,dy=ev.clientY-startY;if(Math.abs(dx)+Math.abs(dy)<5)return;moved=true;node.style.position='relative';node.style.translate=`${(p.x||0)+dx}px ${(p.y||0)+dy}px`;};
      const done=ev=>{handle.removeEventListener('pointermove',drag);handle.removeEventListener('pointerup',done);if(moved){selected=node;move((p.x||0)+ev.clientX-startX,(p.y||0)+ev.clientY-startY);}};handle.addEventListener('pointermove',drag);handle.addEventListener('pointerup',done);
    });
    document.addEventListener('pointerover',e=>{if(!active||!panel.hidden||e.target.closest('.dev-bar,.dev-editor,.dev-handle'))return;const node=e.target.closest('h1,h2,h3,p,span,button,article,section,label,td,main');if(!node||node.closest('#identityModal'))return;selected=node;const r=node.getBoundingClientRect();handle.style.left=Math.max(4,Math.min(innerWidth-40,r.right-25))+'px';handle.style.top=Math.max(4,r.top)+'px';handle.hidden=false;});
    setInterval(()=>{if(active)apply();},1200);
  });
  document.addEventListener('click',e=>{if(e.target.closest('[data-tw-dev]')){e.preventDefault();e.stopImmediatePropagation();active?exit():enter();}},true);
  document.addEventListener('keydown',e=>{if(!active||!(e.ctrlKey||e.metaKey))return;if(e.key.toLowerCase()==='z'){e.preventDefault();e.stopImmediatePropagation();e.shiftKey?redo():undo();}else if(e.key.toLowerCase()==='y'){e.preventDefault();redo();}},true);
  window.TwogetherDev={exit,enter,undo,redo,reset:()=>change(()=>patches={}),get active(){return active;}};
})();
