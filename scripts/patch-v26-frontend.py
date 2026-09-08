from pathlib import Path
p=Path('index.html')
s=p.read_text(encoding='utf-8')
s=s.replace('<link rel="stylesheet" href="shop-v24.css?v=1">','<link rel="stylesheet" href="shop-v26.css?v=1">')
s=s.replace('<script src="overview.js?v=19" defer></script>','<script src="overview-v26.js?v=1" defer></script>')
s=s.replace('<script src="shop-v24.js?v=2" defer></script>','<script src="shop-v26.js?v=1" defer></script>')
if 'shop-v26.js' not in s or 'overview-v26.js' not in s or 'shop-v26.css' not in s:
    raise RuntimeError('v26 entrypoint patch failed')
p.write_text(s,encoding='utf-8')

j=Path('shop-v26.js')
t=j.read_text(encoding='utf-8')
old="if(action==='shopPurchase'){const item=catalog[payload.id];if(item&&!p.purchases.includes(item.id)&&p[item.currency]>=item.cost){p[item.currency]-=item.cost;p.purchases.push(item.id);}}"
new="if(action==='shopPurchase'){const item=catalog[payload.id];if(!item)return {ok:false,error:'Unknown shop reward',game:g,fallback:true};if(!p.purchases.includes(item.id)){if(p[item.currency]<item.cost)return {ok:false,error:'Not enough '+(item.currency==='lovis'?'Lovis':'Twos'),game:g,fallback:true};p[item.currency]-=item.cost;p.purchases.push(item.id);}}"
if old in t:t=t.replace(old,new,1)
marker="function openNoteComposer(){"
preview="""function previewSignal(type,text=''){let el=$('#flyingMessage');if(!el){el=document.createElement('aside');el.id='flyingMessage';el.className='flying-message';document.body.appendChild(el);}el.innerHTML=type==='note'?`<button aria-label=\"Close\">×</button><span>✉</span><small>Test preview from Principessa</small><strong>${esc(text||'Thinking about you…')}</strong>`:`<button aria-label=\"Close\">×</button><span class=\"flying-heart-glyph\">♥</span><small>Test preview</small><strong>Principessa is thinking about you ♡</strong>`;el.classList.add('show');$('button',el).onclick=()=>el.classList.remove('show');}\n"""
if preview.strip() not in t and marker in t:t=t.replace(marker,preview+marker,1)
old_note="const r=await gamePost('shopSendSignal',{type:'note',text});if(r?.ok){m.hidden=true;toast('Flying note sent ✉');}"
new_note="if(test().active){previewSignal('note',text);m.hidden=true;toast('Flying note preview ✉');return;}const r=await gamePost('shopSendSignal',{type:'note',text});if(r?.ok){m.hidden=true;toast('Flying note sent ✉');}"
t=t.replace(old_note,new_note,1)
old_heart="async function sendHeart(){const r=await gamePost('shopSendSignal',{type:'heart'});if(r?.ok)toast(`Heart sent to ${other()} ♥`);}"
new_heart="async function sendHeart(){if(test().active){previewSignal('heart');toast('Flying heart preview ♥');return;}const r=await gamePost('shopSendSignal',{type:'heart'});if(r?.ok)toast(`Heart sent to ${other()} ♥`);}"
t=t.replace(old_heart,new_heart,1)
t=t.replace("<strong>Twos</strong> reward the little actions: each new expense, your daily visit, and a 30-minute active session.</p>","<strong>Twos</strong> reward the little actions: each new expense, your daily visit, and a 30-minute active session. Daily visit and 30-minute bonuses are each awarded once per day.</p>",1)
j.write_text(t,encoding='utf-8')
print('Patched v26 frontend entrypoints and test/fallback behavior.')
