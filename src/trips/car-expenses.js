// Preserve legacy trip expense storage while showing Transport and Car separately.
export const CAR_TYPES = Object.freeze([
  {value:'fuel',label:'Fuel'},
  {value:'tolls',label:'Tolls'},
  {value:'parking',label:'Parking'},
  {value:'car-other',label:'Other'},
]);
export function isCarExpense(entry) {
  return entry?.category==='transport' && ['fuel','tolls','parking','car-other','parking-tolls'].includes(String(entry.transportType||''));
}
export function carExpenseKind(entry) {
  const type=String(entry?.transportType||'');
  if(type==='fuel')return 'fuel';
  if(type==='tolls')return 'tolls';
  if(type==='parking')return 'parking';
  if(type==='car-other')return 'other';
  if(type==='parking-tolls')return 'legacy-tolls-parking';
  return '';
}
export function carExpenseLabel(entry) {
  const kind=carExpenseKind(entry);
  return ({fuel:'Fuel',tolls:'Tolls',parking:'Parking',other:'Other','legacy-tolls-parking':'Tolls / Parking'})[kind]||'Car';
}
export function carExpenseSubtype(kind) {
  return kind==='parking-tolls'||CAR_TYPES.some(x=>x.value===kind)?kind:'fuel';
}
export function carExpenseBreakdown(entries,{payer='',month=''}={}) {
  const groups=new Map();
  (Array.isArray(entries)?entries:[]).forEach(entry=>{
    if(!isCarExpense(entry))return;
    if(month && !String(entry?.date||'').startsWith(month+'-'))return;
    const amount=Math.max(0,Math.round((Number(entry.amount)||0)*100)-Math.round((Number(entry.jarContribution)||0)*100));
    const paid=payer ? (entry.paidBy===payer?amount:entry.paidBy==='both'?Math.round(amount/2):0):amount;
    if(paid<=0)return;
    const kind=carExpenseKind(entry), current=groups.get(kind)||{kind,label:carExpenseLabel(entry),cents:0,items:[]};
    current.cents+=paid;
    current.items.push({id:String(entry.id||''),name:String(entry.note||entry.name||carExpenseLabel(entry)),date:String(entry.date||''),amount:paid/100});
    groups.set(kind,current);
  });
  return [...groups.values()].sort((a,b)=>['fuel','tolls','parking','other','legacy-tolls-parking'].indexOf(a.kind)-['fuel','tolls','parking','other','legacy-tolls-parking'].indexOf(b.kind)).map(g=>({...g,amount:g.cents/100}));
}
