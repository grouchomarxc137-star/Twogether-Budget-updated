// Date-only rules for future personal bills. Nothing here affects spending totals.
export function billOccurrenceDate(bill, year) {
  const anchor = String(bill?.date || '');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anchor);
  if (!match || !Number.isInteger(year)) return '';
  const firstYear = Number(match[1]);
  if (year < firstYear || (bill.repeat !== 'yearly' && year !== firstYear)) return '';
  const month = Number(match[2]), day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${match[2]}-${String(Math.min(day, maxDay)).padStart(2, '0')}`;
}

export function isFutureBillPaid(bill, date, financeMonths = []) {
  const month = (financeMonths || []).find((item) => item.month === date.slice(0, 7));
  return (month?.expenses || []).some((expense) =>
    expense.futureBillId === bill.id && expense.futureBillDueDate === date);
}

export function pendingFutureBillsForMonth(bills, month, financeMonths = []) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) return [];
  const year = Number(month.slice(0, 4));
  return (bills || []).flatMap((bill) => {
    const date = billOccurrenceDate(bill, year);
    return date && date.slice(0, 7) === month && !isFutureBillPaid(bill, date, financeMonths)
      ? [{ bill, date }] : [];
  });
}

export function dueFutureBills(bills, today, financeMonths = []) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today || ''))) return [];
  const currentYear = Number(today.slice(0, 4));
  return (bills || []).flatMap((bill) => {
    const from = Number(String(bill.date || '').slice(0, 4));
    if (!Number.isInteger(from) || from > currentYear) return [];
    const to = bill.repeat === 'yearly' ? currentYear : from;
    const matches = [];
    for (let year = from; year <= to; year++) {
      const date = billOccurrenceDate(bill, year);
      if (date && date <= today && !isFutureBillPaid(bill, date, financeMonths)) {
        matches.push({ bill, date });
      }
    }
    return matches;
  });
}
