import { actor, esc, money, post } from './budget-state.js';
import { toast } from '../lib/toast.js';
import { buildBookingSearchUrl, buildAirbnbSearchUrl, buildListingCheckUrl } from './stay-search-links.js';

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
function selectedPlan(){ return selectedPlanId === OVERVIEW ? null : planById(selectedPlanId); }
function hasAccommodationExpense(plan){
  const total = plan?.sharedExpenses?.accom?.total;
  return total !== '' && total != null;
}
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
function sourceFromUrl(value){ return clean(value).toLowerCase().includes('airbnb.') ? 'airbnb' : 'booking'; }
function allFavorites(){
  const found = [];
  (Array.isArray(state?.plans) ? state.plans : []).forEach((owner) => {
    (Array.isArray(owner?.stayTracker?.saved) ? owner.stayTracker.saved : []).forEach((favorite) => {
      found.push({...favorite, ownerPlanId:owner.id});
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
function sortedFavorites(plan){
  return allFavorites().sort((a,b) => {
    const pa = Number(priceInfo(a,plan).latest?.price || Infinity);
    const pb = Number(priceInfo(b,plan).latest?.price || Infinity);
    if (pa !== pb) return pa - pb;
    return clean(a.name).localeCompare(clean(b.name));
  });
}
function planOptions(){
  return '<option value="' + OVERVIEW + '"' + (selectedPlanId === OVERVIEW ? ' selected' : '') + '>Overview · all saved stays</option>' +
    plans().map((plan) => '<option value="' + esc(plan.id) + '"' + (plan.id === selectedPlanId ? ' selected' : '') + '>' +
      esc((plan.meta.city || plan.meta.location || 'Trip') + ' · ' + dateRange(plan.meta.start,plan.meta.end)) + '</option>').join('');
}
function searchPanel(plan){
  const input = { destination:destinationFor(plan), start:plan.meta.start, end:plan.meta.end, adults:2 };
  const booking = buildBookingSearchUrl(input);
  const airbnb = buildAirbnbSearchUrl(input);
  return '<section class="our-stays-search">' +
    '<div class="our-stays-search-copy"><span class="stay-label">FIND A PLACE</span><strong>' + esc(destinationFor(plan)) + '</strong><p>' + esc(dateRange(plan.meta.start,plan.meta.end)) + ' · 2 guests already filled in.</p></div>' +
    '<div class="our-stays-search-links">' +
      '<a href="' + esc(booking) + '" target="_blank" rel="noopener noreferrer"><b>B</b><span>Booking.com<small>Cheapest first · dates ready</small></span><i>↗</i></a>' +
      '<a class="airbnb" href="' + esc(airbnb) + '" target="_blank" rel="noopener noreferrer"><b>⌂</b><span>Airbnb<small>Dates + guests ready</small></span><i>↗</i></a>' +
    '</div>' +
    (hasAccommodationExpense(plan) ? '<div class="our-stays-expense-done">✓ Accommodation expense already logged for this trip. Our Stays will not add another.</div>' : '') +
  '</section>';
}
function overviewPanel(){
  return '<section class="our-stays-overview-note"><span>♡</span><div><strong>Your accommodation watchlist</strong><p>Choose a trip above to apply its dates to every saved stay and compare the newest prices.</p></div></section>';
}
function stayCard(favorite, plan){
  const info = priceInfo(favorite, plan);
  const source = favorite.source === 'airbnb' ? 'Airbnb' : 'Booking.com';
  const displayPrice = info.latest?.price;
  const checkUrl = plan ? buildListingCheckUrl(favorite.url,favorite.source,{start:plan.meta.start,end:plan.meta.end,adults:2}) : favorite.url;
  const selected = !!plan && isSelected(favorite,plan);
  const expenseExists = !!plan && hasAccommodationExpense(plan);
  return '<article class="our-stay-card">' +
    '<button class="our-stay-main" type="button" data-stay-details="' + esc(favorite.id) + '" data-owner-plan="' + esc(favorite.ownerPlanId) + '">' +
      '<span class="our-stay-photo ' + (favorite.image ? '' : 'is-empty') + '"' + (favorite.image ? ' style="background-image:url(&quot;' + esc(favorite.image) + '&quot;)"' : '') + '></span>' +
      '<span class="our-stay-copy"><span class="our-stay-source">' + esc(source) + '</span><strong>' + esc(favorite.name || source + ' stay') + '</strong><small>' + (plan ? esc(dateRange(plan.meta.start,plan.meta.end)) : 'Saved favourite') + '</small></span>' +
      '<span class="our-stay-money"><strong>' + (displayPrice != null ? money(displayPrice) : '—') + '</strong>' +
        (info.change ? '<b class="' + (info.change.startsWith('↓') ? 'down' : info.change.startsWith('↑') ? 'up' : 'same') + '">' + esc(info.change) + '</b>' : '') +
      '</span>' +
    '</button>' +
    '<div class="our-stay-actions">' +
      '<a href="' + esc(checkUrl) + '" target="_blank" rel="noopener noreferrer">' + (plan ? 'Check dates' : 'Open') + ' ↗</a>' +
      (plan ? '<button type="button" data-update-price="' + esc(favorite.id) + '" data-owner-plan="' + esc(favorite.ownerPlanId) + '">Update price</button>' : '') +
      (plan && !expenseExists ? '<button class="select" type="button" data-select-stay="' + esc(favorite.id) + '" data-owner-plan="' + esc(favorite.ownerPlanId) + '">Select</button>' : '') +
      (selected ? '<span class="selected">✓ Selected</span>' : '') +
      (plan && expenseExists ? '<button type="button" data-edit-accommodation>Trip expense</button>' : '') +
    '</div>' +
  '</article>';
}
function render(){
  const el = root(); if (!el) return;
  if (selectedPlanId !== OVERVIEW && !planById(selectedPlanId)) selectedPlanId = OVERVIEW;
  const plan = selectedPlan();
  const favorites = sortedFavorites(plan);
  el.innerHTML = '<div class="our-stays-page">' +
    '<header class="our-stays-head"><div><span class="eyebrow">TRIPS</span><h1>Our Stays</h1><p>Save the places you love, recheck them for new dates, and choose one when it becomes the trip accommodation.</p></div>' +
      (plan ? '<button id="ourStaySaveTop" class="our-stays-save" type="button">＋ Save place</button>' : '') +
    '</header>' +
    '<section class="our-stays-switcher"><label><span>View</span><select id="ourStayPlanSelect">' + planOptions() + '</select></label>' +
      '<div class="our-stays-date"><span>' + (plan ? 'Checking for' : 'Saved collection') + '</span><strong>' + (plan ? esc(dateRange(plan.meta.start,plan.meta.end,true)) : 'All favourites') + '</strong><small>' + (plan ? '2 guests' : 'Choose a trip to recheck') + '</small></div></section>' +
    (plan ? searchPanel(plan) : overviewPanel()) +
    '<section class="our-stays-collection"><div class="our-stays-section-title"><div><span class="stay-label">' + (plan ? 'SAVED FOR RECHECK' : 'OUR COLLECTION') + '</span><h2>' +
      (favorites.length ? favorites.length + ' saved ' + (favorites.length === 1 ? 'place' : 'places') : 'No saved places yet') +
      '</h2></div>' + (plan && favorites.length ? '<button id="ourStaySaveInline" type="button">＋ Add</button>' : '') + '</div>' +
      (favorites.length ? '<div class="our-stays-grid">' + favorites.map((favorite) => stayCard(favorite,plan)).join('') + '</div>' :
        '<div class="our-stays-empty"><span>♡</span><p>' + (plan ? 'Search above, then save the places you want to compare.' : 'Your saved Booking.com and Airbnb places will appear here.') + '</p>' +
        (plan ? '<button id="ourStaySaveEmpty" type="button">Save first place</button>' : '') + '</div>') +
    '</section></div><div id="stayModalRoot"></div>';
  bind();
}
function bind(){
  document.getElementById('ourStayPlanSelect')?.addEventListener('change',(event) => {
    selectedPlanId = event.target.value;
    try { localStorage.setItem(VIEW_KEY,selectedPlanId); } catch {}
    render();
  });
  ['ourStaySaveTop','ourStaySaveInline','ourStaySaveEmpty'].forEach((id) => document.getElementById(id)?.addEventListener('click',openSaveModal));
  document.querySelectorAll('[data-stay-details]').forEach((button) => button.addEventListener('click',() => openDetails(button.dataset.ownerPlan,button.dataset.stayDetails)));
  document.querySelectorAll('[data-update-price]').forEach((button) => button.addEventListener('click',() => openPriceModal(button.dataset.ownerPlan,button.dataset.updatePrice)));
  document.querySelectorAll('[data-select-stay]').forEach((button) => button.addEventListener('click',() => selectStay(button.dataset.ownerPlan,button.dataset.selectStay)));
  document.querySelectorAll('[data-edit-accommodation]').forEach((button) => button.addEventListener('click',openTripExpenseEditor));
}
function favoriteById(ownerPlanId,favoriteId){
  const owner = (state?.plans || []).find((plan) => plan.id === ownerPlanId);
  const favorite = (owner?.stayTracker?.saved || []).find((item) => item.id === favoriteId);
  return favorite ? {owner,favorite} : null;
}
function showModal(inner){
  const host = document.getElementById('stayModalRoot'); if (!host) return;
  host.innerHTML = '<div class="stay-modal"><button class="stay-modal-backdrop" data-stay-close aria-label="Close"></button><section class="stay-modal-sheet">' + inner + '</section></div>';
  document.body.classList.add('stay-modal-open');
  host.querySelectorAll('[data-stay-close]').forEach((button) => button.addEventListener('click',closeModal));
}
function closeModal(){
  const host = document.getElementById('stayModalRoot'); if (host) host.innerHTML = '';
  document.body.classList.remove('stay-modal-open');
}
function modalHead(kicker,title,copy){
  return '<div class="stay-modal-head"><div><span class="stay-label">' + esc(kicker) + '</span><h2>' + esc(title) + '</h2><p>' + esc(copy) + '</p></div><button data-stay-close type="button">×</button></div>';
}
function openSaveModal(){
  if (!selectedPlan()) return;
  showModal(modalHead('SAVE PLACE','Add to Our Stays','Paste the link and price. Twogether will try to fetch the name and main photo itself.') +
    '<div class="stay-form">' +
      '<label><span>Booking.com or Airbnb link</span><input id="stayFavoriteUrl" type="url" placeholder="Paste accommodation link"></label>' +
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
  const url = clean(document.getElementById('stayFavoriteUrl')?.value);
  const price = clean(document.getElementById('stayFavoritePrice')?.value).replace(',','.');
  const note = clean(document.getElementById('stayFavoriteNote')?.value);
  if (!url) { toast('Paste the Booking.com or Airbnb link first','warn'); return; }
  if (!price || !Number.isFinite(Number(price))) { toast('Add the current total price','warn'); return; }
  const button = document.getElementById('stayFavoriteSave');
  const status = document.getElementById('stayPreviewStatus');
  if (button) button.disabled = true;
  if (status) status.textContent = 'Getting the name and photo…';
  let preview = {source:sourceFromUrl(url),name:'',image:'',url};
  try { preview = await loadPreview(url); }
  catch {
    preview.name = preview.source === 'airbnb' ? 'Airbnb stay' : 'Booking.com stay';
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
  const rows = [...(found.favorite.history || [])].sort((a,b) => String(b.checkedAt).localeCompare(String(a.checkedAt))).slice(0,6);
  const link = plan ? buildListingCheckUrl(found.favorite.url,found.favorite.source,{start:plan.meta.start,end:plan.meta.end,adults:2}) : found.favorite.url;
  showModal(modalHead(found.favorite.source === 'airbnb' ? 'AIRBNB' : 'BOOKING.COM',found.favorite.name,plan ? dateRange(plan.meta.start,plan.meta.end,true) : 'Saved in Our Stays') +
    (found.favorite.image ? '<div class="stay-detail-photo" style="background-image:url(&quot;' + esc(found.favorite.image) + '&quot;)"></div>' : '') +
    '<div class="stay-detail-price"><span>Latest saved price</span><strong>' + (info.latest ? money(info.latest.price) : '—') + '</strong>' + (info.change ? '<b>' + esc(info.change) + '</b>' : '') + '</div>' +
    '<div class="stay-detail-notes"><span>Notes</span><p>' + (found.favorite.note ? esc(found.favorite.note) : 'No notes added.') + '</p></div>' +
    (rows.length ? '<div class="stay-detail-history"><span>Recent prices</span>' + rows.map((row) => '<div><b>' + money(row.price) + '</b><small>' + esc(dateRange(row.start,row.end)) + '</small></div>').join('') + '</div>' : '') +
    '<a class="stay-detail-link" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">Open accommodation ↗</a>');
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
