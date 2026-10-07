function safeDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
}
function positiveInt(value, fallback = 0) {
  const n=Math.floor(Number(value));
  return Number.isFinite(n)&&n>0?n:fallback;
}
function slug(value) {
  return String(value||'stays').trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'')||'stays';
}
export const OUR_STAYS_ITALY_BOUNDS = {
  swLat:45.35,
  swLng:9.55,
  neLat:45.78,
  neLng:10.78,
};

export function buildAirbnbSearchUrl(input={}) {
  const destination=String(input.destination||'').trim();
  const bounds=input.bounds&&typeof input.bounds==='object'?input.bounds:null;
  const url=new URL(bounds ? 'https://www.airbnb.com/s/homes' : `https://www.airbnb.com/s/${slug(destination)}/homes`);
  const start=safeDate(input.start),end=safeDate(input.end);
  if(destination)url.searchParams.set('query',destination);
  if(bounds){
    url.searchParams.set('sw_lat',String(bounds.swLat));
    url.searchParams.set('sw_lng',String(bounds.swLng));
    url.searchParams.set('ne_lat',String(bounds.neLat));
    url.searchParams.set('ne_lng',String(bounds.neLng));
    url.searchParams.set('search_by_map','true');
  }
  if(start)url.searchParams.set('checkin',start);
  if(end)url.searchParams.set('checkout',end);
  url.searchParams.set('adults',String(positiveInt(input.adults,2)));
  url.searchParams.set('display_currency','EUR');
  return url.toString();
}
export function buildListingCheckUrl(rawUrl,_source,input={}) {
  let url;
  try{url=new URL(String(rawUrl||'').trim());}catch{return String(rawUrl||'').trim();}
  const start=safeDate(input.start),end=safeDate(input.end);
  const adults=String(positiveInt(input.adults,2));
  if(start)url.searchParams.set('check_in',start);
  if(end)url.searchParams.set('check_out',end);
  url.searchParams.set('adults',adults);
  url.searchParams.set('children','0');
  url.searchParams.set('infants','0');
  url.searchParams.set('pets','0');
  return url.toString();
}
