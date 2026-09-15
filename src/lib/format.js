// Canonicalizes esc/n/money/fmtDate/uid, which were copy-pasted near-identically
// across app.js, workflow.js, finances.js, ui.js, shared.js, trip-wizard-bridge-v15.js,
// approved-v18.js, overview-v26.js, v27.js, v28.js, v33.js and more.

export const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[ch]));

// Parses money input that may use a comma decimal separator (e.g. "12,50").
export const n = (v) => {
  const x = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(x) ? x : 0;
};

export const money = (v) => '€' + n(v).toLocaleString(undefined, {
  minimumFractionDigits: 2, maximumFractionDigits: 2
});

export const fmtDate = (v) => {
  if (!v) return '—';
  const [y, m, d] = String(v).split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(v);
};

export const uid = () =>
  globalThis.crypto?.randomUUID?.() || `id_${Date.now()}_${Math.random().toString(36).slice(2)}`;
