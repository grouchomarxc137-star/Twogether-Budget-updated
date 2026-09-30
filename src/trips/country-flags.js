function normalizeCountryName(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('en')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const COUNTRY_FLAG_ALIASES = {
  'uk':'GB','u k':'GB','great britain':'GB','britain':'GB','england':'GB','united kingdom':'GB',
  'usa':'US','u s a':'US','us':'US','u s':'US','united states':'US','united states of america':'US','america':'US',
  'uae':'AE','u a e':'AE','united arab emirates':'AE',
  'south korea':'KR','republic of korea':'KR','korea south':'KR',
  'north korea':'KP','democratic peoples republic of korea':'KP','korea north':'KP',
  'russia':'RU','russian federation':'RU',
  'vatican':'VA','vatican city':'VA','holy see':'VA',
  'czech republic':'CZ','czechia':'CZ',
  'ivory coast':'CI','cote d ivoire':'CI',
  'cape verde':'CV','cabo verde':'CV',
  'swaziland':'SZ','eswatini':'SZ',
  'burma':'MM','myanmar':'MM',
  'macedonia':'MK','north macedonia':'MK',
  'moldova':'MD','republic of moldova':'MD',
  'laos':'LA','lao peoples democratic republic':'LA',
  'brunei':'BN','brunei darussalam':'BN',
  'tanzania':'TZ','united republic of tanzania':'TZ',
  'bolivia':'BO','plurinational state of bolivia':'BO',
  'venezuela':'VE','bolivarian republic of venezuela':'VE',
  'iran':'IR','islamic republic of iran':'IR',
  'syria':'SY','syrian arab republic':'SY',
  'palestine':'PS','state of palestine':'PS',
  'taiwan':'TW'
};

let countryCodeByName = null;

function buildCountryCodeByName() {
  if (countryCodeByName) return countryCodeByName;
  countryCodeByName = new Map(Object.entries(COUNTRY_FLAG_ALIASES));
  try {
    const names = new Intl.DisplayNames(['en'], { type:'region' });
    for (let a=65;a<=90;a++) {
      for (let b=65;b<=90;b++) {
        const code=String.fromCharCode(a,b);
        const name=names.of(code);
        if (name && name !== code) countryCodeByName.set(normalizeCountryName(name),code);
      }
    }
  } catch {}
  const common = {
    Italy:'IT',Netherlands:'NL',Tunisia:'TN',Portugal:'PT',Spain:'ES',France:'FR',Germany:'DE',Belgium:'BE',
    Austria:'AT',Switzerland:'CH',Luxembourg:'LU',Ireland:'IE',Greece:'GR',Croatia:'HR',Slovenia:'SI',
    Denmark:'DK',Sweden:'SE',Norway:'NO',Finland:'FI',Poland:'PL',Romania:'RO',Hungary:'HU',Türkiye:'TR',Turkey:'TR'
  };
  Object.entries(common).forEach(([name,code])=>countryCodeByName.set(normalizeCountryName(name),code));
  return countryCodeByName;
}

export function countryFlag(country) {
  const raw=String(country || '').trim();
  if (/^[A-Za-z]{2}$/.test(raw)) {
    const code=raw.toUpperCase();
    return String.fromCodePoint(...[...code].map((char)=>127397+char.charCodeAt(0)));
  }
  const code=buildCountryCodeByName().get(normalizeCountryName(raw));
  if (!code) return '🌍';
  return String.fromCodePoint(...[...code].map((char)=>127397+char.charCodeAt(0)));
}
