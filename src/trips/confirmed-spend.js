import { carExpenseBreakdown } from './car-expenses.js';

// Old confirmed snapshots contain Fuel and Tolls/Parking totals. New items
// retain their exact subtype, but the overall donut must count Car only once.
const normalizedLabel=(name)=>{
 const label=String(name||'').trim();
 if(/^(flights?\s*\/\s*trains?|travel|transport)$/i.test(label))return 'Transport';
 if(/^(car(?:\s*·.*)?|fuel|tolls(?:\s*\/\s*parking)?|parking(?:\s*\/\s*tolls)?)$/i.test(label))return 'Car';
 return label;
};
const moneyCents=(value)=>Math.round((Number(value)||0)*100);
export function confirmedPieCategories(rows, plan, {person='',snapshot=null}={}) {
 const sums=new Map();
 (Array.isArray(rows)?rows:[]).forEach((row)=>{
   const label=normalizedLabel(row?.label),amount=moneyCents(row?.amount);
   if(!label||amount<=0)return;
   sums.set(label,(sums.get(label)||0)+amount);
 });
 const entries=Array.isArray(plan?.expenseEntries)?plan.expenseEntries:[];
 const groups=carExpenseBreakdown(entries,{payer:person}).map((group)=>({...group,amount:moneyCents(group.amount)/100}));
 const totalCents=sums.get('Car')||0;
 if(totalCents>0 && !person && snapshot){
   const fuelTarget=moneyCents(snapshot?.fuel),otherTarget=moneyCents(snapshot?.tolls);
   const recordedFuel=groups.filter(g=>g.kind==='fuel').reduce((sum,g)=>sum+moneyCents(g.amount),0);
   const recordedOther=groups.filter(g=>g.kind!=='fuel').reduce((sum,g)=>sum+moneyCents(g.amount),0);
   // Do not add old snapshot values on top of itemized expenses. If their
   // labels disagree, the exact itemized spending takes precedence.
   const unitemized=Math.max(0,totalCents-recordedFuel-recordedOther);
   const remainingFuel=Math.min(unitemized,Math.max(0,fuelTarget-recordedFuel));
   const remainingOther=Math.min(unitemized-remainingFuel,Math.max(0,otherTarget-recordedOther));
   if(remainingFuel>0)groups.push({kind:'legacy-fuel',label:'Fuel',amount:remainingFuel/100,items:[]});
   if(remainingOther>0)groups.push({kind:'legacy-tolls',label:'Tolls / Parking',amount:remainingOther/100,items:[]});
 }
 // A historical repayment or unavailable itemization may leave part of the
 // snapshot without a known subtype. Do not invent Fuel/Tolls in that case.
 const known=groups.reduce((sum,g)=>sum+moneyCents(g.amount),0);
 if(totalCents>known)groups.push({kind:'unclassified',label:'Other Car spending',amount:(totalCents-known)/100,items:[]});
 const validGroups=groups.filter(g=>g.amount>.005);
 const carTitle=validGroups.length===1&&moneyCents(validGroups[0].amount)===totalCents?validGroups[0].label:'Car';
 const categories=[...sums.entries()].map(([label,cents])=>({label:label==='Car'?carTitle:label,amount:cents/100,car:label==='Car'}))
   .sort((a,b)=>b.amount-a.amount);
 return {categories,carGroups:validGroups,hasCarBreakdown:validGroups.length>1};
}
