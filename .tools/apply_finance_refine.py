from pathlib import Path

# index.html: generic My finances hero only on Overview, with subpage headings.
p=Path('index.html')
s=p.read_text()
old='''    <section id="finances" class="sheet finance-page">\n      <div class="finance-hero">\n        <div><span class="eyebrow">PERSONAL MONEY</span><h1>My finances</h1><p>Keep monthly finances, balances, loans and purchase ideas organised in separate pages.</p></div>\n      </div>\n      <div class="finance-subview active" data-fin-view="overview">\n        <div id="financeSummary" class="finance-summary"></div>'''
new='''    <section id="finances" class="sheet finance-page">\n      <div class="finance-subview active" data-fin-view="overview">\n        <div class="finance-hero">\n          <div><span class="eyebrow">PERSONAL MONEY</span><h1>My finances</h1><p>Keep monthly finances, balances, loans and purchase ideas organised in separate pages.</p></div>\n        </div>\n        <div id="financeSummary" class="finance-summary"></div>'''
assert old in s
s=s.replace(old,new,1)

repls=[
('''      <div class="finance-subview" data-fin-view="monthly">\n        <div class="finance-grid">''','''      <div class="finance-subview" data-fin-view="monthly">\n        <div class="finance-subpage-heading"><span class="eyebrow">MONTH BY MONTH</span><h1>Monthly finances</h1><p>Review, edit and confirm your personal finances one month at a time.</p></div>\n        <div class="finance-grid">'''),
('''      <div class="finance-subview" data-fin-view="balances">\n        <section id="financeCurrent" class="finance-current"></section>''','''      <div class="finance-subview" data-fin-view="balances">\n        <div class="finance-subpage-heading"><span class="eyebrow">CURRENT POSITION</span><h1>Balances & loans</h1><p>Keep track of cash, savings on hold, investments and money that still needs to be paid back to you.</p></div>\n        <section id="financeCurrent" class="finance-current"></section>'''),
('''      <div class="finance-subview" data-fin-view="scenarios">\n        <section id="financeScenarios"></section>''','''      <div class="finance-subview" data-fin-view="scenarios">\n        <div class="finance-subpage-heading"><span class="eyebrow">WHAT IF?</span><h1>Test scenarios</h1><p>Test a possible purchase against your Main account leftover, available savings and usual monthly leftover.</p></div>\n        <section id="financeScenarios"></section>'''),
('''      <div class="finance-subview" data-fin-view="wishlist">\n        <section id="financeWishlist"></section>''','''      <div class="finance-subview" data-fin-view="wishlist">\n        <div class="finance-subpage-heading"><span class="eyebrow">LATER</span><h1>Wishlist</h1><p>Keep things you may want to buy later without adding them to your budget yet.</p></div>\n        <section id="financeWishlist"></section>''')]
for old,new in repls:
    assert old in s
    s=s.replace(old,new,1)
s=s.replace('finance.css?v=4','finance.css?v=5',1)
s=s.replace('wishlist.css?v=1','wishlist.css?v=2',1)
s=s.replace('ui.js?v=4','ui.js?v=5',1)
s=s.replace('wishlist.js?v=1','wishlist.js?v=2',1)
p.write_text(s)

# ui.js: always allow a new/open additional plan from the page header.
p=Path('ui.js')
s=p.read_text()
start=s.index('  function syncBudgetHeaderButton(){')
end=s.index('\n  function refreshBudgetUi(){',start)
replacement='''  function syncBudgetHeaderButton(){\n    const header=document.querySelector('[data-v5-new-plan]');\n    const grid=document.getElementById('budgetPlanGrid');\n    if(!header||!grid)return;\n    const openCards=[...grid.querySelectorAll('.budget-plan-card')].filter(card=>!card.classList.contains('hidden'));\n    header.textContent=openCards.length?'Plan another trip budget':'Plan a trip budget';\n    header.disabled=false;\n    header.dataset.v6Mode='new';\n    delete header.dataset.v6PlanId;\n  }\n'''
s=s[:start]+replacement+s[end:]
p.write_text(s)

# wishlist.js: table rows + safe short links.
p=Path('wishlist.js')
s=p.read_text()
anchor='''  function normalizeWishlist(list){\n    return Array.isArray(list)?list.map(x=>({id:x.id||uid(),name:String(x.name||''),price:x.price??'',note:String(x.note||''),createdAt:String(x.createdAt||'')})).filter(x=>x.name):[];\n  }\n'''
assert anchor in s
helpers=r'''

  function wishlistNoteParts(value){
    const note=String(value||'').trim();
    if(!note)return {text:'',link:''};
    const match=note.match(/https?:\/\/\S+/i);
    if(!match)return {text:note,link:''};
    const link=match[0];
    const text=(note.slice(0,match.index)+note.slice((match.index||0)+link.length)).trim().replace(/^[-–—·|:,;\s]+|[-–—·|:,;\s]+$/g,'');
    return {text,link};
  }

  function wishlistNoteHtml(value){
    const parts=wishlistNoteParts(value);
    const text=parts.text?`<span class="wishlist-note-text">${esc(parts.text)}</span>`:'';
    const link=parts.link?`<a class="wishlist-open-link" href="${esc(parts.link)}" target="_blank" rel="noopener noreferrer">Open link ↗</a>`:'';
    return text||link?`${text}${link}`:'<span class="wishlist-muted">—</span>';
  }
'''
s=s.replace(anchor,anchor+helpers,1)
start=s.index('  function render(){')
end=s.index('\n  function ensureModal(){',start)
render=r'''  function render(){
    const root=$('#financeWishlist'); if(!root) return;
    const a=actor();
    if(!a){root.innerHTML='<div class="finance-current-empty">Choose Principessa or Principe first.</div>';return;}
    const priced=items.filter(x=>x.price!==''&&x.price!=null);
    const total=priced.reduce((sum,x)=>sum+n(x.price),0);
    const rows=items.length?items.map((x,i)=>`<tr><td class="wishlist-item-name"><strong>${esc(x.name)}</strong></td><td class="wishlist-note-cell">${wishlistNoteHtml(x.note)}</td><td class="wishlist-price-cell">${x.price!==''&&x.price!=null?money(x.price):'—'}</td><td class="wishlist-edit-cell"><button class="wishlist-edit-btn" type="button" data-wish-index="${i}" aria-label="Edit ${esc(x.name)}">Edit</button></td></tr>`).join(''):`<tr><td colspan="4"><div class="wishlist-empty-row">Your wishlist is empty. Add something you may want to buy later.</div></td></tr>`;
    root.innerHTML=`<div class="wishlist-wrap"><div class="wishlist-head"><div><h2>${esc(a)}’s wishlist</h2><p>Wishlist items are informational only and do not affect your budget, savings or net worth.</p></div><button class="btn primary" type="button" data-wish-add>+ Add wish</button></div><div class="wishlist-table-wrap"><table class="wishlist-table"><thead><tr><th>Item</th><th>Note / Link</th><th>Estimated price</th><th class="wishlist-edit-head">Edit</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="2"><strong>Total</strong><small>${items.length} ${items.length===1?'item':'items'}</small></td><td class="wishlist-price-cell"><strong>${priced.length?money(total):'—'}</strong></td><td></td></tr></tfoot></table></div></div>`;
    $('[data-wish-add]',root)?.addEventListener('click',()=>openModal(-1));
    root.querySelectorAll('[data-wish-index]').forEach(btn=>btn.addEventListener('click',()=>openModal(Number(btn.dataset.wishIndex))));
  }
'''
s=s[:start]+render+s[end:]
p.write_text(s)

# finance scenario alignment + page headings.
p=Path('finance.css')
s=p.read_text()+r'''

.finance-subpage-heading{margin:0 0 22px}.finance-subpage-heading h1{margin:4px 0 6px;font-size:clamp(34px,4vw,54px);font-weight:500;letter-spacing:-.035em}.finance-subpage-heading p{margin:0;color:var(--muted);max-width:780px;line-height:1.5}
.finance-scenario-grid{align-items:stretch!important}.finance-scenario-card{display:flex!important;flex-direction:column!important;justify-content:flex-start!important;align-items:stretch!important;text-align:left!important}.finance-scenario-card>.panel-kicker{display:block;margin:0 0 5px}.finance-scenario-card>h3{margin:0 0 14px!important;min-height:0!important}.finance-scenario-card .scenario-row{flex:0 0 auto}.finance-scenario-card .scenario-verdict{margin-top:auto;padding-top:14px}
'''
p.write_text(s)

# Wishlist table styles.
p=Path('wishlist.css')
s=p.read_text()+r'''

.wishlist-head{align-items:center}.wishlist-head h2{margin:0 0 5px}.wishlist-table-wrap{width:100%;overflow-x:auto;border:1px solid var(--line);border-radius:20px;background:var(--card);box-shadow:0 10px 28px rgba(60,45,35,.045)}.wishlist-table{width:100%;border-collapse:collapse;table-layout:fixed;min-width:680px}.wishlist-table th{padding:12px 15px;text-align:left;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);background:#f7f3ee;border-bottom:1px solid var(--line)}.wishlist-table td{padding:14px 15px;border-bottom:1px solid rgba(100,80,65,.1);vertical-align:middle}.wishlist-table tbody tr:last-child td{border-bottom:0}.wishlist-table th:nth-child(1),.wishlist-table td:nth-child(1){width:24%}.wishlist-table th:nth-child(2),.wishlist-table td:nth-child(2){width:48%}.wishlist-table th:nth-child(3),.wishlist-table td:nth-child(3){width:20%}.wishlist-table th:nth-child(4),.wishlist-table td:nth-child(4){width:8%}.wishlist-item-name strong{font-size:17px}.wishlist-note-cell{overflow-wrap:anywhere;word-break:break-word}.wishlist-note-text{display:block;color:var(--muted);margin-bottom:3px}.wishlist-open-link{display:inline-flex;align-items:center;gap:4px;color:var(--accent-dark);font-weight:700;font-size:13px;text-decoration:none}.wishlist-open-link:hover{text-decoration:underline}.wishlist-price-cell{text-align:right!important;white-space:nowrap;font-weight:700}.wishlist-edit-head{text-align:center!important}.wishlist-edit-cell{text-align:center}.wishlist-edit-btn{border:0;background:transparent;padding:5px 6px;font:inherit;font-size:11px;color:var(--muted);cursor:pointer;text-decoration:underline;text-underline-offset:2px}.wishlist-edit-btn:hover{color:var(--text)}.wishlist-table tfoot td{background:#faf7f2;border-top:1px solid var(--line);border-bottom:0}.wishlist-table tfoot strong{font-size:16px}.wishlist-table tfoot small{display:block;color:var(--muted);font-size:11px;margin-top:2px}.wishlist-empty-row{text-align:center;color:var(--muted);padding:20px 8px}@media(max-width:700px){.wishlist-head{align-items:flex-start;flex-direction:column}.wishlist-table-wrap{border-radius:16px}.wishlist-table{min-width:610px}}
'''
p.write_text(s)
