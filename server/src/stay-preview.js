const AIRBNB_HOSTS = [
  'airbnb.com','airbnb.it','airbnb.co.uk','airbnb.fr','airbnb.de','airbnb.nl','airbnb.es','airbnb.pt',
  'airbnb.ie','airbnb.dk','airbnb.se','airbnb.no','airbnb.fi','airbnb.ca','airbnb.com.au','airbnb.co.nz',
  'airbnb.com.br','airbnb.mx','airbnb.co.in','airbnb.jp','airbnb.co.kr','airbnb.com.sg','airbnb.com.tw',
  'airbnb.com.hk','airbnb.co.za','airbnb.pl','airbnb.cz','airbnb.hu','airbnb.at','airbnb.ch','airbnb.be','airbnb.gr',
];

function clean(value) {
  return String(value == null ? '' : value).trim();
}
function allowedHost(hostname) {
  const host=clean(hostname).toLowerCase().replace(/^www\./,'');
  return AIRBNB_HOSTS.some((domain)=>host===domain||host.endsWith('.'+domain));
}
export function normalizeAirbnbUrl(rawValue) {
  const raw=clean(rawValue);
  if(!raw)throw new Error('Paste an Airbnb link');
  const markdown=/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/i.exec(raw);
  const direct=markdown?.[1] || /https?:\/\/[^\s<>"'\]\[()]+/i.exec(raw)?.[0]
    || (/^(?:www\.)?airbnb\.[^\s/]+\/.+/i.test(raw) ? ('https://'+raw.replace(/^https?:\/\//i,'')) : '');
  if(!direct)throw new Error('Paste a valid Airbnb link');
  const candidate=direct.replace(/\\&/g,'&').replace(/[),.;!?]+$/,'');
  let url;
  try{url=new URL(candidate);}catch{throw new Error('Paste a valid Airbnb link');}
  if(url.protocol!=='https:'&&url.protocol!=='http:')throw new Error('Paste a normal Airbnb link');
  if(!allowedHost(url.hostname))throw new Error('Only Airbnb links can be saved here');
  const room=url.pathname.match(/^\/rooms\/(\d+)/i);
  if(room)return 'https://www.airbnb.com/rooms/'+room[1];
  return url.toString();
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
  normalizeAirbnbUrl(rawUrl);
  return 'airbnb';
}
export async function fetchStayPreview(rawUrl, fetchImpl=fetch) {
  const normalized=normalizeAirbnbUrl(rawUrl);
  const url=new URL(normalized);
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
    const finalUrl=new URL(response.url||url.toString());
    if(!allowedHost(finalUrl.hostname))throw new Error('The Airbnb link redirected somewhere unexpected');
    const finalRoom=finalUrl.pathname.match(/^\/rooms\/(\d+)/i);
    const cleanFinalUrl=finalRoom ? 'https://www.airbnb.com/rooms/'+finalRoom[1] : finalUrl.toString();
    let preview={name:'',image:''};
    if(response.ok){
      const html=await response.text();
      preview=parseStayPreviewHtml(html.slice(0,900000),cleanFinalUrl);
    }
    return {ok:true,source:'airbnb',name:preview.name||'Airbnb stay',image:preview.image||'',url:cleanFinalUrl};
  }catch(error){
    if(error?.name==='AbortError')throw new Error('The Airbnb preview took too long to load');
    throw error;
  }finally{clearTimeout(timeout);}
}
