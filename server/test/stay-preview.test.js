import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStayPreviewHtml, sourceFromStayUrl, fetchStayPreview } from '../src/stay-preview.js';

test('stay preview reads Open Graph title and image', () => {
  const html = '<html><head><meta property="og:title" content="Casa Bella &amp; Spa"><meta property="og:image" content="/photos/main.jpg"></head></html>';
  const result = parseStayPreviewHtml(html,'https://www.booking.com/hotel/it/casa.html');
  assert.equal(result.name,'Casa Bella & Spa');
  assert.equal(result.image,'https://www.booking.com/photos/main.jpg');
});

test('stay preview only accepts Booking.com and Airbnb links', () => {
  assert.equal(sourceFromStayUrl('https://www.airbnb.com/rooms/123'),'airbnb');
  assert.equal(sourceFromStayUrl('https://www.booking.com/hotel/it/test.html'),'booking');
  assert.throws(() => sourceFromStayUrl('https://example.com/place'),/only Booking.com and Airbnb/i);
});

test('stay preview fetch keeps metadata extraction best effort', async () => {
  const fakeFetch = async () => ({
    ok:true,
    url:'https://www.airbnb.com/rooms/123',
    text:async () => '<meta property="og:title" content="Lake House"><meta property="og:image" content="https://a0.muscache.com/photo.jpg">',
  });
  const result = await fetchStayPreview('https://www.airbnb.com/rooms/123',fakeFetch);
  assert.equal(result.ok,true);
  assert.equal(result.name,'Lake House');
  assert.equal(result.image,'https://a0.muscache.com/photo.jpg');
});
