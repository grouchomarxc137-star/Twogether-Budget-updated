const AREA_DEFS = {
  'lake-garda': {
    label: 'Lake Garda · south-west',
    note: 'Manerba · Moniga · Padenghe · Desenzano · Lonato · Sirmione · Peschiera',
    anchors: [
      { latitude: 45.555, longitude: 10.551, radius: 8 },
      { latitude: 45.469, longitude: 10.535, radius: 9 },
      { latitude: 45.461, longitude: 10.485, radius: 8 },
      { latitude: 45.439, longitude: 10.692, radius: 8 },
    ],
  },
  bergamo: {
    label: 'Bergamo area',
    note: 'Bergamo and nearby towns',
    anchors: [{ latitude: 45.6983, longitude: 9.6773, radius: 15 }],
  },
};

const CITY_FOCUS = [
  { test:/manerba/i, label:'Manerba del Garda', anchor:{ latitude:45.555, longitude:10.551, radius:8 } },
  { test:/moniga/i, label:'Moniga del Garda', anchor:{ latitude:45.526, longitude:10.538, radius:8 } },
  { test:/padenghe/i, label:'Padenghe sul Garda', anchor:{ latitude:45.507, longitude:10.509, radius:8 } },
  { test:/desenzano/i, label:'Desenzano del Garda', anchor:{ latitude:45.469, longitude:10.535, radius:8 } },
  { test:/lonato/i, label:'Lonato del Garda', anchor:{ latitude:45.461, longitude:10.485, radius:8 } },
  { test:/sirmione/i, label:'Sirmione', anchor:{ latitude:45.493, longitude:10.607, radius:8 } },
  { test:/peschiera/i, label:'Peschiera del Garda', anchor:{ latitude:45.439, longitude:10.692, radius:8 } },
  { test:/bergamo/i, label:'Bergamo', anchor:{ latitude:45.6983, longitude:9.6773, radius:12 } },
];

const BOOKING_BASE = String(process.env.BOOKING_API_BASE || 'https://demandapi.booking.com/3.2').replace(/\/$/, '');
const BOOKING_KEY = String(process.env.BOOKING_DEMAND_API_KEY || process.env.BOOKING_API_KEY || '').trim();
const BOOKING_AFFILIATE_ID = String(process.env.BOOKING_AFFILIATE_ID || '').trim();
let constantsCache = null;
let constantsAt = 0;

function cleanString(value, max = 240) { return String(value == null ? '' : value).trim().slice(0, max); }
function n(value) { const num = Number(value); return Number.isFinite(num) ? num : 0; }
function nightsBetween(start, end) {
  const a = Date.parse(`${start}T00:00:00Z`), b = Date.parse(`${end}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(1, Math.round((b - a) / 86400000)) : 1;
}
function textValue(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return value['en-gb'] || value['en-us'] || value.en || Object.values(value).find((item) => typeof item === 'string') || '';
}
function photoUrl(photo) {
  if (!photo || typeof photo !== 'object') return '';
  const urls = [photo?.url?.large, photo?.url?.standard, photo?.url?.thumbnail_large, photo.url_1440, photo.url_original, photo.url_max1280, photo.url_max1024, photo.url_max300, typeof photo.url === 'string' ? photo.url : ''];
  return cleanString(urls.find(Boolean), 800);
}
function verifiedAirbnbMatches() {
  try {
    const parsed = JSON.parse(process.env.AIRBNB_VERIFIED_MATCHES_JSON || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}
function normalizedKey(value) { return cleanString(value, 200).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

async function bookingPost(path, body) {
  if (!BOOKING_KEY || !BOOKING_AFFILIATE_ID) {
    const error = new Error('Live Booking.com connection is not configured yet.');
    error.code = 'BOOKING_NOT_CONFIGURED';
    throw error;
  }
  const response = await fetch(`${BOOKING_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${BOOKING_KEY}`,
      'X-Affiliate-Id': BOOKING_AFFILIATE_ID,
    },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(18000),
  });
  let json = null;
  try { json = await response.json(); } catch {}
  if (!response.ok) {
    const message = cleanString(json?.message || json?.error || `Booking.com returned ${response.status}`, 260);
    throw new Error(message || 'Could not check Booking.com right now.');
  }
  return json || {};
}

async function accommodationConstants() {
  const now = Date.now();
  if (constantsCache && now - constantsAt < 12 * 3600 * 1000) return constantsCache;
  try {
    const json = await bookingPost('/accommodations/constants', { languages: ['en-gb'] });
    const rows = Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : []);
    const byId = new Map();
    rows.forEach((row) => { if (row?.id != null) byId.set(String(row.id), textValue(row.name)); });
    constantsCache = { rows, byId };
    constantsAt = now;
    return constantsCache;
  } catch {
    constantsCache = { rows: [], byId: new Map() };
    constantsAt = now;
    return constantsCache;
  }
}

function facilityNames(details, constants) {
  const ids = [];
  (Array.isArray(details?.facilities) ? details.facilities : []).forEach((item) => ids.push(item?.id));
  (Array.isArray(details?.rooms) ? details.rooms : []).forEach((room) => {
    (Array.isArray(room?.facilities) ? room.facilities : []).forEach((item) => ids.push(item?.id ?? item));
  });
  return [...new Set(ids.filter((id) => id != null).map(String))].map((id) => constants.byId.get(id)).filter(Boolean);
}
function hasParking(details, names) {
  if (Array.isArray(details?.facility_details?.parking_facilities) && details.facility_details.parking_facilities.length) return true;
  return names.some((name) => /parking/i.test(name));
}
function hasWashingMachine(names) { return names.some((name) => /washing machine|washer/i.test(name)); }
function cityLabel(details) {
  return cleanString(textValue(details?.location?.city_name) || textValue(details?.city_name) || textValue(details?.location?.address) || '', 160);
}
function totalPrice(item) {
  const candidates = [item?.price?.total?.booker, item?.price?.total, item?.price?.display?.booker, item?.price?.display, item?.price?.base?.booker, item?.price?.base];
  for (const candidate of candidates) {
    if (Number.isFinite(Number(candidate))) return Number(candidate);
  }
  return 0;
}
function currency(item) { return cleanString(item?.currency?.booker || item?.currency?.accommodation || item?.currency || 'EUR', 8) || 'EUR'; }
function detailsUrl(details, searchItem) {
  return cleanString(details?.url?.web || details?.url || searchItem?.url || '', 900);
}

async function searchAnchor(anchor, dates, filters) {
  const body = {
    booker: { country: 'nl', platform: 'mobile' },
    checkin: dates.start,
    checkout: dates.end,
    currency: 'EUR',
    coordinates: anchor,
    guests: { number_of_adults: 2, number_of_rooms: 1 },
    rows: 50,
    sort: { by: 'price', direction: 'ascending' },
    filters: {},
  };
  if (filters.parking) body.filters.accommodation_facilities = [2];
  if (filters.maxTotal > 0) body.filters.price = { maximum: Math.max(1, Math.floor(filters.maxTotal / nightsBetween(dates.start, dates.end))) };
  if (!Object.keys(body.filters).length) delete body.filters;
  return bookingPost('/accommodations/search', body);
}

async function fetchDetails(ids) {
  if (!ids.length) return [];
  const json = await bookingPost('/accommodations/details', {
    accommodations: ids.slice(0, 100),
    extras: ['facilities', 'photos', 'rooms'],
    languages: ['en-gb'],
  });
  return Array.isArray(json?.data) ? json.data : [];
}

export function createStaySearchService({ readState }) {
  return {
    areas() { return Object.entries(AREA_DEFS).map(([id, area]) => ({ id, label: area.label, note: area.note })); },
    async search(input = {}) {
      const planId = cleanString(input.planId, 80);
      const areaId = AREA_DEFS[input.area] ? input.area : 'lake-garda';
      const area = AREA_DEFS[areaId];
      const state = readState();
      const plan = (Array.isArray(state?.plans) ? state.plans : []).find((item) => item.id === planId);
      if (!plan) throw new Error('Choose an upcoming trip first.');
      const dates = { start: cleanString(plan?.meta?.start, 20), end: cleanString(plan?.meta?.end, 20) };
      const city = cleanString(plan?.meta?.city, 160);
      const focusedCity = CITY_FOCUS.find((item) => item.test.test(city));
      const anchors = focusedCity ? [focusedCity.anchor] : area.anchors;
      if (!dates.start || !dates.end) throw new Error('Add the trip dates before checking stays.');
      const filters = {
        parking: input?.filters?.parking === true,
        washingMachine: input?.filters?.washingMachine === true,
        maxTotal: Math.max(0, n(input?.filters?.maxTotal)),
      };

      const searchResponses = await Promise.all(anchors.map((anchor) => searchAnchor(anchor, dates, filters)));
      const found = new Map();
      searchResponses.forEach((response) => {
        (Array.isArray(response?.data) ? response.data : []).forEach((item) => {
          const id = String(item?.id ?? '');
          if (!id) return;
          const existing = found.get(id);
          if (!existing || totalPrice(item) < totalPrice(existing)) found.set(id, item);
        });
      });
      const ranked = [...found.values()].sort((a, b) => totalPrice(a) - totalPrice(b)).slice(0, 60);
      const detailsRows = await fetchDetails(ranked.map((item) => item.id));
      const detailsById = new Map(detailsRows.map((item) => [String(item?.id ?? ''), item]));
      const constants = await accommodationConstants();
      const airbnb = verifiedAirbnbMatches();
      const nights = nightsBetween(dates.start, dates.end);
      const results = ranked.map((item) => {
        const id = String(item.id), details = detailsById.get(id) || {};
        const names = facilityNames(details, constants);
        const name = cleanString(textValue(details.name) || `Booking.com stay ${id}`, 180);
        const city = cityLabel(details);
        const match = airbnb[id] || airbnb[normalizedKey(`${name}|${city}`)] || null;
        const photos = Array.isArray(details?.photos) ? details.photos : [];
        const price = totalPrice(item);
        const coords = details?.location?.coordinates || {};
        return {
          id, source: 'Booking.com', name, city,
          price, currency: currency(item), nightly: price > 0 ? Math.round((price / nights) * 100) / 100 : 0,
          url: detailsUrl(details, item), image: photoUrl(photos.find((p) => p?.main_photo) || photos[0]),
          parking: hasParking(details, names), washingMachine: hasWashingMachine(names),
          facilities: names.slice(0, 20),
          rating: Number(details?.rating?.review_score) || null,
          reviewCount: Number(details?.rating?.number_of_reviews) || 0,
          latitude: Number(coords.latitude) || null, longitude: Number(coords.longitude) || null,
          alsoOnAirbnb: !!match, airbnbUrl: typeof match === 'string' ? match : cleanString(match?.url, 900),
        };
      }).filter((item) => {
        if (!item.price) return false;
        if (filters.parking && !item.parking) return false;
        if (filters.washingMachine && !item.washingMachine) return false;
        if (filters.maxTotal > 0 && item.price > filters.maxTotal + 0.01) return false;
        return true;
      }).slice(0, 36);

      return { ok: true, configured: true, source: 'Booking.com Demand API', checkedAt: new Date().toISOString(), area: { id: areaId, label: focusedCity?.label || area.label, note: focusedCity ? `Focused around ${focusedCity.label}` : area.note }, dates, results };
    },
  };
}
