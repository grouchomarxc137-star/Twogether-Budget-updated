(() => {
  'use strict';

  const CONFIG = window.TOGETHER_BUDGET_CONFIG || {};
  const API_URL = String(CONFIG.appsScriptUrl || '').trim();
  const ACTOR_KEY = 'twogether_actor_v1';
  const ACTORS = ['Principessa','Principe'];
  let items = [];
  let backendVersion = 0;
  let loading = false;

  const $ = (s,r=document) => r.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g,ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const n = v => { const x=Number(String(v ?? '').replace(',','.')); return Number.isFinite(x)?x:0; };
  const money = v => '€' + n(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const uid = () => (globalThis.crypto?.randomUUID?.() || `wish_${Date.now()}_${Math.random().toString(36).slice(2)}`);

  function actor(){
    const current=document.body.dataset.actor||'';
    if(ACTORS.includes(current)) return current;
    try{const saved=localStorage.getItem(ACTOR_KEY)||'';return ACTORS.includes(saved)?saved:'';}catch{return '';}
  }

  function toast(msg,tone='ok'){
    const el=$('#toast'); if(!el) return;
    el.textContent=msg; el.className='toast show '+tone;
    clearTimeout(el._wishT); el._wishT=setTimeout(()=>el.className='toast',2600);
  }

  function jsonp(params={}){
    return new Promise((resolve,reject)=>{
      if(!API_URL) return reject(new Error('Backend URL missing'));
      const cb='__twogether_wish_'+Date.now()+'_'+Math.random().toString(36).slice(2);
      const script=document.createElement('script');
      const timer=setTimeout(()=>done(new Error('Sync timed out')),10000);
      function done(err,data){clearTimeout(timer);try{delete window[cb];}catch{}script.remove();err?reject(err):resolve(data);}
      window[cb]=data=>done(null,data);
      const q=new URLSearchParams({...params,callback:cb,_:String(Date.now())});
      script.src=API_URL+(API_URL.includes('?')?'&':'?')+q.toString();
      script.onerror=()=>done(new Error('Could not reach Apps Script'));
      document.head.appendChild(script);
    });
  }

  function post(action,payload){
    return new Promise((resolve,reject)=>{
      const a=actor();
      if(!API_URL) return reject(new Error('Backend URL missing'));
      if(!a) return reject(new Error('Choose your profile first'));
      const frame=document.querySelector('iframe[name="backendFrame"]');
      if(!frame) return reject(new Error('Backend frame missing'));
      const form=document.createElement('form');
      form.method='POST';form.action=API_URL;form.target='backendFrame';form.style.display='none';
      Object.entries({action,actor:a,payload:JSON.stringify(payload||{})}).forEach(([k,v])=>{const input=document.createElement('input');input.type='hidden';input.name=k;input.value=v;form.appendChild(input);});
      document.body.appendChild(form);form.submit();form.remove();setTimeout(resolve,700);
    });
  }

  function normalizeWishlist(list){
    return Array.isArray(list)?list.map(x=>({id:x.id||uid(),name:String(x.name||''),price:x.price??'',note:String(x.note||''),createdAt:String(x.createdAt||'')})).filter(x=>x.name):[];
  }


  function wishlistNoteParts(value){
    const note=String(value||'').trim();
    if(!note)return {text:'',link:''};
    const match=note.match(/https?:\/\/\S+/i);
    if(!match)return {text:note,link:''};
    const link=match[0];
    const text=(note.slice(0,match.index)+note.slice((match.index||0)+link.length)).trim().replace(/^[-–—·|:,;\s]+|[-–—·|:,;\s]+$/g,'');
    return {text,link};
  }

  function wishlistNoteHtml(value){
    const parts=wishlistNoteParts(value);
    const text=parts.text?`<span class="wishlist-note-text">${esc(parts.text)}</span>`:'';
    const link=parts.link?`<a class="wishlist-open-link" href="${esc(parts.link)}" target="_blank" rel="noopener noreferrer">Open link ↗</a>`:'';
    return text||link?`${text}${link}`:'<span class="wishlist-muted">—</span>';
  }

  function render(){
    const root=$('#financeWishlist'); if(!root) return;
    const a=actor();
    if(!a){root.innerHTML='<div class="finance-current-empty">Choose Principessa or Principe first.</div>';return;}
    const priced=items.filter(x=>x.price!==''&&x.price!=null);
    const total=priced.reduce((sum,x)=>sum+n(x.price),0);
    const rows=items.length?items.map((x,i)=>`<tr><td class="wishlist-item-name"><strong>${esc(x.name)}</strong></td><td class="wishlist-note-cell">${wishlistNoteHtml(x.note)}</td><td class="wishlist-price-cell">${x.price!==''&&x.price!=null?money(x.price):'—'}</td><td class="wishlist-edit-cell"><button class="wishlist-edit-btn" type="button" data-wish-index="${i}" aria-label="Edit ${esc(x.name)}">Edit</button></td></tr>`).join(''):`<tr><td colspan="4"><div class="wishlist-empty-row">Your wishlist is empty. Add something you may want to buy later.</div></td></tr>`;
    root.innerHTML=`<div class="wishlist-wrap"><div class="wishlist-head"><div><h2>${esc(a)}’s wishlist</h2><p>Wishlist items are informational only and do not affect your budget, savings or net worth.</p></div><button class="btn primary" type="button" data-wish-add>+ Add wish</button></div><div class="wishlist-table-wrap"><table class="wishlist-table"><thead><tr><th>Item</th><th>Note / Link</th><th>Estimated price</th><th class="wishlist-edit-head">Edit</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="2"><strong>Total</strong><small>${items.length} ${items.length===1?'item':'items'}</small></td><td class="wishlist-price-cell"><strong>${priced.length?money(total):'—'}</strong></td><td></td></tr></tfoot></table></div></div>`;
    $('[data-wish-add]',root)?.addEventListener('click',()=>openModal(-1));
    root.querySelectorAll('[data-wish-index]').forEach(btn=>btn.addEventListener('click',()=>openModal(Number(btn.dataset.wishIndex))));
  }

  function ensureModal(){
    if($('#wishlistMiniModal')) return;
    const modal=document.createElement('div');
    modal.id='wishlistMiniModal';modal.className='finance-mini-modal';modal.setAttribute('aria-hidden','true');
    modal.innerHTML='<div class="finance-mini-backdrop" data-wish-close></div><div class="finance-mini-card"><button class="finance-mini-close" type="button" data-wish-close>×</button><div id="wishlistMiniBody"></div></div>';
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-wish-close]').forEach(el=>el.addEventListener('click',closeModal));
  }

  function showModal(html){ensureModal();$('#wishlistMiniBody').innerHTML=html;$('#wishlistMiniModal').classList.add('show');$('#wishlistMiniModal').setAttribute('aria-hidden','false');}
  function closeModal(){const modal=$('#wishlistMiniModal');modal?.classList.remove('show');modal?.setAttribute('aria-hidden','true');}

  function openModal(index){
    const item=index>=0?items[index]:null;
    showModal(`<span class="panel-kicker">WISHLIST</span><h2>${item?'Edit wish':'Add a wish'}</h2><p>Save something you may want later. The price is optional and never affects your finances until you actually buy it.</p><div class="wishlist-fields"><label>What do you want?<input id="wishName" value="${esc(item?.name||'')}" placeholder="e.g. New laptop"></label><label>Estimated price, optional<div class="finance-money mini"><span>€</span><input id="wishPrice" inputmode="decimal" value="${esc(String(item?.price??''))}" placeholder="0.00"></div></label><label class="full">Note, optional<textarea id="wishNote" rows="4" placeholder="Why you want it, model, size, link note...">${esc(item?.note||'')}</textarea></label></div><div class="finance-mini-actions">${item?'<button class="btn ghost" type="button" data-wish-delete>Delete</button>':'<span></span>'}<button class="btn primary" type="button" data-wish-save>Save wish</button></div>`);
    $('[data-wish-save]')?.addEventListener('click',async()=>{
      const name=String($('#wishName')?.value||'').trim();
      const raw=String($('#wishPrice')?.value||'').trim();
      const note=String($('#wishNote')?.value||'').trim();
      if(!name)return toast('Add what you wish to buy first','warn');
      if(raw!==''&&!Number.isFinite(Number(raw.replace(',','.'))))return toast('Enter a valid price or leave it empty','warn');
      const next=[...items];
      const row={id:item?.id||uid(),name,price:raw===''?'':n(raw),note,createdAt:item?.createdAt||new Date().toISOString()};
      if(index>=0)next[index]=row;else next.push(row);
      await saveWishlist(next,'Wish saved');
    });
    $('[data-wish-delete]')?.addEventListener('click',async()=>{const next=[...items];next.splice(index,1);await saveWishlist(next,'Wish removed');});
  }

  async function saveWishlist(next,message){
    if(backendVersion<15)return toast('Wishlist saving needs backend v15 to be deployed','warn');
    const a=actor(); if(!a)return;
    try{
      const res=await jsonp({action:'state'});
      if(!res?.ok) throw new Error('Could not load latest finances');
      const profile=JSON.parse(JSON.stringify(res.state?.financeProfiles?.[a]||{}));
      profile.wishlist=next;
      items=normalizeWishlist(next);render();closeModal();
      await post('saveFinanceProfile',{profile});
      toast(message);setTimeout(loadState,1100);
    }catch(err){toast(err.message||'Could not save wishlist','warn');}
  }

  async function loadState(){
    if(loading||!actor())return;
    loading=true;
    try{
      const res=await jsonp({action:'state'});
      if(res?.ok){backendVersion=Number(res.state?.version||0);items=normalizeWishlist(res.state?.financeProfiles?.[actor()]?.wishlist);render();}
    }catch{}
    finally{loading=false;}
  }

  function init(){
    ensureModal();render();
    document.addEventListener('twogether:finance-view',e=>{if(e.detail?.view==='wishlist'){render();loadState();}});
    new MutationObserver(()=>{items=[];render();if($('#finances')?.classList.contains('active'))loadState();}).observe(document.body,{attributes:true,attributeFilter:['data-actor']});
  }

  document.addEventListener('DOMContentLoaded',init);
})();
