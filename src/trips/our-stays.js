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
  const found = [];
  (Array.isArray(state?.plans) ? state.plans : []).forEach((owner) => {
    (Array.isArray(owner?.stayTracker?.saved) ? owner.stayTracker.saved : []).forEach((favorite) => {
      if (favorite?.source === 'airbnb') found.push({...favorite, ownerPlanId:owner.id});
    });
  });
  const seen = new Set();
  return found.filter((favorite) => {
    const key = clean(favorite.url).split(/[?#]/)[0].replace(/\/$/,'').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function tripHistory(favorite, plan){
  if (!plan) return [];
  return (Array.isArray(favorite.history) ? favorite.history : [])
    .filter((row) => row.start === plan.meta.start && row.end === plan.meta.end)
    .sort((a,b) => String(a.checkedAt).localeCompare(String(b.checkedAt)));
}
function latestAny(favorite){
  return [...(Array.isArray(favorite.history) ? favorite.history : [])]
    .sort((a,b) => String(a.checkedAt).localeCompare(String(b.checkedAt))).pop() || null;
}
function priceInfo(favorite, plan){
  const history = tripHistory(favorite, plan);
  const current = history[history.length - 1] || null;
  const previous = history[history.length - 2] || null;
  const latest = current || latestAny(favorite);
  let change = '';
  if (current && previous) {
    const diff = Math.round((Number(current.price) - Number(previous.price)) * 100) / 100;
    change = Math.abs(diff) < .01 ? 'Same' : diff < 0 ? '↓ ' + money(Math.abs(diff)) : '↑ ' + money(diff);
  }
  return { current, previous, latest, change };
}
function isSelected(favorite, plan){
  const chosen = plan?.stayTracker?.selected || {};
  return chosen.favoriteId === favorite.id && chosen.ownerPlanId === favorite.ownerPlanId;
}
function selectedUsage(favorite){
  return (Array.isArray(state?.plans)?state.plans:[]).map((plan)=>({
    plan,
    selected:plan?.stayTracker?.selected||{}
  })).find(({selected})=>selected.favoriteId===favorite.id&&selected.ownerPlanId===favorite.ownerPlanId)||null;
}
function tripName(plan){
  return clean(plan?.meta?.city)||clean(plan?.meta?.otherLocation)||clean(plan?.meta?.location)||'Trip';
}
function sortedFavorites(plan){
  return allFavorites().sort((a,b) => {
    const pa = Number(priceInfo(a,plan).latest?.price || Infinity);
    const pb = Number(priceInfo(b,plan).latest?.price || Infinity);
    if (pa !== pb) return pa - pb;
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
  const broadItaly = isItalian(plan);
  const input = {
    destination:broadItaly ? 'Bergamo to Lake Garda, Italy' : destinationFor(plan),
    bounds:broadItaly ? OUR_STAYS_ITALY_BOUNDS : null,
    start:plan.meta.start,
    end:plan.meta.end,
    adults:2
  };
  const airbnb = buildAirbnbSearchUrl(input);
  const area = broadItaly ? 'Manerba · Lonato · Peschiera · Bergamo' : destinationFor(plan);
  return '<section class="our-stays-search">' +
    '<a class="our-stays-airbnb" href="' + esc(airbnb) + '" target="_blank" rel="noopener noreferrer">' +
      '<span class="our-stays-airbnb-icon">⌂</span>' +
      '<span><strong>Search Airbnb</strong><small>' + esc(area) + '</small></span>' +
      '<i>↗</i>' +
    '</a>' +
    '<div class="our-stays-tripmeta"><span>' + esc(dateRange(plan.meta.start,plan.meta.end)) + '</span><b>2 guests</b></div>' +
  '</section>';
}
function overviewPanel(){
  return '<section class="our-stays-overview-note"><span>♡</span><div><strong>Our little stay collection</strong><p>Choose a trip above when you want to recheck prices for new dates.</p></div></section>';
}
function stayCard(favorite, plan){
  const info = priceInfo(favorite, plan);
  const displayPrice = info.latest?.price;
  const usage = selectedUsage(favorite);
  return '<article class="our-stay-card' + (usage ? ' is-selected' : '') + '">' +
    '<button class="our-stay-main" type="button" data-stay-details="' + esc(favorite.id) + '" data-owner-plan="' + esc(favorite.ownerPlanId) + '">' +
      '<span class="our-stay-photo ' + (favorite.image ? '' : 'is-empty') + '"' + (favorite.image ? ' style="background-image:url(&quot;' + esc(favorite.image) + '&quot;)"' : '') + '></span>' +
      '<span class="our-stay-copy"><strong>' + esc(favorite.name || 'Airbnb stay') + '</strong><small>' + (plan ? esc(dateRange(plan.meta.start,plan.meta.end)) : 'Saved Airbnb') + '</small>' +
        (favorite.note ? '<em>✎ Note</em>' : '') +
      '</span>' +
      '<span class="our-stay-money"><strong>' + (displayPrice != null ? money(displayPrice) : '—') + '</strong>' +
        (info.change ? '<b class="' + (info.change.startsWith('↓') ? 'down' : info.change.startsWith('↑') ? 'up' : 'same') + '">' + esc(info.change) + '</b>' : '') +
        '<i>›</i>' +
      '</span>' +
    '</button>' +
    (plan ? '<div class="our-stay-quick"><button class="select" type="button" data-select-stay="' + esc(favorite.id) + '" data-owner-plan="' + esc(favorite.ownerPlanId) + '">Select this stay</button></div>' : '') +
    (usage ? '<div class="our-stay-selected">♡ Selected · ' + esc(tripName(usage.plan)) + '</div>' : '') +
  '</article>';
}
function render(){
  const el = root(); if (!el) return;
  if (selectedPlanId !== OVERVIEW && !eligiblePlanById(selectedPlanId)) selectedPlanId = OVERVIEW;
  const plan = selectedPlan();
  const favorites = sortedFavorites(plan);
  el.innerHTML = '<div class="tv2-root our-stays-root"><div class="tv2-page our-stays-page">' +
    '<header class="our-stays-head"><div><h1>Our Stays</h1><p>Airbnbs we love ♡</p></div>' +
      (plan ? '<button id="ourStaySaveTop" class="our-stays-add" type="button" aria-label="Save a place">＋</button>' : '') +
    '</header>' +
    tripPicker() +
    (plan ? searchPanel(plan) : overviewPanel()) +
    '<section class="our-stays-collection"><div class="our-stays-section-title"><div><h2>Saved stays</h2><span>' + favorites.length + '</span></div>' +
      (plan && favorites.length ? '<button id="ourStaySaveInline" type="button">＋ Add</button>' : '') + '</div>' +
      (favorites.length ? '<div class="our-stays-grid">' + favorites.map((favorite) => stayCard(favorite,plan)).join('') + '</div>' :
        '<div class="our-stays-empty"><span>♡</span><strong>No stays yet</strong><p>' + (plan ? 'Find one on Airbnb, then save it here.' : 'Choose a trip, then save the Airbnbs you like.') + '</p>' +
        (plan ? '<button id="ourStaySaveEmpty" type="button">Save a stay</button>' : '') + '</div>') +
    '</section></div></div><div id="stayModalRoot"></div>';
  bind();
}
function bind(){
  document.getElementById('ourStayPlanPicker')?.addEventListener('click',openTripPicker);
  ['ourStaySaveTop','ourStaySaveInline','ourStaySaveEmpty'].forEach((id) => document.getElementById(id)?.addEventListener('click',openSaveModal));
  document.querySelectorAll('[data-stay-details]').forEach((button) => button.addEventListener('click',() => openDetails(button.dataset.ownerPlan,button.dataset.stayDetails)));
  document.querySelectorAll('[data-select-stay]').forEach((button) => button.addEventListener('click',() => selectStay(button.dataset.ownerPlan,button.dataset.selectStay)));
}
function favoriteById(ownerPlanId,favoriteId){
  const owner = (state?.plans || []).find((plan) => plan.id === ownerPlanId);
  const favorite = (owner?.stayTracker?.saved || []).find((item) => item.id === favoriteId);
  return favorite ? {owner,favorite} : null;
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
  if (!selectedPlan()) return;
  showModal(modalHead('SAVE PLACE','Add to Our Stays','Paste the Airbnb link and price. Twogether will try to fetch the name and main photo itself.') +
    '<div class="stay-form">' +
      '<label><span>Airbnb link</span><input id="stayFavoriteUrl" type="text" inputmode="url" placeholder="Paste Airbnb link or share text"></label>' +
      '<label><span>Current total price</span><div class="stay-money-input"><b>€</b><input id="stayFavoritePrice" inputmode="decimal" placeholder="0"></div></label>' +
      '<label><span>Notes <i>optional</i></span><textarea id="stayFavoriteNote" rows="3" placeholder="Anything you want to remember"></textarea></label>' +
      '<div id="stayPreviewStatus" class="stay-preview-status"></div>' +
      '<button id="stayFavoriteSave" class="stay-modal-primary" type="button">Save place</button>' +
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
  const plan = selectedPlan(), who = actor(); if (!plan || !who) return;
  const pasted = clean(document.getElementById('stayFavoriteUrl')?.value);
  const url = normalizeAirbnbLink(pasted);
  const price = clean(document.getElementById('stayFavoritePrice')?.value).replace(',','.');
  const note = clean(document.getElementById('stayFavoriteNote')?.value);
  if (!pasted) { toast('Paste the Airbnb link first','warn'); return; }
  if (!url) { toast('That does not look like an Airbnb link','warn'); return; }
  if (!price || !Number.isFinite(Number(price))) { toast('Add the current total price','warn'); return; }
  const button = document.getElementById('stayFavoriteSave');
  const status = document.getElementById('stayPreviewStatus');
  if (button) button.disabled = true;
  if (status) status.textContent = 'Getting the name and photo…';
  let preview = {source:'airbnb',name:'',image:'',url};
  try { preview = await loadPreview(url); }
  catch {
    preview.name = 'Airbnb stay';
    if (status) status.textContent = 'Preview blocked by the site — saving with a simple placeholder.';
  }
  try {
    await post('saveStayFavorite',{planId:plan.id,price,checkedAt:new Date().toISOString(),favorite:{source:preview.source,url:preview.url||url,name:preview.name,image:preview.image||'',note,city:'',area:''}},who);
    closeModal(); toast('Saved to Our Stays'); await refreshState();
  } catch (error) {
    toast(error.message || 'Could not save this place','warn');
    if (button) button.disabled = false;
  }
}
function openDetails(ownerPlanId,favoriteId){
  const found = favoriteById(ownerPlanId,favoriteId), plan = selectedPlan(); if (!found) return;
  const info = priceInfo(found.favorite,plan);
  const rows = [...(found.favorite.history || [])].sort((a,b) => String(b.checkedAt).localeCompare(String(a.checkedAt))).slice(0,4);
  const link = plan ? buildListingCheckUrl(found.favorite.url,found.favorite.source,{start:plan.meta.start,end:plan.meta.end,adults:2}) : found.favorite.url;
  const selected = !!plan && isSelected(found.favorite,plan);
  const expenseExists = !!plan && hasAccommodationExpense(plan);
  showModal(modalHead('AIRBNB',found.favorite.name,plan ? dateRange(plan.meta.start,plan.meta.end,true) : 'Saved in Our Stays') +
    (found.favorite.image ? '<div class="stay-detail-photo" style="background-image:url(&quot;' + esc(found.favorite.image) + '&quot;)"></div>' : '<div class="stay-detail-photo is-empty">⌂</div>') +
    '<div class="stay-detail-price"><span>Latest price</span><strong>' + (info.latest ? money(info.latest.price) : '—') + '</strong>' + (info.change ? '<b class="' + (info.change.startsWith('↓') ? 'down' : info.change.startsWith('↑') ? 'up' : 'same') + '">' + esc(info.change) + '</b>' : '') + '</div>' +
    (found.favorite.note ? '<div class="stay-detail-notes"><span>Note</span><p>' + esc(found.favorite.note) + '</p></div>' : '') +
    '<div class="stay-detail-primary">' +
      (plan && !expenseExists ? '<button id="stayDetailSelect" class="stay-modal-primary" type="button">Select this stay</button>' : '') +
      (selected ? '<button id="stayDetailExpense" class="stay-modal-primary" type="button">Edit trip expense</button><button id="stayDetailUnselect" class="stay-text-danger" type="button">Unselect from trip</button>' : '') +
    '</div>' +
    '<div class="stay-detail-menu">' +
      '<a href="' + esc(link) + '" target="_blank" rel="noopener noreferrer"><span>Open in Airbnb</span><b>↗</b></a>' +
      (plan ? '<button id="stayDetailPrice" type="button"><span>Update price</span><b>›</b></button>' : '') +
      '<button id="stayEditNotes" type="button"><span>' + (found.favorite.note ? 'Edit note' : 'Add note') + '</span><b>›</b></button>' +
      '<button id="stayDeleteSaved" class="danger" type="button"><span>Remove from Our Stays</span><b>›</b></button>' +
    '</div>' +
    (rows.length > 1 ? '<details class="stay-detail-history"><summary>Price history</summary>' + rows.map((row) => '<div><b>' + money(row.price) + '</b><small>' + esc(dateRange(row.start,row.end)) + '</small></div>').join('') + '</details>' : ''));
  document.getElementById('stayDetailSelect')?.addEventListener('click',() => { closeModal(); selectStay(ownerPlanId,favoriteId); });
  document.getElementById('stayDetailExpense')?.addEventListener('click',() => { closeModal(); openTripExpenseEditor(); });
  document.getElementById('stayDetailUnselect')?.addEventListener('click',() => { closeModal(); unselectStay(); });
  document.getElementById('stayDetailPrice')?.addEventListener('click',() => openPriceModal(ownerPlanId,favoriteId));
  document.getElementById('stayEditNotes')?.addEventListener('click',() => openEditNotes(ownerPlanId,favoriteId));
  document.getElementById('stayDeleteSaved')?.addEventListener('click',() => removeFavorite(ownerPlanId,favoriteId));
}
function openEditNotes(ownerPlanId,favoriteId){
  const found = favoriteById(ownerPlanId,favoriteId); if (!found) return;
  showModal(modalHead('NOTES',found.favorite.name,'Add or change anything you want to remember about this stay.') +
    '<div class="stay-form">' +
      '<label><span>Notes</span><textarea id="stayEditedNote" rows="5" placeholder="Anything you want to remember">' + esc(found.favorite.note || '') + '</textarea></label>' +
      '<button id="stayNoteSave" class="stay-modal-primary" type="button">Save notes</button>' +
    '</div>');
  document.getElementById('stayNoteSave')?.addEventListener('click',() => saveNotes(ownerPlanId,favoriteId));
}
async function saveNotes(ownerPlanId,favoriteId){
  const who = actor(); if (!who) return;
  const note = clean(document.getElementById('stayEditedNote')?.value);
  try {
    await post('updateStayFavoriteDetails',{ownerPlanId,favoriteId,note},who);
    closeModal(); toast(note ? 'Notes saved' : 'Notes cleared'); await refreshState();
  } catch (error) { toast(error.message || 'Could not save the notes','warn'); }
}
async function removeFavorite(ownerPlanId,favoriteId){
  const found = favoriteById(ownerPlanId,favoriteId), who = actor(); if (!found || !who) return;
  if (!window.confirm('Remove this stay from Our Stays? Any accommodation expense already logged for a trip will stay untouched.')) return;
  try {
    await post('deleteStayFavorite',{ownerPlanId,favoriteId},who);
    closeModal(); toast('Removed from Our Stays'); await refreshState();
  } catch (error) { toast(error.message || 'Could not remove this stay','warn'); }
}
function openPriceModal(ownerPlanId,favoriteId){
  const found = favoriteById(ownerPlanId,favoriteId), plan = selectedPlan(); if (!found || !plan) return;
  const info = priceInfo(found.favorite,plan);
  const link = buildListingCheckUrl(found.favorite.url,found.favorite.source,{start:plan.meta.start,end:plan.meta.end,adults:2});
  showModal(modalHead('PRICE CHECK',found.favorite.name,'Open it for these dates, then type the new total.') +
    '<div class="stay-price-check"><a href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">Check ' + esc(dateRange(plan.meta.start,plan.meta.end)) + ' ↗</a>' +
      '<label><span>Current total price</span><div class="stay-big-price"><b>€</b><input id="stayUpdatedPrice" inputmode="decimal" value="' + esc(info.current?.price ?? info.latest?.price ?? '') + '" placeholder="0"></div></label>' +
      '<button id="stayPriceSave" class="stay-modal-primary" type="button">Update price</button></div>');
  document.getElementById('stayPriceSave')?.addEventListener('click',() => updatePrice(ownerPlanId,favoriteId));
}
async function updatePrice(ownerPlanId,favoriteId){
  const plan = selectedPlan(), who = actor(); if (!plan || !who) return;
  const price = clean(document.getElementById('stayUpdatedPrice')?.value).replace(',','.');
  if (!price || !Number.isFinite(Number(price))) { toast('Enter the current total price','warn'); return; }
  try {
    await post('updateStayFavoritePrice',{ownerPlanId,favoriteId,contextPlanId:plan.id,price,checkedAt:new Date().toISOString()},who);
    closeModal(); toast('Price updated'); await refreshState();
  } catch (error) { toast(error.message || 'Could not update the price','warn'); }
}
async function selectStay(ownerPlanId,favoriteId){
  const plan = selectedPlan(), who = actor(); if (!plan || !who) return;
  if (hasAccommodationExpense(plan)) { toast('This trip already has an accommodation expense','warn'); return; }
  try {
    await post('selectStayForTrip',{planId:plan.id,ownerPlanId,favoriteId},who);
    toast('Stay selected and accommodation expense logged');
    await refreshState();
  } catch (error) { toast(error.message || 'Could not select this stay','warn'); }
}
async function unselectStay(){
  const plan = selectedPlan(), who = actor(); if (!plan || !who) return;
  if (!window.confirm('Unselect this stay? Its accommodation expense will be removed from this trip too.')) return;
  try {
    await post('unselectStayForTrip',{planId:plan.id},who);
    toast('Stay unselected and accommodation expense removed');
    await refreshState();
  } catch (error) { toast(error.message || 'Could not unselect this stay','warn'); }
}
function openTripExpenseEditor(){
  const plan = selectedPlan(); if (!plan) return;
  document.querySelector('[data-sheet="log"]')?.click();
  setTimeout(() => window.TwogetherWorkflow?.start?.(plan.id),80);
}
async function refreshState(){
  try {
    state = await window.TwogetherAPI.remoteState();
    if (selectedPlanId !== OVERVIEW && !planById(selectedPlanId)) selectedPlanId = OVERVIEW;
    render();
  } catch {
    state = {plans:[]};
    render();
  }
}
function openForPlan(planId){
  selectedPlanId = planId && planById(planId) ? planId : OVERVIEW;
  try { localStorage.setItem(VIEW_KEY,selectedPlanId); } catch {}
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
