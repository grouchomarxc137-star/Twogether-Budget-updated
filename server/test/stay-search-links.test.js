import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBookingSearchUrl, buildAirbnbSearchUrl, buildListingCheckUrl } from '../../src/trips/stay-search-links.js';

test('prepared Booking.com search carries dates, guests and cheapest-first ordering', () => {
  const url = new URL(buildBookingSearchUrl({
    destination:'Lake Garda, Italy', start:'2099-06-10', end:'2099-06-17', adults:2,
  }));
  assert.equal(url.searchParams.get('ss'), 'Lake Garda, Italy');
  assert.equal(url.searchParams.get('checkin'), '2099-06-10');
  assert.equal(url.searchParams.get('checkout'), '2099-06-17');
  assert.equal(url.searchParams.get('group_adults'), '2');
  assert.equal(url.searchParams.get('order'), 'price');
});

test('prepared Airbnb search carries destination, dates and guests', () => {
  const url = new URL(buildAirbnbSearchUrl({
    destination:'Bergamo, Italy', start:'2099-09-03', end:'2099-09-08', adults:2,
  }));
  assert.equal(url.searchParams.get('query'), 'Bergamo, Italy');
  assert.equal(url.searchParams.get('checkin'), '2099-09-03');
  assert.equal(url.searchParams.get('checkout'), '2099-09-08');
  assert.equal(url.searchParams.get('adults'), '2');
});

test('saved listing links reopen with the new trip dates', () => {
  const airbnb = new URL(buildListingCheckUrl('https://www.airbnb.com/rooms/12345?foo=bar','airbnb',{
    start:'2099-10-01',end:'2099-10-04',adults:2,
  }));
  assert.equal(airbnb.searchParams.get('check_in'),'2099-10-01');
  assert.equal(airbnb.searchParams.get('check_out'),'2099-10-04');
  assert.equal(airbnb.searchParams.get('adults'),'2');

  const booking = new URL(buildListingCheckUrl('https://www.booking.com/hotel/it/test.html','booking',{
    start:'2099-10-01',end:'2099-10-04',adults:2,
  }));
  assert.equal(booking.searchParams.get('checkin'),'2099-10-01');
  assert.equal(booking.searchParams.get('checkout'),'2099-10-04');
  assert.equal(booking.searchParams.get('group_adults'),'2');
});
