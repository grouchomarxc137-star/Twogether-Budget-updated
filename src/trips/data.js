// Pure trip domain calculations -- no DOM, no state fetching. Extracted
// from app.js. Every trip-related module (wizard, overview, current-trips)
// imports from here instead of redefining these.
import { n, money, fmtDate } from '../lib/format.js';

export const MONEY_FIELDS = ['accom', 'groceries', 'eat', 'travel', 'fuel', 'tolls', 'other'];
export const MONEY_LABELS = {
  accom: 'Accommodation', groceries: 'Groceries', eat: 'Eating out',
  travel: 'Flights / Train', fuel: 'Fuel', tolls: 'Tolls / Parking', other: 'Other',
};
export const DEFAULT_COMPARE = {
  rent: 600, utilities: 120, condo: 0, stilltravel: 180, food: 250,
  carpay: 250, insurance: 90, tax: 45, carfuel: 120, maintenance: 50,
};
export const MONTHS = [
  ['2026-01', 'Jan 2026'], ['2026-02', 'Feb 2026'], ['2026-03', 'Mar 2026'], ['2026-04', 'Apr 2026'],
  ['2026-05', 'May 2026'], ['2026-06', 'Jun 2026'], ['2026-07', 'Jul 2026'], ['2026-08', 'Aug 2026'],
  ['2026-09', 'Sep 2026'], ['2026-10', 'Oct 2026'], ['2026-11', 'Nov 2026'], ['2026-12', 'Dec 2026'],
];
export const RENT_DEFS = [
  ['Rent', 'rent'], ['Utilities + Wi-Fi', 'utilities'], ['Condo fees', 'condo'],
  ['Still-needed travel', 'stilltravel'], ['Groceries / eating out', 'food'],
];
export const CAR_DEFS = [
  ['Car payment / saving', 'carpay'], ['Insurance', 'insurance'], ['Road tax', 'tax'],
  ['Fuel', 'carfuel'], ['Maintenance reserve', 'maintenance'],
];

export function locationLabel(s) {
  return s?.location === 'Other' ? (s.otherLocation || 'Other') : (s?.location || '—');
}

export function tripMeta(t) {
  if (!t) return {};
  const preferred = t?.submissions?.[t.createdBy];
  return preferred || t?.submissions?.Principessa || t?.submissions?.Principe || {};
}

export function isLocked(t) {
  return !!(t?.confirmed?.Principessa && t?.confirmed?.Principe);
}

export function tripTotalSubmission(s) {
  return MONEY_FIELDS.reduce((sum, k) => sum + n(s?.[k]), 0);
}

export function differences(t) {
  const a = t?.submissions?.Principessa;
  const b = t?.submissions?.Principe;
  if (!a || !b) return [];
  const out = [];

  MONEY_FIELDS.forEach((k) => {
    const amountDiff = Math.abs(n(a[k]) - n(b[k])) > 0.01;
    const certaintyDiff = !!a?.uncertain?.[k] !== !!b?.uncertain?.[k];
    if (amountDiff) {
      out.push({ key: k, label: MONEY_LABELS[k], a: money(a[k]), b: money(b[k]), type: 'money' });
    } else if (certaintyDiff) {
      out.push({
        key: k + 'Certainty', label: MONEY_LABELS[k] + ' certainty',
        a: a?.uncertain?.[k] ? 'Estimated' : 'Exact',
        b: b?.uncertain?.[k] ? 'Estimated' : 'Exact', type: 'text',
      });
    }
  });

  if (String(a.otherNote || '').trim().toLowerCase() !== String(b.otherNote || '').trim().toLowerCase()) {
    out.push({ key: 'otherNote', label: 'Other expense note', a: a.otherNote || '—', b: b.otherNote || '—', type: 'text' });
  }
  return out;
}

export function effectiveTrip(t) {
  const a = t?.submissions?.Principessa;
  const b = t?.submissions?.Principe;
  const meta = tripMeta(t);
  const out = {
    id: t?.id || '',
    location: meta.location || '', otherLocation: meta.otherLocation || '', city: meta.city || '',
    start: meta.start || '', end: meta.end || '', budget: n(t?.budget),
    uncertain: {}, provisional: !(a && b), mismatch: false, locked: isLocked(t),
  };

  MONEY_FIELDS.forEach((k) => {
    if (a && b) {
      const same = Math.abs(n(a[k]) - n(b[k])) <= 0.01;
      out[k] = same ? n(a[k]) : (n(a[k]) + n(b[k])) / 2;
      out.uncertain[k] = !!(a?.uncertain?.[k] || b?.uncertain?.[k] || !same);
    } else {
      const s = a || b || {};
      out[k] = n(s[k]);
      out.uncertain[k] = !!s?.uncertain?.[k];
    }
  });

  out.mismatch = !!(a && b && differences(t).length);
  const categoryTotal = MONEY_FIELDS.reduce((sum, k) => sum + n(out[k]), 0);
  out.paidPrincipessa = n(a?.paid);
  out.paidPrincipe = n(b?.paid);
  const paidTotal = out.paidPrincipessa + out.paidPrincipe;
  // Confirmed plan snapshots created before net-of-Jar totals were introduced
  // stored gross categories but net payer amounts. Keep those existing stories
  // consistent with Current Trips without changing ordinary legacy submissions.
  out.total = out.locked && !out.mismatch && paidTotal > 0 && paidTotal < categoryTotal
    ? paidTotal
    : categoryTotal;
  out.estimated = out.provisional || out.mismatch || !out.locked || Object.values(out.uncertain).some(Boolean);
  return out;
}

export function budgetInfo(t) {
  const e = effectiveTrip(t);
  if (!e.budget) return { has: false, label: 'No planned budget', delta: 0, tone: 'neutral' };
  const delta = e.budget - e.total;
  if (Math.abs(delta) < 0.01) return { has: true, label: 'Exactly on budget', delta: 0, tone: 'ok' };
  if (delta > 0) return { has: true, label: `${money(delta)} under budget`, delta, tone: 'ok' };
  return { has: true, label: `${money(Math.abs(delta))} over budget`, delta, tone: 'warn' };
}

export { fmtDate };
