(() => {
  'use strict';
  if(document.querySelector('script[src*="shop-v25.js"]'))return;
  const s=document.createElement('script');
  s.src='shop-v25.js?v=1';
  s.defer=true;
  document.body.appendChild(s);
})();
