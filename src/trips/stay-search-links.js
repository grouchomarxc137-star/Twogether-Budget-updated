function safeDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
}
function positiveInt(value, fallback = 0) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function nightlyMax(maxTotal, nights) {
  const total = Number(maxTotal);
  const count = positiveInt(nights);
  return Number.isFinite(total) && total > 0 && count > 0 ? Math.max(1, Math.floor(total / count)) : 0;
}
function slug(value) {
  return String(value || 'stays').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'stays';
}
export function buildBookingSearchUrl(input = {}) {
  const url = new URL('https://www.booking.com/searchresults.html');
  const destination = String(input.destination || '').trim();
  const start = safeDate(input.start);
  const end = safeDate(input.end);
  url.searchParams.set('ss', destination);
  if (start) url.searchParams.set('checkin', start);
  if (end) url.searchParams.set('checkout', end);
  url.searchParams.set('group_adults', String(positiveInt(input.adults, 2)));
  url.searchParams.set('group_children', '0');
  url.searchParams.set('no_rooms', '1');
  url.searchParams.set('selected_currency', 'EUR');
  url.searchParams.set('order', 'price');

  const filters = [];
  if (input.parking) filters.push('hotelfacility=2');
  if (input.washingMachine) filters.push('roomfacility=27');
  if (input.airConditioning) filters.push('roomfacility=11');
  if (input.kitchen) filters.push('roomfacility=24');
  if (input.pool) filters.push('popular_activities=2');
  if (filters.length) url.searchParams.set('nflt', filters.join(';'));
  return url.toString();
}
export function buildAirbnbSearchUrl(input = {}) {
  const destination = String(input.destination || '').trim();
  const url = new URL(`https://www.airbnb.com/s/${slug(destination)}/homes`);
  const start = safeDate(input.start);
  const end = safeDate(input.end);
  url.searchParams.set('query', destination);
  if (start) url.searchParams.set('checkin', start);
  if (end) url.searchParams.set('checkout', end);
  url.searchParams.set('adults', String(positiveInt(input.adults, 2)));
  url.searchParams.set('display_currency', 'EUR');
  if (input.entirePlace) url.searchParams.append('room_types[]', 'Entire home/apt');
  const bedrooms = positiveInt(input.bedrooms);
  if (bedrooms) url.searchParams.set('min_bedrooms', String(bedrooms));
  const maxNight = nightlyMax(input.maxTotal, input.nights);
  if (maxNight) url.searchParams.set('price_max', String(maxNight));

  const amenityIds = [];
  if (input.parking) amenityIds.push(9);
  if (input.washingMachine) amenityIds.push(33);
  if (input.wifi) amenityIds.push(4);
  if (input.kitchen) amenityIds.push(8);
  if (input.airConditioning) amenityIds.push(5);
  if (input.pool) amenityIds.push(7);
  amenityIds.forEach((id) => url.searchParams.append('amenities[]', String(id)));
  return url.toString();
}
export function buildListingCheckUrl(rawUrl, source, input = {}) {
  let url;
  try { url = new URL(String(rawUrl || '').trim()); } catch { return String(rawUrl || '').trim(); }
  const start = safeDate(input.start);
  const end = safeDate(input.end);
  const adults = String(positiveInt(input.adults, 2));
  if (source === 'airbnb') {
    if (start) url.searchParams.set('check_in', start);
    if (end) url.searchParams.set('check_out', end);
    url.searchParams.set('guests', adults);
    url.searchParams.set('adults', adults);
    url.searchParams.set('children', '0');
    url.searchParams.set('infants', '0');
    url.searchParams.set('pets', '0');
  } else {
    if (start) url.searchParams.set('checkin', start);
    if (end) url.searchParams.set('checkout', end);
    url.searchParams.set('group_adults', adults);
    url.searchParams.set('group_children', '0');
    url.searchParams.set('no_rooms', '1');
    url.searchParams.set('selected_currency', 'EUR');
  }
  return url.toString();
}
