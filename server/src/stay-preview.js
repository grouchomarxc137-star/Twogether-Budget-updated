const ALLOWED_HOSTS = ['airbnb.com','booking.com'];

function clean(value) {
  return String(value == null ? '' : value).trim();
}
function allowedHost(hostname) {
  const host=clean(hostname).toLowerCase().replace(/^www\./,'');
  return ALLOWED_HOSTS.some((domain)=>host===domain||host.endsWith('.'+domain));
}
function decodeHtml(value) {
  return clean(value)
    .replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'")
    .replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
}
function escapeRegex(value) {
  return String(value).replace(/[.*+?^$()|[\]\\{}]/g,'\\$&');
}
function metaContent(html, key) {
  const source=String(html||'');
  const escaped=escapeRegex(key);
  const patterns=[
    new RegExp('<meta[^>]+(?:property|name)=["\\\']'+escaped+'["\\\'][^>]+content=["\\\']([^"\\\']+)["\\\'][^>]*>','i'),
    new RegExp('<meta[^>]+content=["\\\']([^"\\\']+)["\\\'][^>]+(?:property|name)=["\\\']'+escaped+'["\\\'][^>]*>','i'),
  ];
  for(const pattern of patterns){const match=source.match(pattern);if(match?.[1])return decodeHtml(match[1]);}
  return '';
}
export function parseStayPreviewHtml(html, fallbackUrl='') {
  const source=String(html||'');
  const title=metaContent(source,'og:title')||metaContent(source,'twitter:title')||
    decodeHtml(source.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]||'');
  const image=metaContent(source,'og:image')||metaContent(source,'twitter:image');
  let absoluteImage=image;
  if(image){
    try{absoluteImage=new URL(image,fallbackUrl).toString();}catch{}
  }
  return {name:title,image:absoluteImage};
}
export function sourceFromStayUrl(rawUrl) {
  let url;
  try{url=new URL(clean(rawUrl));}catch{throw new Error('Paste a valid Booking.com or Airbnb link');}
  if(url.protocol!=='https:'&&url.protocol!=='http:')throw new Error('Paste a normal Booking.com or Airbnb link');
  if(!allowedHost(url.hostname))throw new Error('Only Booking.com and Airbnb links can be saved here');
  return url.hostname.toLowerCase().includes('airbnb')?'airbnb':'booking';
}
export async function fetchStayPreview(rawUrl, fetchImpl=fetch) {
  const source=sourceFromStayUrl(rawUrl);
  const url=new URL(clean(rawUrl));
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),7000);
  try{
    const response=await fetchImpl(url.toString(),{
      redirect:'follow',
      signal:controller.signal,
      headers:{
        'user-agent':'Mozilla/5.0 (compatible; Twogether/1.0; +private trip planner)',
        'accept':'text/html,application/xhtml+xml',
        'accept-language':'en-GB,en;q=0.9',
      },
    });
    if(!response.ok)throw new Error('The accommodation page did not allow Twogether to read its preview');
    const finalUrl=new URL(response.url||url.toString());
    if(!allowedHost(finalUrl.hostname))throw new Error('The accommodation link redirected somewhere unexpected');
    const html=await response.text();
    const preview=parseStayPreviewHtml(html.slice(0,900000),finalUrl.toString());
    const fallback=source==='airbnb'?'Airbnb stay':'Booking.com stay';
    return {ok:true,source,name:preview.name||fallback,image:preview.image||'',url:finalUrl.toString()};
  }catch(error){
    if(error?.name==='AbortError')throw new Error('The accommodation preview took too long to load');
    throw error;
  }finally{clearTimeout(timeout);}
}
