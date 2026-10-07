import { actor, esc, money, post } from './budget-state.js';
import { toast } from '../lib/toast.js';
import { buildBookingSearchUrl, buildAirbnbSearchUrl, buildListingCheckUrl } from './stay-search-links.js';

const ROOT_ID = 'stayTrackerRoot';
const VIEW_KEY = 'twogether_stay_tracker_plan_v2';
const AREA_KEY = 'twogether_stay_tracker_area_v2';
const GARDA_TOWNS = ['manerba','moniga','padenghe','desenzano','lonato','sirmione','peschiera','garda'];
const DEFAULT_PREFS = { maxTotal:'', parking:false, washingMachine:false, entirePlace:true, bedrooms:1, wifi:false, kitchen:false, airConditioning:false, pool:false };

let state = null;
let selectedPlanId = '';
let selectedArea = 'lake-garda';

function root() { return document.getElementById(ROOT_ID); }
function clean(value) { return String(value == null ? '' : value).trim(); }
function normalize(value) { return clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim(); }
function todayIso() { return new Date().toISOString().slice(0,10); }
function availablePlans() {
  return (Array.isArray(state?.plans) ? state.plans : [])
    .filter((plan) => plan?.meta?.start && plan?.meta?.end)
    .sort((a,b) => String(a.meta.start).localeCompare(String(b.meta.start)));
}
function selectedPlan() { return availablePlans().find((plan) => plan.id === selectedPlanId) || availablePlans()[0] || null; }
function dateRange(start,end) {
  const fmt=(value)=>{
    if(!value)return 'No date';
    const date=new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime())?value:new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short'}).format(date);
  };
  return `${fmt(start)} – ${fmt(end)}`;
}
function nights(start,end) {
  const a=Date.parse(`${start}T00:00:00Z`),b=Date.parse(`${end}T00:00:00Z`);
  return Number.isFinite(a)&&Number.isFinite(b)?Math.max(1,Math.round((b-a)/86400000)):1;
}
function planLabel(plan) {
  const meta=plan?.meta||{};
  const place=meta.city||(meta.location==='Other'?meta.otherLocation:meta.location)||'Trip';
  return `${place} · ${dateRange(meta.start,meta.end)}`;
}
function areaFromCity(city) {
  const value=normalize(city);
  if(value.includes('bergamo'))return 'bergamo';
  if(GARDA_TOWNS.some((town)=>value.includes(town)))return 'lake-garda';
  return '';
}
function inferArea(plan) {
  const city=clean(plan?.meta?.city);
  return areaFromCity(city)||clean(plan?.stayTracker?.area)||selectedArea||'lake-garda';
}
function isItalyWithoutCity(plan) {
  return normalize(plan?.meta?.location)==='italy'&&!clean(plan?.meta?.city);
}
function destinationFor(plan) {
  const meta=plan?.meta||{};
  if(clean(meta.city))return `${clean(meta.city)}, ${clean(meta.location)||'Italy'}`;
  if(isItalyWithoutCity(plan))return selectedArea==='bergamo'?'Bergamo, Italy':'Lake Garda, Italy';
  return clean(meta.otherLocation)||clean(meta.location)||'Italy';
}
function prefsFor(plan) {
  return {...DEFAULT_PREFS,...(plan?.stayTracker?.preferences||{})};
}
function readPrefs() {
  return {
    maxTotal:clean(document.getElementById('stayMaxTotal')?.value),
    parking:document.getElementById('stayParking')?.checked===true,
    washingMachine:document.getElementById('stayWashing')?.checked===true,
    entirePlace:document.getElementById('stayEntire')?.checked===true,
    bedrooms:Math.max(0,Number(document.getElementById('stayBedrooms')?.value||0)),
    wifi:document.getElementById('stayWifi')?.checked===true,
    kitchen:document.getElementById('stayKitchen')?.checked===true,
    airConditioning:document.getElementById('stayAircon')?.checked===true,
    pool:document.getElementById('stayPool')?.checked===true,
  };
}
function searchInput(plan,prefs) {
  return {
    destination:destinationFor(plan),
    start:plan.meta.start,end:plan.meta.end,adults:2,
    nights:nights(plan.meta.start,plan.meta.end),
    ...prefs,
  };
}
function allFavorites() {
  const out=[];
  (Array.isArray(state?.plans)?state.plans:[]).forEach((plan)=>{
    (Array.isArray(plan?.stayTracker?.saved)?plan.stayTracker.saved:[]).forEach((favorite)=>{
      out.push({...favorite,ownerPlanId:plan.id});
    });
  });
  const seen=new Set();
  return out.filter((item)=>{
    const key=clean(item.url).split(/[?#]/)[0].replace(/\/$/,'').toLowerCase();
    if(!key||seen.has(key))return false;
    seen.add(key);return true;
  });
}
function favoriteMatches(favorite,plan) {
  const city=clean(plan?.meta?.city);
  const planArea=areaFromCity(city)||inferArea(plan);
  const favArea=clean(favorite.area)||areaFromCity(favorite.city);
  if(planArea==='lake-garda'||planArea==='bergamo')return favArea===planArea;
  return !!city&&normalize(favorite.city)===normalize(city);
}
function favoriteHistoryForTrip(favorite,plan) {
  return (Array.isArray(favorite.history)?favorite.history:[])
    .filter((item)=>item.start===plan.meta.start&&item.end===plan.meta.end)
    .sort((a,b)=>String(a.checkedAt).localeCompare(String(b.checkedAt)));
}
function latestAny(favorite) {
  return [...(Array.isArray(favorite.history)?favorite.history:[])].sort((a,b)=>String(a.checkedAt).localeCompare(String(b.checkedAt))).pop()||null;
}
function favoritePriceState(favorite,plan) {
  const history=favoriteHistoryForTrip(favorite,plan);
  const current=history[history.length-1]||null;
  const previous=history[history.length-2]||null;
  const any=latestAny(favorite);
  const low=history.length?Math.min(...history.map((item)=>Number(item.price)||Infinity)):null;
  let change='';
  if(current&&previous){
    const diff=Math.round((Number(current.price)-Number(previous.price))*100)/100;
    change=Math.abs(diff)<.01?'Same as last check':diff<0?`↓ ${money(Math.abs(diff))}`:`↑ ${money(diff)}`;
  }
  const age=current?Date.now()-Date.parse(current.checkedAt):Infinity;
  return {history,current,previous,any,low:Number.isFinite(low)?low:null,change,needsRecheck:!current||!Number.isFinite(age)||age>3*86400000};
}
function matchingFavorites(plan) {
  return allFavorites().filter((favorite)=>favoriteMatches(favorite,plan)).sort((a,b)=>{
    const pa=favoritePriceState(a,plan).current?.price;
    const pb=favoritePriceState(b,plan).current?.price;
    if(pa!==undefined&&pb!==undefined)return Number(pa)-Number(pb);
    if(pa!==undefined)return -1;if(pb!==undefined)return 1;
    return clean(a.name).localeCompare(clean(b.name));
  });
}
function requirementLabels(prefs) {
  const labels=['2 guests'];
  if(prefs.entirePlace)labels.push('entire place');
  if(Number(prefs.bedrooms)>0)labels.push(`${prefs.bedrooms}+ bedroom${Number(prefs.bedrooms)===1?'':'s'}`);
  if(prefs.parking)labels.push('parking');
  if(prefs.washingMachine)labels.push('washing machine');
  if(prefs.wifi)labels.push('Wi-Fi');
  if(prefs.kitchen)labels.push('kitchen');
  if(prefs.airConditioning)labels.push('A/C');
  if(prefs.pool)labels.push('pool');
  if(Number(prefs.maxTotal)>0)labels.push(`max ${money(prefs.maxTotal)} total`);
  return labels;
}
function renderEmpty() {
  const el=root();if(!el)return;
  el.innerHTML='<div class="stay-empty"><span>⌂</span><h2>Add trip dates first</h2><p>Stay Tracker becomes available once a trip has dates.</p></div>';
}
function render() {
  const el=root();if(!el)return;
  const plans=availablePlans();
  if(!plans.length)return renderEmpty();
  const plan=selectedPlan();
  if(!selectedPlanId||!plans.some((item)=>item.id===selectedPlanId))selectedPlanId=plan.id;
  selectedArea=inferArea(plan);
  const prefs=prefsFor(plan);
  const favorites=matchingFavorites(plan);
  const tripNights=nights(plan.meta.start,plan.meta.end);
  const areaChoice=isItalyWithoutCity(plan);
  const search=searchInput(plan,prefs);
  const bookingUrl=buildBookingSearchUrl(search);
  const airbnbUrl=buildAirbnbSearchUrl(search);
  const prepared=requirementLabels(prefs);

  el.innerHTML=`
  <div class="stay-page">
    <header class="stay-head">
      <div><span class="eyebrow">ACCOMMODATION</span><h1>Stay Tracker</h1><p>Twogether prepares the search. You browse the real sites, save the places you love, then occasionally recheck their price.</p></div>
      <button class="stay-save-top" id="staySaveFavorite" type="button">♡ Save a stay</button>
    </header>

    <section class="stay-trip-card">
      <div class="stay-trip-main"><label>Trip</label><select id="stayTripSelect">${plans.map((item)=>`<option value="${esc(item.id)}" ${item.id===selectedPlanId?'selected':''}>${esc(planLabel(item))}</option>`).join('')}</select></div>
      <div class="stay-trip-meta"><span>${esc(dateRange(plan.meta.start,plan.meta.end))}</span><b>${tripNights} ${tripNights===1?'night':'nights'}</b></div>
    </section>

    ${areaChoice?`<section class="stay-area-choice"><div><strong>Where should we look?</strong><span>You haven't chosen a city yet.</span></div><div class="stay-area-buttons"><button type="button" data-stay-area="lake-garda" class="${selectedArea==='lake-garda'?'active':''}">Lake Garda</button><button type="button" data-stay-area="bergamo" class="${selectedArea==='bergamo'?'active':''}">Bergamo</button></div><small>${selectedArea==='lake-garda'?'Manerba · Moniga · Padenghe · Desenzano · Lonato · Sirmione · Peschiera':'Bergamo and nearby towns'}</small></section>`:''}

    <section class="stay-search-card">
      <div class="stay-search-heading"><div><span class="stay-label">SEARCH FOR THIS TRIP</span><strong>${esc(destinationFor(plan))}</strong><small>Dates and 2 guests are prepared automatically.</small></div></div>
      <div class="stay-filter-grid">
        <label class="stay-price"><span>Max total <i>optional</i></span><div><b>€</b><input id="stayMaxTotal" inputmode="numeric" placeholder="Any" value="${esc(prefs.maxTotal)}"></div></label>
        <label class="stay-bedrooms"><span>Bedrooms</span><select id="stayBedrooms"><option value="0" ${!prefs.bedrooms?'selected':''}>Any</option>${[1,2,3,4].map((n)=>`<option value="${n}" ${Number(prefs.bedrooms)===n?'selected':''}>${n}+</option>`).join('')}</select></label>
      </div>
      <div class="stay-toggle-grid">
        ${toggle('stayEntire','Entire place',prefs.entirePlace)}
        ${toggle('stayParking','Parking',prefs.parking)}
        ${toggle('stayWashing','Washing machine',prefs.washingMachine)}
        ${toggle('stayWifi','Wi-Fi',prefs.wifi)}
        ${toggle('stayKitchen','Kitchen',prefs.kitchen)}
        ${toggle('stayAircon','A/C',prefs.airConditioning)}
        ${toggle('stayPool','Pool',prefs.pool)}
      </div>
      <div class="stay-prepared"><span>Prepared</span><p>${prepared.map(esc).join(' · ')}</p></div>
      <div class="stay-search-actions">
        <a id="stayBookingSearch" href="${esc(bookingUrl)}" target="_blank" rel="noopener noreferrer"><b>B</b><span>Search Booking.com<small>Dates + supported filters ready</small></span><i>↗</i></a>
        <a class="airbnb" id="stayAirbnbSearch" href="${esc(airbnbUrl)}" target="_blank" rel="noopener noreferrer"><b>⌂</b><span>Search Airbnb<small>Dates + budget + filters ready</small></span><i>↗</i></a>
      </div>
      <p class="stay-source-note">Each site controls its own filters. Twogether passes the ones the site accepts reliably and keeps your full wish-list here so nothing is forgotten.</p>
    </section>

    <section class="stay-watchlist">
      <div class="stay-section-head"><div><span class="stay-label">YOUR SAVED STAYS</span><h2>${favorites.length?'Favourites for this area':'Nothing saved here yet'}</h2><p>${favorites.length?'They come back automatically on future trips in the same area.':'Search above, then save the places worth watching.'}</p></div>${favorites.length?'<button id="staySaveFavoriteInline" type="button">+ Add favourite</button>':''}</div>
      ${favorites.length?`<div class="stay-grid">${favorites.map((favorite,index)=>favoriteCard(favorite,plan,index===0)).join('')}</div>`:'<div class="stay-empty stay-empty-small"><span>♡</span><p>Your Booking.com and Airbnb favourites will live here.</p><button id="staySaveFavoriteEmpty" type="button">Save a stay</button></div>'}
    </section>
  </div>
  <div id="stayModalRoot"></div>`;
  bind();
}
function toggle(id,label,checked) {
  return `<label class="stay-toggle"><input id="${id}" type="checkbox" ${checked?'checked':''}><span>✓</span><b>${esc(label)}</b></label>`;
}
function favoriteCard(favorite,plan,first) {
  const price=favoritePriceState(favorite,plan);
  const tripNights=nights(plan.meta.start,plan.meta.end);
  const current=price.current?Number(price.current.price):0;
  const nightly=current?current/tripNights:0;
  const source=favorite.source==='airbnb'?'Airbnb':'Booking.com';
  const checkUrl=buildListingCheckUrl(favorite.url,favorite.source,{start:plan.meta.start,end:plan.meta.end,adults:2});
  const lastSeen=price.any?Number(price.any.price):0;
  let priceLine='';
  if(current){
    priceLine=`<strong>${money(current)}</strong><span>${money(nightly)} / night</span>`;
  }else if(lastSeen){
    priceLine=`<strong class="muted-price">${money(lastSeen)}</strong><span>last seen · recheck for these dates</span>`;
  }else{
    priceLine='<strong class="muted-price">No price yet</strong><span>check the listing for these dates</span>';
  }
  return `<article class="stay-card ${price.needsRecheck?'needs-recheck':''}">
    <div class="stay-photo ${favorite.image?'':'is-placeholder'}" ${favorite.image?`style="background-image:url(&quot;${esc(favorite.image)}&quot;)"`:''}>
      <span class="stay-source ${favorite.source==='airbnb'?'is-airbnb':''}">${esc(source)}</span>
      ${price.needsRecheck?'<span class="stay-recheck">Needs recheck</span>':first&&current?'<span class="stay-cheapest">Cheapest checked</span>':''}
    </div>
    <div class="stay-card-body">
      <div class="stay-card-title"><div><h3>${esc(favorite.name)}</h3><p>${esc(favorite.city||destinationFor(plan))}</p></div><button type="button" class="stay-remove" data-remove-favorite="${esc(favorite.id)}" data-owner-plan="${esc(favorite.ownerPlanId)}" aria-label="Remove favourite">♡</button></div>
      <div class="stay-price-row"><div>${priceLine}</div>${price.change?`<b class="${price.change.startsWith('↓')?'down':price.change.startsWith('↑')?'up':'same'}">${esc(price.change)}</b>`:''}</div>
      <div class="stay-history-row">${price.low!=null?`<span>Lowest this trip <b>${money(price.low)}</b></span>`:''}${price.current?`<span>Checked ${esc(relativeDate(price.current.checkedAt))}</span>`:''}</div>
      ${favorite.note?`<p class="stay-note">${esc(favorite.note)}</p>`:''}
      <div class="stay-card-actions">
        <a href="${esc(checkUrl)}" target="_blank" rel="noopener noreferrer">Check for these dates ↗</a>
        <button type="button" data-update-price="${esc(favorite.id)}" data-owner-plan="${esc(favorite.ownerPlanId)}">Update price</button>
      </div>
    </div>
  </article>`;
}
function relativeDate(value) {
  const time=Date.parse(value);if(!Number.isFinite(time))return '';
  const days=Math.floor((Date.now()-time)/86400000);
  if(days<=0)return 'today';if(days===1)return 'yesterday';return `${days} days ago`;
}
function bind() {
  document.getElementById('stayTripSelect')?.addEventListener('change',(event)=>{
    selectedPlanId=event.target.value;
    try{localStorage.setItem(VIEW_KEY,selectedPlanId);}catch{}
    selectedArea=inferArea(selectedPlan());
    render();
  });
  document.querySelectorAll('[data-stay-area]').forEach((button)=>button.addEventListener('click',()=>{
    selectedArea=button.dataset.stayArea;
    try{localStorage.setItem(AREA_KEY,selectedArea);}catch{}
    persistPrefs();
    render();
  }));
  ['staySaveFavorite','staySaveFavoriteInline','staySaveFavoriteEmpty'].forEach((id)=>document.getElementById(id)?.addEventListener('click',openSaveModal));
  document.querySelectorAll('[data-update-price]').forEach((button)=>button.addEventListener('click',()=>openPriceModal(button.dataset.ownerPlan,button.dataset.updatePrice)));
  document.querySelectorAll('[data-remove-favorite]').forEach((button)=>button.addEventListener('click',()=>removeFavorite(button.dataset.ownerPlan,button.dataset.removeFavorite)));
  document.querySelectorAll('#stayMaxTotal,#stayBedrooms,#stayEntire,#stayParking,#stayWashing,#stayWifi,#stayKitchen,#stayAircon,#stayPool').forEach((input)=>input.addEventListener('change',persistPrefs));
  document.getElementById('stayMaxTotal')?.addEventListener('blur',persistPrefs);
  bindPreparedSearch('stayBookingSearch','booking');
  bindPreparedSearch('stayAirbnbSearch','airbnb');
}
function bindPreparedSearch(id,provider) {
  document.getElementById(id)?.addEventListener('click',(event)=>{
    event.preventDefault();
    const plan=selectedPlan();if(!plan)return;
    const prefs=readPrefs();
    persistPrefs(prefs);
    const input=searchInput(plan,prefs);
    const url=provider==='airbnb'?buildAirbnbSearchUrl(input):buildBookingSearchUrl(input);
    window.open(url,'_blank','noopener');
  });
}
function persistPrefs(prefs=readPrefs()) {
  const plan=selectedPlan();const who=actor();if(!plan||!who)return;
  const payload={planId:plan.id,area:selectedArea,preferences:prefs};
  post('saveStaySearchPreferences',payload,who).then(refreshState).catch(()=>{});
}
function sourceFromUrl(value) {
  const text=clean(value).toLowerCase();
  return text.includes('airbnb.')?'airbnb':'booking';
}
function openSaveModal() {
  const plan=selectedPlan();if(!plan)return;
  const city=clean(plan.meta.city)||(selectedArea==='bergamo'?'Bergamo':'Lake Garda');
  showModal(`
    <div class="stay-modal-head"><div><span class="stay-label">SAVE A FAVOURITE</span><h2>Keep this stay in Twogether</h2><p>Paste the listing link and the price you see now. Twogether remembers it for future trips too.</p></div><button data-stay-close type="button">×</button></div>
    <div class="stay-form">
      <label><span>Booking.com or Airbnb link</span><input id="stayFavoriteUrl" type="url" placeholder="Paste listing link"></label>
      <label><span>Name</span><input id="stayFavoriteName" placeholder="e.g. Casa sul Garda"></label>
      <div class="stay-form-pair"><label><span>City</span><input id="stayFavoriteCity" value="${esc(city)}"></label><label><span>Current total price <i>optional</i></span><div class="stay-money-input"><b>€</b><input id="stayFavoritePrice" inputmode="decimal" placeholder="0"></div></label></div>
      <label><span>Photo link <i>optional</i></span><input id="stayFavoriteImage" type="url" placeholder="Paste an image link if you want a photo"></label>
      <label><span>Note <i>optional</i></span><input id="stayFavoriteNote" placeholder="e.g. balcony, quiet street, favourite kitchen"></label>
      <button id="stayFavoriteSave" class="stay-modal-primary" type="button">Save favourite</button>
    </div>`);
  document.getElementById('stayFavoriteUrl')?.addEventListener('input',(event)=>{
    const source=sourceFromUrl(event.target.value);
    document.getElementById('stayFavoriteUrl')?.setAttribute('data-source',source);
  });
  document.getElementById('stayFavoriteSave')?.addEventListener('click',saveFavorite);
}
async function saveFavorite() {
  const plan=selectedPlan();const who=actor();if(!plan||!who)return;
  const url=clean(document.getElementById('stayFavoriteUrl')?.value);
  const name=clean(document.getElementById('stayFavoriteName')?.value);
  const city=clean(document.getElementById('stayFavoriteCity')?.value);
  const price=clean(document.getElementById('stayFavoritePrice')?.value);
  const image=clean(document.getElementById('stayFavoriteImage')?.value);
  const note=clean(document.getElementById('stayFavoriteNote')?.value);
  if(!url||!name){toast('Add the listing link and a name first','warn');return;}
  const source=sourceFromUrl(url);
  const button=document.getElementById('stayFavoriteSave');if(button)button.disabled=true;
  try{
    await post('saveStayFavorite',{
      planId:plan.id,price,checkedAt:new Date().toISOString(),
      favorite:{source,url,name,city,area:areaFromCity(city)||inferArea(plan),image,note,requirements:readPrefs()}
    },who);
    closeModal();toast('Favourite saved');
    await refreshState();
  }catch(error){toast(error.message||'Could not save the accommodation','warn');if(button)button.disabled=false;}
}
function findFavorite(ownerPlanId,favoriteId) {
  const owner=(state?.plans||[]).find((plan)=>plan.id===ownerPlanId);
  const favorite=(owner?.stayTracker?.saved||[]).find((item)=>item.id===favoriteId);
  return favorite?{owner,favorite}:null;
}
function openPriceModal(ownerPlanId,favoriteId) {
  const found=findFavorite(ownerPlanId,favoriteId);const plan=selectedPlan();if(!found||!plan)return;
  const price=favoritePriceState(found.favorite,plan);
  const last=price.current?.price??price.any?.price??'';
  showModal(`
    <div class="stay-modal-head"><div><span class="stay-label">PRICE CHECK</span><h2>${esc(found.favorite.name)}</h2><p>Open the listing for these dates, then enter the total you see.</p></div><button data-stay-close type="button">×</button></div>
    <div class="stay-price-check">
      <a href="${esc(buildListingCheckUrl(found.favorite.url,found.favorite.source,{start:plan.meta.start,end:plan.meta.end,adults:2}))}" target="_blank" rel="noopener noreferrer">Open listing for ${esc(dateRange(plan.meta.start,plan.meta.end))} ↗</a>
      <label><span>Current total price</span><div class="stay-big-price"><b>€</b><input id="stayUpdatedPrice" inputmode="decimal" value="${esc(last)}" placeholder="0"></div></label>
      <small>Twogether will compare this with your previous checks for the same trip dates.</small>
      <button id="stayPriceSave" class="stay-modal-primary" type="button">Save new price</button>
    </div>`);
  document.getElementById('stayPriceSave')?.addEventListener('click',()=>updatePrice(ownerPlanId,favoriteId));
}
async function updatePrice(ownerPlanId,favoriteId) {
  const plan=selectedPlan();const who=actor();const price=clean(document.getElementById('stayUpdatedPrice')?.value);
  if(!plan||!who)return;if(!price||!Number.isFinite(Number(price.replace(',','.')))){toast('Enter the current total price','warn');return;}
  const button=document.getElementById('stayPriceSave');if(button)button.disabled=true;
  try{
    await post('updateStayFavoritePrice',{ownerPlanId,favoriteId,contextPlanId:plan.id,price:price.replace(',','.'),checkedAt:new Date().toISOString()},who);
    closeModal();toast('Price updated');await refreshState();
  }catch(error){toast(error.message||'Could not update the price','warn');if(button)button.disabled=false;}
}
async function removeFavorite(ownerPlanId,favoriteId) {
  const found=findFavorite(ownerPlanId,favoriteId);const who=actor();if(!found||!who)return;
  if(!window.confirm(`Remove ${found.favorite.name} from saved stays?`))return;
  try{await post('deleteStayFavorite',{ownerPlanId,favoriteId},who);toast('Favourite removed');await refreshState();}catch(error){toast(error.message||'Could not remove it','warn');}
}
function showModal(inner) {
  const host=document.getElementById('stayModalRoot');if(!host)return;
  host.innerHTML=`<div class="stay-modal"><button class="stay-modal-backdrop" data-stay-close aria-label="Close"></button><section class="stay-modal-sheet">${inner}</section></div>`;
  document.body.classList.add('stay-modal-open');
  host.querySelectorAll('[data-stay-close]').forEach((button)=>button.addEventListener('click',closeModal));
}
function closeModal() {
  const host=document.getElementById('stayModalRoot');if(host)host.innerHTML='';
  document.body.classList.remove('stay-modal-open');
}
async function refreshState() {
  try{
    state=await window.TwogetherAPI.remoteState();
    const plans=availablePlans();
    const stored=(()=>{try{return localStorage.getItem(VIEW_KEY)||'';}catch{return '';}})();
    if(!selectedPlanId)selectedPlanId=plans.some((plan)=>plan.id===stored)?stored:(plans.find((plan)=>plan.meta.end>=todayIso())?.id||plans[0]?.id||'');
    const storedArea=(()=>{try{return localStorage.getItem(AREA_KEY)||'';}catch{return '';}})();
    selectedArea=inferArea(selectedPlan())||storedArea||'lake-garda';
    render();
  }catch{state={plans:[]};render();}
}
export function initStayTracker() {
  refreshState();
  document.addEventListener('twogether:saved',refreshState);
  document.addEventListener('twogether:budget-refreshed',refreshState);
  document.addEventListener('twogether:trips-refreshed',refreshState);
  document.querySelector('[data-sheet="stay-tracker"]')?.addEventListener('click',()=>setTimeout(refreshState,0));
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initStayTracker,{once:true});
else initStayTracker();
