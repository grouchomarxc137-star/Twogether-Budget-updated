// Spending tracker driven by Principe's recurring items, never by planned trip budgets.
// Uses cents to avoid floating-point drift. Expenses appearing in both logs on the
// same day for the same amount are matched once, without changing either record.
const cents = (value) => Math.max(0, Math.round((Number(value) || 0) * 100));
const label = (value) => String(value || '').trim().toLocaleLowerCase();
export function recurringBudgetItems(recurring) {
  return (Array.isArray(recurring?.expenses) ? recurring.expenses : [])
    .filter((item) => item?.isBudget === true && item?.id && label(item.name) && Number(item.amount) > 0)
    .map((item) => ({ id:String(item.id), name:String(item.name), amount:Number(item.amount) }));
}
export function budgetCategoryForTrip(entry) {
  if (entry?.category === 'transport' && entry.transportType === 'fuel') return 'fuel';
  if (entry?.category === 'food' && entry.foodType === 'groceries') return 'groceries';
  return '';
}
export function budgetKeyForItem(item) {
  const name=label(item?.name);
  if (/^(fuel|gas|petrol|diesel|car fuel)$/.test(name)) return 'fuel';
  if (/^(groceries|grocery|supermarket)$/.test(name)) return 'groceries';
  return '';
}
function financeMatches(budget, expense) {
  if(!expense || expense.paidFrom === 'sharedJar' || expense.budgetCategoryId === 'none')return false;
  if(expense.budgetCategoryId) return String(expense.budgetCategoryId) === String(budget.id);
  return label(expense.name) === label(budget.name);
}
function tripPaidCents(entry, owner) {
  const raw = cents(entry?.amount) - cents(entry?.jarContribution);
  if(raw <= 0) return 0;
  if(entry.paidBy === owner) return raw;
  if(entry.paidBy === 'both') return Math.round(raw / 2);
  return 0;
}
export function budgetProgressForMonth(items, record, plans = [], month = record?.month || '', owner = 'Principe', exclude = {}) {
  const financeRows=Array.isArray(record?.expenses)?record.expenses:[];
  const financeExclude=exclude.financeExpenseId||'';
  const tripExclude=exclude.tripExpenseId||'';
  const tripExcludePlan=exclude.tripPlanId||'';
  return (Array.isArray(items)?items:[]).map((budget)=>{
    const matchedFinance=financeRows.filter((row)=>!((financeExclude&&String(row.id)===String(financeExclude)))&&financeMatches(budget,row));
    const financialCents=matchedFinance.reduce((sum,row)=>sum+cents(row.amount),0);
    const tripKey=budgetKeyForItem(budget);
    const remainingDuplicates=new Map();
    // Finance entries count once even if their matching trip entry has also been logged.
    // Dedup only on exact date and amount, never across days.
    matchedFinance.forEach((row)=>{
      const date=String(row.date||'');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      const key=date+'|'+cents(row.amount);
      remainingDuplicates.set(key,(remainingDuplicates.get(key)||0)+1);
    });
    let tripCents=0;
    if(tripKey){
      (Array.isArray(plans)?plans:[]).forEach((plan)=>{
        (Array.isArray(plan?.expenseEntries)?plan.expenseEntries:[]).forEach((entry)=>{
          if(tripExclude&&String(plan.id)===String(tripExcludePlan)&&String(entry.id)===String(tripExclude))return;
          if(String(entry?.date||'').slice(0,7)!==month || budgetCategoryForTrip(entry)!==tripKey)return;
          const paid=tripPaidCents(entry,owner);
          if(!paid)return;
          const partialKey=String(entry.date)+'|'+paid;
          const fullKey=String(entry.date)+'|'+cents(entry.amount);
          const duplicateKey=(remainingDuplicates.get(partialKey)||0)>0?partialKey:fullKey;
          const duplicates=remainingDuplicates.get(duplicateKey)||0;
          if(duplicates>0){remainingDuplicates.set(duplicateKey,duplicates-1);return;}
          tripCents+=paid;
        });
      });
    }
    const amountCents=cents(budget.amount),spentCents=financialCents+tripCents;
    return {...budget, amount:amountCents/100,spent:spentCents/100,
      remaining:(amountCents-spentCents)/100,percentage:amountCents>0?Math.min(100,spentCents/amountCents*100):0,
      over:spentCents>amountCents,tripSpent:tripCents/100};
  });
}
