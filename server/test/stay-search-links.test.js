import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAirbnbSearchUrl, buildListingCheckUrl, OUR_STAYS_ITALY_BOUNDS } from '../../src/trips/stay-search-links.js';

test('prepared Airbnb search carries the requested Bergamo to Garda map area, dates and guests', () => {
  const url = new URL(buildAirbnbSearchUrl({
    destination:'Bergamo to Lake Garda, Italy',
    bounds:OUR_STAYS_ITALY_BOUNDS,
    start:'2099-09-03',
    end:'2099-09-08',
    adults:2,
  }));
  assert.equal(url.pathname, '/s/homes');
  assert.equal(url.searchParams.get('query'), 'Bergamo to Lake Garda, Italy');
  assert.equal(url.searchParams.get('checkin'), '2099-09-03');
  assert.equal(url.searchParams.get('checkout'), '2099-09-08');
  assert.equal(url.searchParams.get('adults'), '2');
  assert.equal(url.searchParams.get('search_by_map'), 'true');
  assert.equal(url.searchParams.get('sw_lat'), '45.35');
  assert.equal(url.searchParams.get('sw_lng'), '9.55');
  assert.equal(url.searchParams.get('ne_lat'), '45.78');
  assert.equal(url.searchParams.get('ne_lng'), '10.78');
});

test('saved Airbnb links reopen with the new trip dates', () => {
  const airbnb = new URL(buildListingCheckUrl('https://www.airbnb.it/rooms/12345?foo=bar&check_in=2099-01-01&check_out=2099-01-03&adults=7','airbnb',{
    start:'2099-10-01',end:'2099-10-04',adults:2,
  }));
  assert.equal(airbnb.searchParams.get('check_in'),'2099-10-01');
  assert.equal(airbnb.searchParams.get('check_out'),'2099-10-04');
  assert.equal(airbnb.searchParams.get('adults'),'2');
  assert.equal(airbnb.searchParams.get('children'),'0');
  assert.equal(airbnb.searchParams.get('infants'),'0');
  assert.equal(airbnb.searchParams.get('pets'),'0');
  assert.equal(airbnb.searchParams.get('foo'),'bar');
});
