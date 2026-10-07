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
export function buildBookingSearchUrl(input={}) {
  const url=new URL('https://www.booking.com/searchresults.html');
  const destination=String(input.destination||'').trim();
  const start=safeDate(input.start),end=safeDate(input.end);
  url.searchParams.set('ss',destination);
  if(start)url.searchParams.set('checkin',start);
  if(end)url.searchParams.set('checkout',end);
  url.searchParams.set('group_adults',String(positiveInt(input.adults,2)));
  url.searchParams.set('group_children','0');
  url.searchParams.set('no_rooms','1');
  url.searchParams.set('selected_currency','EUR');
  url.searchParams.set('order','price');
  return url.toString();
}
export function buildAirbnbSearchUrl(input={}) {
  const destination=String(input.destination||'').trim();
  const url=new URL(`https://www.airbnb.com/s/${slug(destination)}/homes`);
  const start=safeDate(input.start),end=safeDate(input.end);
  url.searchParams.set('query',destination);
  if(start)url.searchParams.set('checkin',start);
  if(end)url.searchParams.set('checkout',end);
  url.searchParams.set('adults',String(positiveInt(input.adults,2)));
  url.searchParams.set('display_currency','EUR');
  return url.toString();
}
export function buildListingCheckUrl(rawUrl,source,input={}) {
  let url;
  try{url=new URL(String(rawUrl||'').trim());}catch{return String(rawUrl||'').trim();}
  const start=safeDate(input.start),end=safeDate(input.end);
  const adults=String(positiveInt(input.adults,2));
  if(source==='airbnb'){
    if(start)url.searchParams.set('check_in',start);
    if(end)url.searchParams.set('check_out',end);
    url.searchParams.set('adults',adults);
    url.searchParams.set('children','0');
    url.searchParams.set('infants','0');
    url.searchParams.set('pets','0');
  }else{
    if(start)url.searchParams.set('checkin',start);
    if(end)url.searchParams.set('checkout',end);
    url.searchParams.set('group_adults',adults);
    url.searchParams.set('group_children','0');
    url.searchParams.set('no_rooms','1');
    url.searchParams.set('selected_currency','EUR');
  }
  return url.toString();
}
