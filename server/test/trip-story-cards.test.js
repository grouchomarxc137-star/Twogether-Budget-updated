import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source=readFileSync(new URL('../../src/trips/overview.js',import.meta.url),'utf8');
const start=source.indexOf('function tripStoryPhoto(state, trip) {');
const end=source.indexOf('export function openTripModal(',start);
assert.ok(start>=0&&end>start,'Gallery renderer must exist');
const fragment=source.slice(start,end).replace(/^export\s+/gm,'');

function renderStories(trips,plans=[]) {
  const state={trips,plans},root={innerHTML:''},bindings=[];
  const deps={
    $:key=>key==='#tripGallery'?root:null,
    $$:()=>[{dataset:{openTrip:'trip-1'},addEventListener:(name,fn)=>bindings.push(name)}],
    getState:()=>state,
    isLocked:t=>!!(t.confirmed?.Principessa&&t.confirmed?.Principe),
    tripMeta:t=>t.meta,
    effectiveTrip:()=>({total:245,estimated:false}),
    differences:()=>[],
    budgetInfo:()=>({has:false}),
    locationLabel:m=>m.location||'',
    tripImage:(city,country,seed)=>'PHOTO:'+country+':'+seed,
    preloadTripImages:urls=>urls,
    visibleTrips:s=>s.trips,
    actor:()=> 'Principessa',
    money:x=>'€'+x,
    fmtDate:x=>x,
    esc:x=>String(x),
    openTripModal:()=>{},
  };
  const gallery=new Function(...Object.keys(deps),fragment+'\nreturn {renderTripGallery,preloadTripGalleryImages};')(...Object.values(deps));
  gallery.renderTripGallery();
  return {html:root.innerHTML,preloaded:gallery.preloadTripGalleryImages(),bindings};
}
const confirmed={
  id:'trip-1',meta:{city:'Lonato',location:'Italy',start:'2026-10-17',end:'2026-10-20'},
  confirmed:{Principessa:true,Principe:true},submissions:{Principessa:{},Principe:{}}
};
const linkedPlan={id:'plan-1',linkedTripId:'trip-1',meta:confirmed.meta};

test('confirmed card matches the compact stays layout with trip details and remains clickable',()=>{
  const view=renderStories([confirmed],[linkedPlan]);
  assert.match(view.html,/trip-story-card is-stay-style/);
  assert.match(view.html,/trip-story-photo/);
  assert.match(view.html,/Lonato/);
  assert.match(view.html,/2026-10-17/);
  assert.match(view.html,/€245/);
  assert.match(view.html,/data-open-trip="trip-1"/);
  assert.deepEqual(view.bindings,['click']);
});
test('moving a confirmed linked trip to the past keeps the original plan picture',()=>{
  const active=renderStories([confirmed],[linkedPlan]);
  const past=renderStories([{...confirmed,meta:{...confirmed.meta,end:'2020-10-20'}}],[linkedPlan]);
  assert.match(active.html,/PHOTO:Italy:plan-1/);
  assert.match(past.html,/PHOTO:Italy:plan-1/);
  assert.deepEqual(active.preloaded,['PHOTO:Italy:plan-1']);
});
test('standalone confirmed trips have stable pictures and unconfirmed trips stay separate',()=>{
  const waiting={id:'trip-2',meta:{city:'Amira',location:'Austria'},
    confirmed:{Principessa:true,Principe:false},submissions:{Principessa:{},Principe:{}}};
  const gallery=renderStories([confirmed,waiting]);
  assert.match(gallery.html,/PHOTO:Italy:trip-1/);
  assert.doesNotMatch(gallery.html,/data-open-trip="trip-2"/);
  assert.deepEqual(gallery.preloaded,['PHOTO:Italy:trip-1']);
});
test('trip card CSS uses accommodation-sized photos on desktop and phone',()=>{
  const css=readFileSync(new URL('../../src/trips/trips-simplified.css',import.meta.url),'utf8');
  assert.match(css,/trip-story-card\.is-stay-style/);
  assert.match(css,/grid-template-columns:82px minmax/);
  assert.match(css,/grid-template-columns:72px minmax/);
  assert.match(css,/max-height:none!important/);
  assert.match(css,/opacity:1!important/);
});


test('Trip Stories photo enhancement does not break the original Trips section',()=>{
  const currentTrips=readFileSync(new URL('../../src/trips/current-trips.js',import.meta.url),'utf8');
  const decoratorStart=currentTrips.indexOf('function decorateTripStories() {');
  const decoratorEnd=currentTrips.indexOf('\nexport async function refreshState',decoratorStart);
  assert.ok(decoratorStart>=0&&decoratorEnd>decoratorStart,'Story decorator must exist');

  // $ selects a single element and $$ selects a collection. Calling
  // .forEach on $ previously interrupted the Trips refresh completely.
  const gallery={};
  let photoUpdates=0;
  const compactCard={
    classList:{contains:label=>label==='is-stay-style'},
    style:{setProperty:()=>{photoUpdates++;}},
    dataset:{openTrip:'confirmed-trip'}
  };
  const legacyCard={
    classList:{contains:()=>false},
    style:{setProperty:()=>{photoUpdates++;}},
    dataset:{openTrip:'older-trip'}
  };
  const single=(selector,root)=>{
    if(selector==='#tripGallery')return gallery;
    if(selector==='.trip-country')return {textContent:'Italy'};
    if(selector==='h3')return {textContent:'Lonato'};
    return null;
  };
  const many=(selector,root)=>{
    assert.equal(selector,'.trip-story-card');
    assert.equal(root,gallery);
    return [compactCard,legacyCard];
  };
  const decorator=new Function('$','$$','tripImage',
    currentTrips.slice(decoratorStart,decoratorEnd)+'\nreturn decorateTripStories;')(
      single,many,()=>'/photo.webp');
  assert.doesNotThrow(()=>decorator());
  assert.equal(photoUpdates,1,'Only legacy images need enhancement');
  assert.equal(legacyCard.dataset.v28Background,'1');
  assert.equal(compactCard.dataset.v28Background,undefined,'Keep the confirmed card original photo');

  // Running the Trips home renderer afterwards must still show active
  // trips and the original New trip button above Trip Stories.
  const homeStart=currentTrips.indexOf('function simplifiedHome(items) {');
  const homeEnd=currentTrips.indexOf('\nfunction simplifiedTrip(',homeStart);
  const renderStart=currentTrips.indexOf('function renderCurrentTrips() {');
  const renderEnd=currentTrips.indexOf('\nconst EXPENSE_CATS',renderStart);
  assert.ok(homeStart>=0&&homeEnd>homeStart&&renderStart>=0&&renderEnd>renderStart);
  const root={style:{},classList:{remove:()=>{}},innerHTML:''};
  const section={classList:{remove:()=>{}}};
  const deps={
    $:selector=>selector==='#twCurrentTrips'?root:null,
    ensureCurrentTrips:()=>section,
    remoteState:{plans:[],trips:[]},
    simplifiedView:{name:'home'},
    setTripFocusLock:()=>{},
    allSimplifiedItems:()=>[{phase:'upcoming'}],
    simplifiedCard:()=>'<button class="tv2-card">Upcoming Lonato</button>',
    esc:x=>String(x)
  };
  const render=new Function(...Object.keys(deps),
    currentTrips.slice(homeStart,homeEnd)+currentTrips.slice(renderStart,renderEnd)+
    '\nreturn renderCurrentTrips;')(...Object.values(deps));
  render();
  assert.match(root.innerHTML,/>Trips<\/h1>/);
  assert.match(root.innerHTML,/Upcoming Lonato/);
  assert.match(root.innerHTML,/New trip/);
});
