import { actor, esc, money, post } from './budget-state.js';
import { toast } from '../lib/toast.js';
import { buildAirbnbSearchUrl, buildListingCheckUrl, OUR_STAYS_ITALY_BOUNDS } from './stay-search-links.js';

const API_BASE = import.meta.env?.DEV ? 'http://localhost:4310' : '';
const ROOT_ID = 'stayTrackerRoot';
const VIEW_KEY = 'twogether_our_stays_plan_v1';
const OVERVIEW = 'overview';
let state = null;
let selectedPlanId = OVERVIEW;

function root(){ return document.getElementById(ROOT_ID); }
function clean(value){ return String(value == null ? '' : value).trim(); }
function plans(){
  return (Array.isArray(state?.plans) ? state.plans : [])
    .filter((plan) => plan?.meta?.start && plan?.meta?.end)
    .sort((a,b) => String(a.meta.start).localeCompare(String(b.meta.start)));
}
function planById(id){ return plans().find((plan) => plan.id === id) || null; }
function localDay(){
  const date=new Date();
  const pad=(value)=>String(value).padStart(2,'0');
  return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate());
}
function hasAccommodationExpense(plan){
  const normalExpense=(Array.isArray(plan?.expenseEntries)?plan.expenseEntries:[]).some((entry)=>entry?.category==='accommodation');
  const legacyTotal=plan?.sharedExpenses?.accom?.total;
  return normalExpense || (legacyTotal !== '' && legacyTotal != null);
}
function tripLocked(plan){
  if(!plan?.linkedTripId)return false;
  const trip=(Array.isArray(state?.trips)?state.trips:[]).find((item)=>item.id===plan.linkedTripId);
  return !!(trip?.confirmed?.Principessa && trip?.confirmed?.Principe);
}
function eligiblePlans(){
  const today=localDay();
  return plans().filter((plan)=>plan.meta.end>=today && !tripLocked(plan) && !hasAccommodationExpense(plan));
}
function eligiblePlanById(id){ return eligiblePlans().find((plan)=>plan.id===id)||null; }
function selectedPlan(){ return selectedPlanId === OVERVIEW ? null : eligiblePlanById(selectedPlanId); }
function isItalian(plan){ return clean(plan?.meta?.location).toLowerCase() === 'italy'; }
function destinationFor(plan){
  const meta = plan?.meta || {};
  const city = clean(meta.city);
  if (city) return city + ', ' + (clean(meta.location) || 'Italy');
  if (isItalian(plan)) return 'Lake Garda, Italy';
  return clean(meta.otherLocation) || clean(meta.location) || 'Italy';
}
function datePart(value, withYear){
  if (!value) return '';
  const date = new Date(value + 'T00:00:00');
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', withYear ? {day:'numeric',month:'short',year:'numeric'} : {day:'numeric',month:'short'}).format(date);
}
function dateRange(start,end,withYear=false){ return datePart(start,withYear) + ' – ' + datePart(end,withYear); }
function normalizeAirbnbLink(value){
  const raw=clean(value);
  if(!raw)return '';
  const markdown=/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/i.exec(raw);
  const direct=markdown?.[1] || /https?:\/\/[^\s<>"'\]\[()]+/i.exec(raw)?.[0] ||
    (/^(?:www\.)?airbnb\.[^\s/]+\/.+/i.test(raw) ? ('https://' + raw.replace(/^https?:\/\//i,'')) : '');
  if(!direct)return '';
  const candidate=direct.replace(/\\&/g,'&').replace(/[),.;!?]+$/,'');
  try{
    const url=new URL(candidate);
    const host=url.hostname.toLowerCase().replace(/^www\./,'');
    const allowed=[
      'airbnb.com','airbnb.it','airbnb.co.uk','airbnb.fr','airbnb.de','airbnb.nl','airbnb.es','airbnb.pt',
      'airbnb.ie','airbnb.dk','airbnb.se','airbnb.no','airbnb.fi','airbnb.ca','airbnb.com.au','airbnb.co.nz',
      'airbnb.com.br','airbnb.mx','airbnb.co.in','airbnb.jp','airbnb.co.kr','airbnb.com.sg','airbnb.com.tw',
      'airbnb.com.hk','airbnb.co.za','airbnb.pl','airbnb.cz','airbnb.hu','airbnb.at','airbnb.ch','airbnb.be','airbnb.gr'
    ];
    if(!allowed.some((domain)=>host===domain||host.endsWith('.'+domain)))return '';
    const room=url.pathname.match(/^\/rooms\/(\d+)/i);
    if(room)return 'https://www.airbnb.com/rooms/' + room[1];
    return url.toString();
  }catch{return '';}
}
function allFavorites(){
  const global=(Array.isArray(state?.stayFavorites)?state.stayFavorites:[])
    .filter((favorite)=>favorite?.source==='airbnb')
    .map((favorite)=>({...favorite,ownerPlanId:''}));
  if(global.length)return global;
  const found=[];
  (Array.isArray(state?.plans)?state.plans:[]).forEach((owner)=>{
    (Array.isArray(owner?.stayTracker?.saved)?owner.stayTracker.saved:[]).forEach((favorite)=>{
      if(favorite?.source==='airbnb')found.push({...favorite,ownerPlanId:owner.id});
    });
  });
  const seen=new Set();
  return found.filter((favorite)=>{
    const key=clean(favorite.url).split(/[?#]/)[0].replace(/\/$/,'').toLowerCase();
    if(!key||seen.has(key))return false;
    seen.add(key);return true;
  });
}
function tripHistory(favorite, plan){
  if (!plan) return [];
  return (Array.isArray(favorite.history) ? favorite.history : [])
    .filter((row) => row.start === plan.meta.start && row.end === plan.meta.end)
    .sort((a,b) => String(a.checkedAt).localeCompare(String(b.checkedAt)));
}
function priceInfo(favorite, plan){
  if(!plan)return {current:null,previous:null,latest:null,change:'',unavailable:false};
  const events=tripHistory(favorite,plan);
  const latestEvent=events[events.length-1]||null;
  const unavailable=latestEvent?.status==='unavailable';
  const prices=events.filter((row)=>row.status!=='unavailable'&&row.price!==''&&row.price!=null);
  const current=prices[prices.length-1]||null;
  const previous=prices[prices.length-2]||null;
  let change='';
  if(current&&previous){
    const diff=Math.round((Number(current.price)-Number(previous.price))*100)/100;
    change=Math.abs(diff)<.01?'Same':diff<0?'↓ '+money(Math.abs(diff)):'↑ '+money(diff);
  }
  return {current,previous,latest:current,change,unavailable};
}
function isSelected(favorite, plan){
  const chosen=plan?.stayTracker?.selected||{};
  return chosen.favoriteId===favorite.id;
}
function tripName(plan){
  return clean(plan?.meta?.city)||clean(plan?.meta?.otherLocation)||clean(plan?.meta?.location)||'Trip';
}
function sortedFavorites(plan){
  return allFavorites().sort((a,b)=>{
    if(!plan)return clean(a.name).localeCompare(clean(b.name));
    const ia=priceInfo(a,plan),ib=priceInfo(b,plan);
    if(ia.unavailable!==ib.unavailable)return ia.unavailable?1:-1;
    const pa=Number(ia.current?.price||Infinity),pb=Number(ib.current?.price||Infinity);
    if(pa!==pb)return pa-pb;
    return clean(a.name).localeCompare(clean(b.name));
  });
}
function tripPicker(){
  const plan=selectedPlan();
  const title=plan?tripName(plan):'All saved stays';
  const meta=plan?dateRange(plan.meta.start,plan.meta.end,true):'Choose an open trip when you are searching';
  return '<section class="our-stays-switcher"><span class="our-stays-picker-label">Looking for</span>' +
    '<button id="ourStayPlanPicker" class="our-stays-picker-button" type="button">' +
      '<span><strong>'+esc(title)+'</strong><small>'+esc(meta)+'</small></span><b aria-hidden="true">⌄</b>' +
    '</button></section>';
}
function openTripPicker(){
  const open=eligiblePlans();
  showModal(modalHead('LOOKING FOR','Choose a trip','Only open trips without an accommodation expense appear here.') +
    '<div class="our-stays-trip-list">' +
      '<button type="button" data-stay-plan-choice="'+OVERVIEW+'" class="'+(selectedPlanId===OVERVIEW?'active':'')+'"><span><strong>All saved stays</strong><small>Browse the whole collection</small></span><b>›</b></button>' +
      open.map((plan)=>'<button type="button" data-stay-plan-choice="'+esc(plan.id)+'" class="'+(selectedPlanId===plan.id?'active':'')+'"><span><strong>'+esc(tripName(plan))+'</strong><small>'+esc(dateRange(plan.meta.start,plan.meta.end,true))+'</small></span><b>›</b></button>').join('') +
      (!open.length?'<p class="our-stays-trip-list-empty">No open trips need accommodation right now.</p>':'') +
    '</div>');
  document.querySelectorAll('[data-stay-plan-choice]').forEach((button)=>button.addEventListener('click',()=>{
    selectedPlanId=button.dataset.stayPlanChoice||OVERVIEW;
    try{localStorage.setItem(VIEW_KEY,selectedPlanId);}catch{}
    closeModal();
    render();
  }));
}
function searchPanel(plan){
  const broadItaly=!plan||isItalian(plan);
  const input={
    destination:broadItaly?'Bergamo to Lake Garda, Italy':destinationFor(plan),
    bounds:broadItaly?OUR_STAYS_ITALY_BOUNDS:null,
    start:plan?.meta?.start||'',
    end:plan?.meta?.end||'',
    adults:2
  };
  const airbnb=buildAirbnbSearchUrl(input);
  const area=broadItaly?'Manerba · Lonato · Peschiera · Bergamo':destinationFor(plan);
  return '<section class="our-stays-search">' +
    '<a class="our-stays-airbnb" href="'+esc(airbnb)+'" target="_blank" rel="noopener noreferrer">' +
      '<span class="our-stays-airbnb-icon">⌂</span>' +
      '<span><strong>Search Airbnb</strong><small>'+esc(area)+'</small></span>' +
      '<i>↗</i>' +
    '</a>' +
    '<div class="our-stays-tripmeta"><span>'+(plan?esc(dateRange(plan.meta.start,plan.meta.end)):'Choose your dates in Airbnb')+'</span><b>2 guests</b></div>' +
  '</section>';
}
function overviewPanel(){
  return '<section class="our-stays-overview-note"><span>♡</span><div><strong>Our little stay collection</strong><p>Choose a trip above when you want to recheck prices for new dates.</p></div></section>';
}
function stayCard(favorite,plan){
  const info=priceInfo(favorite,plan);
  const selected=!!plan&&isSelected(favorite,plan);
  const note=clean(favorite.note);
  return '<article class="our-stay-swipe" data-stay-swipe="'+esc(favorite.id)+'" data-owner-plan="'+esc(favorite.ownerPlanId)+'">' +
    '<span class="our-stay-delete-underlay" aria-hidden="true"><b>Delete</b></span>' +
    '<div class="our-stay-card'+(selected?' is-selected':'')+(info.unavailable?' is-unavailable':'')+'">' +
      '<button class="our-stay-main" type="button" data-stay-details="'+esc(favorite.id)+'" data-owner-plan="'+esc(favorite.ownerPlanId)+'">' +
        '<span class="our-stay-photo '+(favorite.image?'':'is-empty')+'"'+(favorite.image?' style="background-image:url(&quot;'+esc(favorite.image)+'&quot;)"':'')+'></span>' +
        '<span class="our-stay-copy"><strong>'+esc(favorite.name||'Airbnb stay')+'</strong><small>'+(plan?esc(dateRange(plan.meta.start,plan.meta.end)):'Saved Airbnb')+'</small>' +
          (note?'<em>♡ '+esc(note)+'</em>':'') +
        '</span>' +
        (plan?'<span class="our-stay-money">'+
          (info.unavailable?'<strong class="unavailable-label">Unavailable</strong>':('<strong>'+(info.current?money(info.current.price):'Add price')+'</strong>'+(info.change?'<b class="'+(info.change.startsWith('↓')?'down':info.change.startsWith('↑')?'up':'same')+'">'+esc(info.change)+'</b>':'')))+
          '<i>›</i></span>':'<span class="our-stay-money is-overview"><i>›</i></span>') +
      '</button>' +
      (plan&&!selected&&!info.unavailable?'<div class="our-stay-quick"><button class="select" type="button" data-select-stay="'+esc(favorite.id)+'" data-owner-plan="'+esc(favorite.ownerPlanId)+'">Select this stay</button></div>':'') +
      (selected?'<div class="our-stay-selected">♡ Selected for this trip</div>':'') +
    '</div>' +
  '</article>';
}
function render(){
  const el = root(); if (!el) return;
  if (selectedPlanId !== OVERVIEW && !eligiblePlanById(selectedPlanId)) selectedPlanId = OVERVIEW;
  const plan = selectedPlan();
  const favorites = sortedFavorites(plan);
  el.innerHTML = '<div class="tv2-root our-stays-root"><div class="tv2-page our-stays-page">' +
    '<header class="our-stays-head"><div><h1>Our Stays</h1><p>Airbnbs we love ♡</p></div>' +
      '<button id="ourStaySaveTop" class="our-stays-add" type="button">＋ Save</button>' +
    '</header>' +
    tripPicker() +
    searchPanel(plan) +
    '<section class="our-stays-collection"><div class="our-stays-section-title"><div><h2>Saved stays</h2><span>' + favorites.length + '</span></div>' +
      (favorites.length ? '<button id="ourStaySaveInline" type="button">＋ Add</button>' : '') + '</div>' +
      (favorites.length ? '<div class="our-stays-grid">' + favorites.map((favorite) => stayCard(favorite,plan)).join('') + '</div>' :
        '<div class="our-stays-empty"><span>♡</span><strong>No stays yet</strong><p>Search Airbnb above or save a place you already found.</p>' +
        '<button id="ourStaySaveEmpty" type="button">Save accommodation</button></div>') +
    '</section></div></div><div id="stayModalRoot"></div>';
  bind();
}
function bind(){
  document.getElementById('ourStayPlanPicker')?.addEventListener('click',openTripPicker);
  ['ourStaySaveTop','ourStaySaveInline','ourStaySaveEmpty'].forEach((id) => document.getElementById(id)?.addEventListener('click',openSaveModal));
  document.querySelectorAll('[data-stay-details]').forEach((button) => button.addEventListener('click',(event) => {
    const swipe=button.closest('.our-stay-swipe');
    if(swipe?.classList.contains('is-delete-open')){event.preventDefault();return;}
    openDetails(button.dataset.ownerPlan,button.dataset.stayDetails);
  }));
  document.querySelectorAll('[data-select-stay]').forEach((button) => button.addEventListener('click',() => selectStay(button.dataset.ownerPlan,button.dataset.selectStay)));
}
function favoriteById(ownerPlanId,favoriteId){
  const global=(Array.isArray(state?.stayFavorites)?state.stayFavorites:[]).find((item)=>item.id===favoriteId);
  if(global)return {owner:null,favorite:{...global,ownerPlanId:''}};
  const owner=(state?.plans||[]).find((plan)=>plan.id===ownerPlanId);
  const favorite=(owner?.stayTracker?.saved||[]).find((item)=>item.id===favoriteId);
  return favorite?{owner,favorite:{...favorite,ownerPlanId:ownerPlanId}}:null;
}
function showModal(inner,options={}){
  const host = document.getElementById('stayModalRoot'); if (!host) return;
  host.innerHTML = '<div class="stay-modal'+(options.back?' has-back':'')+'" aria-hidden="false"><button class="stay-modal-backdrop" data-stay-close aria-label="Close"></button><section class="stay-modal-sheet" role="dialog" aria-modal="true"><span class="stay-modal-handle" aria-hidden="true"></span>' + inner + '</section></div>';
  document.body.classList.add('stay-modal-open');
  const surface=host.querySelector('.stay-modal');
  if(surface){
    surface._twogetherBack=typeof options.back==='function'?options.back:closeModal;
    surface._twogetherHome=closeModal;
  }
  host.querySelectorAll('[data-stay-close]').forEach((button) => button.addEventListener('click',closeModal));
}
function closeModal(){
  const host = document.getElementById('stayModalRoot'); if (host) host.innerHTML = '';
  document.body.classList.remove('stay-modal-open');
}
function modalHead(kicker,title,copy){
  return '<div class="stay-modal-head"><div><span class="stay-label">' + esc(kicker) + '</span><h2>' + esc(title) + '</h2>' + (copy ? '<p>' + esc(copy) + '</p>' : '') + '</div></div>';
}
function openSaveModal(){
  const plan=selectedPlan();
  showModal(modalHead('SAVE PLACE','Save accommodation',plan?'Save it to Our Stays for this trip or any future trip.':'Save it to Our Stays forever — no trip needed.') +
    '<div class="stay-form">' +
      '<label><span>Airbnb link</span><input id="stayFavoriteUrl" type="text" inputmode="url" placeholder="Paste Airbnb link or share text"></label>' +
      '<label><span>Current total price <i>optional</i></span><div class="stay-money-input"><b>€</b><input id="stayFavoritePrice" inputmode="decimal" placeholder="0"></div></label>' +
      '<label><span>Notes <i>optional</i></span><textarea id="stayFavoriteNote" rows="3" placeholder="Anything you want to remember"></textarea></label>' +
      '<div id="stayPreviewStatus" class="stay-preview-status"></div>' +
      '<button id="stayFavoriteSave" class="stay-modal-primary" type="button">Save to Our Stays</button>' +
    '</div>');
  document.getElementById('stayFavoriteSave')?.addEventListener('click',saveFavorite);
}
async function loadPreview(url){
  const response = await fetch(API_BASE + '/api/stays/preview',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify({url})});
  const json = await response.json();
  if (!response.ok || !json?.ok) throw new Error(json?.error || 'Could not read this accommodation');
  return json;
}
async function saveFavorite(){
  const plan=selectedPlan(),who=actor(); if(!who)return;
  const pasted=clean(document.getElementById('stayFavoriteUrl')?.value);
  const url=normalizeAirbnbLink(pasted);
  const price=clean(document.getElementById('stayFavoritePrice')?.value).replace(',','.');
  const note=clean(document.getElementById('stayFavoriteNote')?.value);
  if(!pasted){toast('Paste the Airbnb link first','warn');return;}
  if(!url){toast('That does not look like an Airbnb link','warn');return;}
  if(price&&!Number.isFinite(Number(price))){toast('That price does not look right','warn');return;}
  const button=document.getElementById('stayFavoriteSave');
  const status=document.getElementById('stayPreviewStatus');
  if(button)button.disabled=true;
  if(status)status.textContent='Getting the name and photo…';
  let preview={source:'airbnb',name:'',image:'',url};
  try{preview=await loadPreview(url);}
  catch{
    preview.name='Airbnb stay';
    if(status)status.textContent='Airbnb blocked the preview — saving with a simple placeholder.';
  }
  try{
    await post('saveStayFavorite',{
      planId:plan?.id||'',
      price:price||'',
      checkedAt:new Date().toISOString(),
      favorite:{source:'airbnb',url:preview.url||url,name:preview.name||'Airbnb stay',image:preview.image||'',note,city:'',area:''}
    },who);
    closeModal();toast('Saved to Our Stays');await refreshState();
  }catch(error){
    toast(error.message||'Could not save this place','warn');
    if(button)button.disabled=false;
  }
}
function openDetails(ownerPlanId,favoriteId){
  const found=favoriteById(ownerPlanId,favoriteId);if(!found)return;
  const plan=selectedPlan();
  const selected=!!plan&&isSelected(found.favorite,plan);
  const info=priceInfo(found.favorite,plan);
  const rows=plan?tripHistory(found.favorite,plan).filter((row)=>row.status!=='unavailable'&&row.price!==''&&row.price!=null).slice().reverse().slice(0,4):[];
  const link=plan?buildListingCheckUrl(found.favorite.url,found.favorite.source,{start:plan.meta.start,end:plan.meta.end,adults:2}):found.favorite.url;
  const subtitle=plan?dateRange(plan.meta.start,plan.meta.end,true):'Saved in Our Stays';
  showModal(modalHead('AIRBNB',found.favorite.name,subtitle) +
    (found.favorite.image?'<div class="stay-detail-photo'+(info.unavailable?' is-unavailable':'')+'" style="background-image:url(&quot;'+esc(found.favorite.image)+'&quot;)"></div>':'<div class="stay-detail-photo is-empty">⌂</div>') +
    (plan?(info.unavailable?'<div class="stay-detail-unavailable"><strong>Unavailable</strong><span>Not available for these trip dates.</span></div>':'<div class="stay-detail-price"><span>Current price</span><strong>'+(info.current?money(info.current.price):'—')+'</strong>'+(info.change?'<b class="'+(info.change.startsWith('↓')?'down':info.change.startsWith('↑')?'up':'same')+'">'+esc(info.change)+'</b>':'')+'</div>'):'') +
    (found.favorite.note?'<div class="stay-detail-notes"><span>Our note</span><p>'+esc(found.favorite.note)+'</p></div>':'') +
    (plan?'<div class="stay-detail-primary">'+(!selected&&!info.unavailable&&info.current?'<button id="stayDetailSelect" class="stay-modal-primary" type="button">Select this stay</button>':'')+(selected?'<button id="stayDetailExpense" class="stay-modal-primary" type="button">Edit in trip</button><button id="stayDetailUnselect" class="stay-text-danger" type="button">Unselect from trip</button>':'')+'</div>':'') +
    '<a class="stay-airbnb-action" href="'+esc(link)+'" target="_blank" rel="noopener noreferrer"><span class="stay-airbnb-mark">⌂</span><span><strong>Open in Airbnb</strong><small>'+(plan?'Dates + 2 guests ready':'View this stay')+'</small></span><b>↗</b></a>' +
    '<div class="stay-detail-chips">' +
      (plan?'<button id="stayDetailPrice" type="button">€ '+(info.current?'Update price':'Add price')+'</button>':'') +
      (plan&&!info.unavailable?'<button id="stayDetailUnavailable" type="button">Unavailable</button>':'') +
      '<button id="stayEditNotes" type="button">♡ '+(found.favorite.note?'Edit note':'Add note')+'</button>' +
    '</div>' +
    (rows.length>1?'<details class="stay-detail-history"><summary>Price history</summary>'+rows.map((row)=>'<div><b>'+money(row.price)+'</b><small>'+esc(dateRange(row.start,row.end))+'</small></div>').join('')+'</details>':''));
  document.getElementById('stayDetailSelect')?.addEventListener('click',()=>{closeModal();selectStay(ownerPlanId,favoriteId);});
  document.getElementById('stayDetailExpense')?.addEventListener('click',()=>openTripExpenseEditor(plan.id,plan.stayTracker?.selected?.expenseId||''));
  document.getElementById('stayDetailUnselect')?.addEventListener('click',()=>unselectStay(plan.id));
  document.getElementById('stayDetailPrice')?.addEventListener('click',()=>openPriceModal(ownerPlanId,favoriteId,plan.id));
  document.getElementById('stayDetailUnavailable')?.addEventListener('click',()=>markUnavailable(ownerPlanId,favoriteId,plan.id));
  document.getElementById('stayEditNotes')?.addEventListener('click',()=>openEditNotes(ownerPlanId,favoriteId));
}
function openEditNotes(ownerPlanId,favoriteId){
  const found=favoriteById(ownerPlanId,favoriteId); if(!found)return;
  showModal(modalHead('NOTES',found.favorite.name,'Add or change anything you want to remember about this stay.') +
    '<div class="stay-form">' +
      '<label><span>Notes</span><textarea id="stayEditedNote" rows="5" placeholder="Anything you want to remember">'+esc(found.favorite.note||'')+'</textarea></label>' +
      '<button id="stayNoteSave" class="stay-modal-primary" type="button">Save notes</button>' +
    '</div>',{back:()=>openDetails(ownerPlanId,favoriteId)});
  document.getElementById('stayNoteSave')?.addEventListener('click',()=>saveNotes(ownerPlanId,favoriteId));
}
async function saveNotes(ownerPlanId,favoriteId){
  const who=actor(); if(!who)return;
  const note=clean(document.getElementById('stayEditedNote')?.value);
  try{
    await post('updateStayFavoriteDetails',{ownerPlanId,favoriteId,note},who);
    toast(note?'Notes saved':'Notes cleared');
    await refreshState();
    openDetails(ownerPlanId,favoriteId);
  }catch(error){toast(error.message||'Could not save the notes','warn');}
}
async function removeFavorite(ownerPlanId,favoriteId){
  const found=favoriteById(ownerPlanId,favoriteId),who=actor(); if(!found||!who)return;
  if(!window.confirm('Delete this favourite from Our Stays?'))return;
  try{
    await post('deleteStayFavorite',{ownerPlanId:'',favoriteId},who);
    toast('Removed from Our Stays');
    await refreshState();
  }catch(error){toast(error.message||'Could not remove this stay','warn');}
}
function bindStaySwipeDelete(){
  let opened=null;
  document.querySelectorAll('[data-stay-swipe]').forEach((row)=>{
    const card=row.querySelector('.our-stay-card');
    if(!card)return;
    let tracking=false,startX=0,startY=0,lastX=0,moved=false;
    const close=()=>{card.style.transform='';row.classList.remove('is-delete-open');if(opened===row)opened=null;};
    row.addEventListener('pointerdown',(event)=>{
      if(event.pointerType==='mouse'&&event.button!==0)return;
      if(event.target.closest('[data-swipe-delete]'))return;
      if(opened&&opened!==row){
        const other=opened.querySelector('.our-stay-card');
        if(other)other.style.transform='';
        opened.classList.remove('is-delete-open');opened=null;
      }
      tracking=true;startX=lastX=event.clientX;startY=event.clientY;moved=false;
      try{row.setPointerCapture(event.pointerId);}catch{}
    });
    row.addEventListener('pointermove',(event)=>{
      if(!tracking)return;
      const dx=event.clientX-startX,dy=event.clientY-startY;
      if(!moved&&Math.abs(dx)<7&&Math.abs(dy)<7)return;
      if(Math.abs(dy)>Math.abs(dx)*1.15){tracking=false;close();return;}
      moved=true;
      const offset=Math.max(-86,Math.min(0,dx));
      card.style.transform='translateX('+offset+'px)';
      if(offset<-8)event.preventDefault();
    });
    const finish=(event)=>{
      if(!tracking)return;
      tracking=false;
      const dx=lastX-startX;
      if(dx<-44){
        card.style.transform='translateX(-82px)';
        row.classList.add('is-delete-open');
        opened=row;
      }else close();
      if(moved){event.preventDefault();event.stopPropagation();}
    };
    row.addEventListener('pointermove',(event)=>{lastX=event.clientX;},{passive:true});
    row.addEventListener('pointerup',finish);
    row.addEventListener('pointercancel',()=>{tracking=false;close();});
  });
  document.querySelectorAll('[data-swipe-delete]').forEach((button)=>button.addEventListener('click',()=>removeFavorite(button.dataset.ownerPlan,button.dataset.swipeDelete)));
}
function openPriceModal(ownerPlanId,favoriteId,planId){
  const found=favoriteById(ownerPlanId,favoriteId),plan=planById(planId); if(!found||!plan)return;
  const info=priceInfo(found.favorite,plan);
  const link=buildListingCheckUrl(found.favorite.url,found.favorite.source,{start:plan.meta.start,end:plan.meta.end,adults:2});
  showModal(modalHead('PRICE CHECK',found.favorite.name,'Open Airbnb for these dates, then type the new total.') +
    '<div class="stay-price-check"><a href="'+esc(link)+'" target="_blank" rel="noopener noreferrer">Check '+esc(dateRange(plan.meta.start,plan.meta.end))+' ↗</a>' +
      '<label><span>Current total price</span><div class="stay-big-price"><b>€</b><input id="stayUpdatedPrice" inputmode="decimal" value="'+esc(info.current?.price??info.latest?.price??'')+'" placeholder="0"></div></label>' +
      '<button id="stayPriceSave" class="stay-modal-primary" type="button">Update price</button></div>',{back:()=>openDetails(ownerPlanId,favoriteId)});
  document.getElementById('stayPriceSave')?.addEventListener('click',()=>updatePrice(ownerPlanId,favoriteId,plan.id));
}
async function markUnavailable(ownerPlanId,favoriteId,planId){
  const plan=planById(planId),who=actor();if(!plan||!who)return;
  try{
    await post('markStayFavoriteUnavailable',{favoriteId,contextPlanId:plan.id,checkedAt:new Date().toISOString()},who);
    toast('Marked unavailable for this trip');
    await refreshState();
    openDetails(ownerPlanId,favoriteId);
  }catch(error){toast(error.message||'Could not mark this stay unavailable','warn');}
}
async function updatePrice(ownerPlanId,favoriteId,planId){
  const plan=planById(planId),who=actor(); if(!plan||!who)return;
  const price=clean(document.getElementById('stayUpdatedPrice')?.value).replace(',','.');
  if(!price||!Number.isFinite(Number(price))){toast('Enter the current total price','warn');return;}
  try{
    await post('updateStayFavoritePrice',{ownerPlanId,favoriteId,contextPlanId:plan.id,price,checkedAt:new Date().toISOString()},who);
    toast('Price updated');
    await refreshState();
    openDetails(ownerPlanId,favoriteId);
  }catch(error){toast(error.message||'Could not update the price','warn');}
}
async function selectStay(ownerPlanId,favoriteId){
  const plan=selectedPlan(),who=actor(); if(!plan||!who)return;
  if(hasAccommodationExpense(plan)){toast('This trip already has an accommodation expense','warn');return;}
  try{
    const result=await post('selectStayForTrip',{planId:plan.id,ownerPlanId,favoriteId},who);
    selectedPlanId=OVERVIEW;
    try{localStorage.setItem(VIEW_KEY,selectedPlanId);}catch{}
    toast('Stay selected and added to trip expenses');
    await refreshState();
    return result;
  }catch(error){toast(error.message||'Could not select this stay','warn');}
}
async function unselectStay(planId){
  const plan=planById(planId),who=actor(); if(!plan||!who)return;
  if(!window.confirm('Unselect this stay? The linked accommodation expense will be removed from this trip too.'))return;
  try{
    await post('unselectStayForTrip',{planId:plan.id},who);
    closeModal();
    toast('Stay unselected and accommodation expense removed');
    await refreshState();
  }catch(error){toast(error.message||'Could not unselect this stay','warn');}
}
function openTripExpenseEditor(planId,expenseId){
  const plan=planById(planId); if(!plan)return;
  closeModal();
  document.querySelector('[data-sheet="log"]')?.click();
  setTimeout(()=>window.TwogetherWorkflow?.start?.(plan.id,{expenseId:expenseId||'',returnToTrip:true}),80);
}
function stayModalOpen(){
  return !!document.querySelector('#stayModalRoot .stay-modal');
}
async function refreshState(){
  try{
    state=await window.TwogetherAPI.remoteState();
    if(selectedPlanId!==OVERVIEW&&!eligiblePlanById(selectedPlanId))selectedPlanId=OVERVIEW;
    if(!stayModalOpen())render();
  }catch{
    state={plans:[],trips:[],stayFavorites:[]};
    if(!stayModalOpen())render();
  }
}
function openForPlan(planId){
  selectedPlanId=planId&&eligiblePlanById(planId)?planId:OVERVIEW;
  try{localStorage.setItem(VIEW_KEY,selectedPlanId);}catch{}
  document.querySelector('[data-sheet="stay-tracker"]')?.click();
  render();
}
export function initOurStays(){
  try { selectedPlanId = localStorage.getItem(VIEW_KEY) || OVERVIEW; } catch {}
  refreshState();
  document.addEventListener('twogether:saved',refreshState);
  document.addEventListener('twogether:budget-refreshed',refreshState);
  document.addEventListener('twogether:trips-refreshed',refreshState);
  document.addEventListener('twogether:open-our-stays',(event) => {
    refreshState().then(() => openForPlan(clean(event.detail?.planId)));
  });
  document.querySelector('[data-sheet="stay-tracker"]')?.addEventListener('click',() => setTimeout(refreshState,0));
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',initOurStays,{once:true});
else initOurStays();
