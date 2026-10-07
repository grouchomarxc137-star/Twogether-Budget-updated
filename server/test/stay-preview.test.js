import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStayPreviewHtml, sourceFromStayUrl, normalizeAirbnbUrl, fetchStayPreview } from '../src/stay-preview.js';

test('stay preview reads Open Graph title and image', () => {
  const html = '<html><head><meta property="og:title" content="Casa Bella &amp; Spa"><meta property="og:image" content="/photos/main.jpg"></head></html>';
  const result = parseStayPreviewHtml(html,'https://www.airbnb.it/rooms/123');
  assert.equal(result.name,'Casa Bella & Spa');
  assert.equal(result.image,'https://www.airbnb.it/photos/main.jpg');
});

test('Airbnb links accept country domains and pasted share text', () => {
  assert.equal(sourceFromStayUrl('https://www.airbnb.com/rooms/123'),'airbnb');
  assert.equal(sourceFromStayUrl('https://www.airbnb.it/rooms/123'),'airbnb');
  assert.equal(sourceFromStayUrl('https://www.airbnb.co.uk/rooms/123'),'airbnb');
  assert.equal(
    normalizeAirbnbUrl('Check out this home on Airbnb! https://www.airbnb.it/rooms/123?viralityEntryPoint=1&s=76.'),
    'https://www.airbnb.com/rooms/123'
  );
  assert.throws(() => sourceFromStayUrl('https://www.booking.com/hotel/it/test.html'),/only Airbnb/i);
  assert.throws(() => sourceFromStayUrl('https://example.com/place'),/only Airbnb/i);
});

test('stay preview resolves share links and keeps a fallback if metadata is blocked', async () => {
  const fakeFetch = async () => ({
    ok:false,
    url:'https://www.airbnb.com/rooms/12345',
    text:async () => '',
  });
  const result = await fetchStayPreview('Shared from Airbnb https://www.airbnb.it/slink/demo',fakeFetch);
  assert.equal(result.ok,true);
  assert.equal(result.source,'airbnb');
  assert.equal(result.name,'Airbnb stay');
  assert.equal(result.url,'https://www.airbnb.it/rooms/12345?unique_share_id=abc');
});

test('stay preview reads Airbnb metadata when available', async () => {
  const fakeFetch = async () => ({
    ok:true,
    url:'https://www.airbnb.com/rooms/123',
    text:async () => '<meta property="og:title" content="Lake House"><meta property="og:image" content="https://a0.muscache.com/photo.jpg">',
  });
  const result = await fetchStayPreview('https://www.airbnb.com/rooms/123',fakeFetch);
  assert.equal(result.name,'Lake House');
  assert.equal(result.image,'https://a0.muscache.com/photo.jpg');
});


test('full Airbnb.nl room links are shortened to a clean canonical room link', () => {
  const longUrl = 'https://www.airbnb.nl/rooms/1415105780236535921?adults=2&check_in=2026-10-30&check_out=2026-11-02&search_mode=regular_search&photo_id=2163991499&previous_page_section_name=1000';
  assert.equal(
    normalizeAirbnbUrl(longUrl),
    'https://www.airbnb.com/rooms/1415105780236535921'
  );
});

test('markdown-style pasted Airbnb links with escaped ampersands are accepted', () => {
  const pasted = '[https://www.airbnb.nl/rooms/1415105780236535921?adults=2&check_in=2026-10-30](https://www.airbnb.nl/rooms/1415105780236535921?adults=2\\&check_in=2026-10-30\\&check_out=2026-11-02)';
  assert.equal(
    normalizeAirbnbUrl(pasted),
    'https://www.airbnb.com/rooms/1415105780236535921'
  );
});
