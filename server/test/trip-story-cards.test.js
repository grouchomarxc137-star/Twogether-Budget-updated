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
