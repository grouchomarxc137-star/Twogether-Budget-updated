// Shared Trips-style UI builders used by Trips and Monthly Finances.
// Keep the structure here so both flows stay visually identical while each
// feature supplies only its own labels, data and actions.

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[ch]));

const button = (config, fallback = '<span></span>') => {
  if (!config) return fallback;
  if (config.html != null) return config.html;
  return '<button type="button" '+(config.attr || '')+'>'+esc(config.label || '')+'</button>';
};

export function tripDetailMoneyHtml({ first, second, progress = null, summary = null } = {}) {
  const firstTag = first?.button ? 'button' : 'div';
  const firstAttrs = first?.button ? ' type="button" '+(first.attr || '') : '';
  const firstExtra = first?.extraHtml || '';
  const progressHtml = progress == null
    ? ''
    : '<span class="overview-trip-progress"><i style="width:'+Math.max(0,Math.min(100,Number(progress)||0)).toFixed(1)+'%"></i></span>';
  const summaryHtml = summary
    ? '<div class="overview-trip-left '+(summary.over?'over':'')+'"><strong>'+esc(summary.value)+'</strong><span>'+esc(summary.label)+'</span></div>'
    : '';

  return '<section class="overview-trip-money">'+
    '<div class="overview-trip-figures">'+
      '<'+firstTag+firstAttrs+'><span>'+esc(first?.label)+'</span><strong>'+esc(first?.value)+'</strong>'+firstExtra+'</'+firstTag+'>'+
      '<div><span>'+esc(second?.label)+'</span><strong>'+esc(second?.value)+'</strong></div>'+
    '</div>'+
    progressHtml+
    summaryHtml+
  '</section>';
}

export function tripDetailShellHtml({
  back,
  right,
  title = '',
  subtitle = '',
  moneyHtml = '',
  middleHtml = '',
  listHtml = '',
  dock,
} = {}) {
  return '<div class="overview-trip-shell">'+
    '<header class="overview-trip-head">'+
      '<div class="overview-trip-nav">'+button(back)+button(right)+'</div>'+
      '<h2>'+esc(title)+'</h2>'+
      (subtitle?'<p>'+esc(subtitle)+'</p>':'')+
    '</header>'+
    moneyHtml+
    middleHtml+
    '<div class="overview-trip-list">'+listHtml+'</div>'+
    (dock?'<div class="overview-trip-dock">'+button(dock,'')+'</div>':'')+
  '</div>';
}

export function tripTimelineHtml(groups = [], { emptyText = '', rowHtml } = {}) {
  if (!groups.length) return '<p class="overview-trip-empty">'+esc(emptyText)+'</p>';
  return groups.map((group) =>
    '<section class="overview-trip-day"><h3>'+esc(group.label)+'</h3>'+
      (group.items || []).map((item,index)=>rowHtml(item,index,group)).join('')+
    '</section>'
  ).join('');
}

export function tripExpenseRowHtml({
  attr = '',
  icon = '',
  iconClass = '',
  title = '',
  meta = '',
  amount = '',
  amountClass = '',
  disabled = false,
} = {}) {
  return '<button type="button" class="overview-trip-expense" '+(disabled?'disabled ':'')+(attr || '')+'>'+
    '<span class="overview-trip-expense-icon '+iconClass+'" aria-hidden="true">'+icon+'</span>'+
    '<span class="overview-trip-expense-copy"><strong>'+esc(title)+'</strong><small>'+esc(meta)+'</small></span>'+
    '<b class="'+amountClass+'">'+esc(amount)+'</b>'+
  '</button>';
}

export function tripSheetHtml({
  title = '',
  closeAttr = '',
  amountId = '',
  amountValue = '',
  categoriesHtml = '',
  categoriesClass = '',
  categoriesLabel = 'Category',
  afterCategoriesHtml = '',
  defaultsHtml = '',
  moreHtml = '',
  hintAttr = '',
  hintClass = '',
  saveAttr = '',
  saveLabel = 'Save',
  saveDisabled = false,
} = {}) {
  return '<div class="tv2-sheet-head"><h2>'+esc(title)+'</h2><button type="button" class="tv2-x" '+closeAttr+' aria-label="Close">✕</button></div>'+
    '<label class="tv2-amount"><span aria-hidden="true">€</span><input id="'+esc(amountId)+'" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="0" value="'+esc(amountValue)+'" aria-label="Amount in euros"></label>'+
    '<div class="tv2-cats '+categoriesClass+'" role="group" aria-label="'+esc(categoriesLabel)+'">'+categoriesHtml+'</div>'+
    afterCategoriesHtml+
    defaultsHtml+
    moreHtml+
    '<p class="tv2-hint '+hintClass+'" '+hintAttr+' aria-live="polite"></p>'+
    '<button type="button" class="tv2-primary tv2-save" '+saveAttr+' '+(saveDisabled?'disabled':'')+'>'+esc(saveLabel)+'</button>';
}
