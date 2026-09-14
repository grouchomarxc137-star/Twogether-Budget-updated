const CACHE='twogether-v34';
const FALLBACK='./index.html';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(['./','./index.html','./manifest.webmanifest','./app-icon.svg'])).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&k.startsWith('twogether-')).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  const req=event.request;if(req.method!=='GET')return;
  const url=new URL(req.url);if(url.origin!==self.location.origin)return;
  event.respondWith((async()=>{
    try{
      const fresh=await fetch(req,{cache:'no-store'});
      if(fresh&&fresh.ok){const cache=await caches.open(CACHE);cache.put(req,fresh.clone());}
      return fresh;
    }catch(err){return (await caches.match(req))||(req.mode==='navigate'?await caches.match(FALLBACK):Response.error());}
  })());
});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const client of list){if('focus'in client)return client.focus();}return clients.openWindow('./');}));});
