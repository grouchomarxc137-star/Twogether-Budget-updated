import assert from 'node:assert/strict';
import test from 'node:test';

process.env.BOOKING_API_KEY = 'test-key';
process.env.BOOKING_AFFILIATE_ID = '123';

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options.body || '{}');
  calls.push([url, body]);
  if (url.endsWith('/accommodations/search')) {
    return new Response(JSON.stringify({ data:[{ id:101, currency:{ booker:'EUR' }, price:{ total:640 }, url:'https://booking.example/101' }] }), { status:200, headers:{ 'content-type':'application/json' } });
  }
  if (url.endsWith('/accommodations/details')) {
    return new Response(JSON.stringify({ data:[{ id:101, name:{ 'en-gb':'Lake House' }, location:{ coordinates:{ latitude:45.4, longitude:10.5 } }, rating:{ review_score:9.1, number_of_reviews:50 }, facilities:[{ id:2 },{ id:99 }], facility_details:{ parking_facilities:[{}] }, rooms:[], url:{ web:'https://booking.example/101' }, photos:[{ main_photo:true, url:{ large:'https://img.example/x.jpg' } }] }] }), { status:200, headers:{ 'content-type':'application/json' } });
  }
  if (url.endsWith('/accommodations/constants')) {
    return new Response(JSON.stringify({ data:[{ id:2, name:{ 'en-gb':'Parking' } },{ id:99, name:{ 'en-gb':'Washing machine' } }] }), { status:200, headers:{ 'content-type':'application/json' } });
  }
  throw new Error(`Unexpected URL ${url}`);
};
test.after(() => { globalThis.fetch = originalFetch; });

const { createStaySearchService } = await import('../src/stays.js');

test('live stay search merges Lake Garda anchors and applies requirements', async () => {
  const service = createStaySearchService({ readState:() => ({ plans:[{ id:'p1', meta:{ start:'2099-10-10', end:'2099-10-17' } }] }) });
  const result = await service.search({ planId:'p1', area:'lake-garda', filters:{ parking:true, washingMachine:true, maxTotal:800 } });
  assert.equal(result.ok, true);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].price, 640);
  assert.equal(result.results[0].nightly, 91.43);
  assert.equal(result.results[0].parking, true);
  assert.equal(result.results[0].washingMachine, true);
  assert.equal(result.results[0].image, 'https://img.example/x.jpg');
  assert.equal(calls.filter(([url]) => url.endsWith('/accommodations/search')).length, 4);
  const firstSearch = calls.find(([url]) => url.endsWith('/accommodations/search'))[1];
  assert.equal(firstSearch.filters.accommodation_facilities[0], 2);
  assert.equal(firstSearch.filters.price.maximum, 114);
});
