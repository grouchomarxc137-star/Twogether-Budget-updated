import { esc, money } from '../lib/format.js';
import { carExpenseBreakdown } from './car-expenses.js';

// Fuel is taken from logged car/fuel expenses, never a fixed pump price.
// Confirmed stories pass their final fuel snapshot to include older records.
export function loggedTripFuel(plan) {
  const fuel=carExpenseBreakdown(plan?.expenseEntries).find((group)=>group.kind==='fuel');
  return Math.max(0,Number(fuel?.amount)||0);
}

export function distanceStats(plan,trip,fuelAmount) {
  const raw=plan?.distanceKm || trip?.distanceKm || '';
  const distanceKm=Number(raw)>0?Number(raw):0;
  const fuelSpent=Math.max(0,Number(fuelAmount)||0);
  const costPerKm=distanceKm>0 && fuelSpent>0 ? fuelSpent/distanceKm : null;
  return {distanceKm,fuelSpent,costPerKm};
}

export function readDistanceInput(value) {
  const raw=String(value??'').trim().replace(',','.');
  if (!/^\d{1,7}(?:\.\d)?$/.test(raw)) return null;
  const km=Number(raw);
  return Number.isFinite(km)&&km>0&&km<=1000000 ? km : null;
}

export function renderTripDistance(plan,trip,fuelAmount,where='current') {
  const result=distanceStats(plan,trip,fuelAmount);
  const existing=result.distanceKm>0;
  const fuelLabel=result.fuelSpent>0?money(result.fuelSpent):'No fuel logged';
  const perKm=result.costPerKm==null?'—':'€'+result.costPerKm.toFixed(2)+'/km';
  return '<section class="trip-distance-panel" aria-label="Trip kilometres and fuel">'+
    '<div class="trip-distance-head"><strong>🚗 Distance & fuel</strong><small>For this trip</small></div>'+
    '<div class="trip-distance-stats">'+
      '<div><small>Driven</small><strong>'+(existing?esc(result.distanceKm.toLocaleString('nl-NL'))+' km':'Not logged')+'</strong></div>'+
      '<div><small>Fuel spent</small><strong>'+esc(fuelLabel)+'</strong></div>'+
      '<div><small>Cost per km</small><strong>'+esc(perKm)+'</strong></div>'+
    '</div>'+
    '<div class="trip-distance-edit">'+
      '<label>Total kilometres driven<input data-trip-distance-input type="text" inputmode="decimal" autocomplete="off" placeholder="e.g. 375" value="'+(existing?esc(result.distanceKm):'')+'"></label>'+
      '<button type="button" '+(where==='current'?'data-act="save-trip-distance"':'data-trip-distance-save')+'>'+(existing?'Update km':'Save km')+'</button>'+
    '</div>'+
    '<small class="trip-distance-note">Based on your logged fuel costs, not a fixed petrol price. Fuel purchased may differ from fuel used.</small>'+
  '</section>';
}
