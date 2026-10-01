import portugalImage from './country-images/portugal.webp';
import italyImage1 from './country-images/italy-1.webp';
import italyImage2 from './country-images/italy-2.webp';
import austriaImage1 from './country-images/austria-1.webp';
import austriaImage2 from './country-images/austria-2.webp';
import netherlandsImage1 from './country-images/netherlands-1.webp';
import netherlandsImage2 from './country-images/netherlands-2.webp';
import tunisiaImage from './country-images/tunisia.webp';

const CITY_IMAGES = {
  ariana: 'https://upload.wikimedia.org/wikipedia/commons/8/83/Ariana_2_-_Tunisia.jpg',
  amsterdam: 'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?auto=format&fit=crop&w=900&q=82',
  lonato: 'https://images.unsplash.com/photo-1520175480921-4edfa2983e0f?auto=format&fit=crop&w=900&q=82',
  'lonato del garda': 'https://images.unsplash.com/photo-1520175480921-4edfa2983e0f?auto=format&fit=crop&w=900&q=82',
  desenzano: 'https://images.unsplash.com/photo-1520175480921-4edfa2983e0f?auto=format&fit=crop&w=900&q=82',
  'desenzano del garda': 'https://images.unsplash.com/photo-1520175480921-4edfa2983e0f?auto=format&fit=crop&w=900&q=82',
  moniga: 'https://images.unsplash.com/photo-1520175480921-4edfa2983e0f?auto=format&fit=crop&w=900&q=82',
  'moniga del garda': 'https://images.unsplash.com/photo-1520175480921-4edfa2983e0f?auto=format&fit=crop&w=900&q=82',
  roma: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?auto=format&fit=crop&w=900&q=82',
  rome: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?auto=format&fit=crop&w=900&q=82',
  lisbon: 'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=900&q=82',
  lisboa: 'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=900&q=82',
  porto: 'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=900&q=82'
};

const COUNTRY_IMAGES = {
  Italy: 'https://images.unsplash.com/photo-1520175480921-4edfa2983e0f?auto=format&fit=crop&w=900&q=82',
  Netherlands: 'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?auto=format&fit=crop&w=900&q=82',
  Portugal: 'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=900&q=82',
  Tunisia: 'https://upload.wikimedia.org/wikipedia/commons/8/83/Ariana_2_-_Tunisia.jpg',
  Spain: 'https://images.unsplash.com/photo-1509840841025-9088ba78a826?auto=format&fit=crop&w=900&q=82',
  France: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=900&q=82',
  Germany: 'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?auto=format&fit=crop&w=900&q=82',
  Belgium: 'https://images.unsplash.com/photo-1491557345352-5929e343eb89?auto=format&fit=crop&w=900&q=82'
};

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=82';

function key(value) {
  return String(value || '').trim().toLocaleLowerCase('en').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function countryKey(value) {
  const normalized = key(value).replace(/^the\s+/, '');
  if (normalized === 'holland' || normalized === 'nederland') return 'netherlands';
  if (normalized === 'italia') return 'italy';
  return normalized;
}

const CUSTOM_COUNTRY_IMAGES = {
  portugal: [portugalImage],
  italy: [italyImage1, italyImage2],
  austria: [austriaImage1, austriaImage2],
  netherlands: [netherlandsImage1, netherlandsImage2],
  tunisia: [tunisiaImage],
};

function stableImageIndex(seed, length) {
  let hash = 2166136261;
  for (const char of String(seed || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % length;
}

const preloadCache = new Map();

function preloadTripImage(url) {
  if (!url || typeof Image === 'undefined') return Promise.resolve();
  if (preloadCache.has(url)) return preloadCache.get(url);
  const pending = new Promise((resolve) => {
    const image = new Image();
    let finished = false;
    const finish = async () => {
      if (finished) return;
      finished = true;
      try { if (image.decode) await image.decode(); } catch {}
      resolve();
    };
    image.onload = finish;
    image.onerror = finish;
    image.src = url;
    if (image.complete) finish();
  });
  preloadCache.set(url, pending);
  return pending;
}

export function preloadTripImages(urls) {
  return Promise.all(Array.from(new Set((urls || []).filter(Boolean))).map(preloadTripImage));
}

export function tripImage(city, country, seed = '') {
  const countryName = String(country || '').trim();
  const normalizedCountry = countryKey(countryName);
  const custom = CUSTOM_COUNTRY_IMAGES[normalizedCountry];

  if (custom?.length) {
    const choiceSeed = seed || `${key(city)}|${normalizedCountry}`;
    return custom[stableImageIndex(choiceSeed, custom.length)];
  }

  return CITY_IMAGES[key(city)] || COUNTRY_IMAGES[countryName] || FALLBACK_IMAGE;
}
