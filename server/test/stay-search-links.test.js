import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAirbnbSearchUrl, buildListingCheckUrl } from '../../src/trips/stay-search-links.js';

test('prepared Airbnb search carries destination, dates and guests', () => {
  const url = new URL(buildAirbnbSearchUrl({
    destination:'Lake Garda, Italy', start:'2099-09-03', end:'2099-09-08', adults:2,
  }));
  assert.equal(url.searchParams.get('query'), 'Lake Garda, Italy');
  assert.equal(url.searchParams.get('checkin'), '2099-09-03');
  assert.equal(url.searchParams.get('checkout'), '2099-09-08');
  assert.equal(url.searchParams.get('adults'), '2');
});

test('saved Airbnb links reopen with the new trip dates', () => {
  const airbnb = new URL(buildListingCheckUrl('https://www.airbnb.it/rooms/12345?foo=bar','airbnb',{
    start:'2099-10-01',end:'2099-10-04',adults:2,
  }));
  assert.equal(airbnb.searchParams.get('check_in'),'2099-10-01');
  assert.equal(airbnb.searchParams.get('check_out'),'2099-10-04');
  assert.equal(airbnb.searchParams.get('adults'),'2');
  assert.equal(airbnb.searchParams.get('foo'),'bar');
});
