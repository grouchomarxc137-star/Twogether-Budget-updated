// Principe's Main Account category budgets: dated snapshots preserve historical limits.
// Spending comes only from expenses already saved in the finance month.
export function budgetItemsForMonth(history, month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) return [];
  const snapshots = Array.isArray(history) ? history : [];
  const latest = snapshots.filter((entry) => entry && entry.month <= month)
    .sort((a, b) => String(b.month).localeCompare(String(a.month)))[0];
  return Array.isArray(latest?.items) ? latest.items.map((item) => ({ ...item })) : [];
}

export function budgetSnapshotForMonth(history, month, items) {
  const past = (Array.isArray(history) ? history : []).filter((entry) => entry?.month !== month);
  return [...past, { month, items: items.map((item) => ({ ...item })) }]
    .sort((a, b) => String(a.month).localeCompare(String(b.month)));
}

export function budgetProgressForMonth(items, record) {
  const expenses = Array.isArray(record?.expenses) ? record.expenses : [];
  return (Array.isArray(items) ? items : []).map((item) => {
    const key = String(item.name || '').trim().toLocaleLowerCase();
    const spentCents = expenses.reduce((sum, expense) => {
      if (expense?.paidFrom === 'sharedJar' || expense?.budgetCategoryId === 'none') return sum;
      const amount = Number(expense?.amount);
      if (!Number.isFinite(amount) || amount <= 0) return sum;
      // Explicitly assigned expenses take precedence; legacy expenses match by name.
      const assignedId = String(expense?.budgetCategoryId || '');
      const matches = assignedId
        ? assignedId === String(item.id)
        : !!key && String(expense?.name || '').trim().toLocaleLowerCase() === key;
      return sum + (matches ? Math.round(amount * 100) : 0);
    }, 0);
    const limitCents = Math.max(0, Math.round(Number(item.amount || 0) * 100));
    const spent = spentCents / 100;
    const amount = limitCents / 100;
    return { ...item, amount, spent, remaining: (limitCents - spentCents) / 100,
      percentage: limitCents > 0 ? Math.min(100, spentCents / limitCents * 100) : 0,
      over: spentCents > limitCents };
  });
}
