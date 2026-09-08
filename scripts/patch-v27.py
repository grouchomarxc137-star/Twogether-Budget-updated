from pathlib import Path
import re

ROOT=Path('.')

def must(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing pattern: {label}')
    return text.replace(old,new,1)

# index: load v27 runtime, stop old wishlist/shop runtimes.
p=ROOT/'index.html'; s=p.read_text()
s=must(s,'<link rel="stylesheet" href="shop-v26.css?v=1">','<link rel="stylesheet" href="v27.css?v=1">','index shop css')
s=must(s,'<script src="wishlist.js?v=18" defer></script>\n','', 'remove old wishlist runtime')
s=must(s,'<script src="shop-v26.js?v=1" defer></script>','<script src="v27.js?v=1" defer></script>','index v27 runtime')
p.write_text(s)

# API requires v18 for writes.
p=ROOT/'api.js'; s=p.read_text()
s=s.replace("if(current.version<17)throw Error('Apps Script update required: deploy backend/Code.gs (v17) before saving.');","if(current.version<18)throw Error('Apps Script update required: deploy backend/Code.gs (v18) before saving.');")
p.write_text(s)

# Preserve Wishlist and custom comparison data when finance pages save the profile.
p=ROOT/'finances.js'; s=p.read_text()
s=must(s,"return {bankAccounts:[],savingsTotal:'',savingsReserved:[],receivables:[],scenarios:[],updatedAt:'',updatedBy:''};","return {bankAccounts:[],savingsTotal:'',savingsReserved:[],receivables:[],scenarios:[],wishlist:[],compareLab:{},updatedAt:'',updatedBy:''};",'fresh profile')
s=must(s,"scenarios:Array.isArray(p.scenarios)?p.scenarios.map(x=>({id:x.id||uid(),name:String(x.name||''),upfront:x.upfront??'',monthly:x.monthly??''})):[],\n      updatedAt:p.updatedAt||'',updatedBy:p.updatedBy||''","scenarios:Array.isArray(p.scenarios)?p.scenarios.map(x=>({id:x.id||uid(),name:String(x.name||''),upfront:x.upfront??'',monthly:x.monthly??''})):[],\n      wishlist:Array.isArray(p.wishlist)?JSON.parse(JSON.stringify(p.wishlist)):[],\n      compareLab:p.compareLab&&typeof p.compareLab==='object'?JSON.parse(JSON.stringify(p.compareLab)):{},\n      updatedAt:p.updatedAt||'',updatedBy:p.updatedBy||''",'normalize profile preserve v27')
p.write_text(s)

for name in ['backend/Code.gs','backend/Code-v17.gs']:
    p=ROOT/name; s=p.read_text()
    s=s.replace('version: 17,','version: 18,')
    s=s.replace('state.version = 17;','state.version = 18;')
    s=s.replace('{ok:true, version: 17, now:','{ok:true, version: 18, now:')
    s=s.replace("Principessa:{bankAccounts:[],savingsTotal:'',savingsReserved:[],receivables:[],scenarios:[],wishlist:[]},\n      Principe:{bankAccounts:[],savingsTotal:'',savingsReserved:[],receivables:[],scenarios:[],wishlist:[]}","Principessa:{bankAccounts:[],savingsTotal:'',savingsReserved:[],receivables:[],scenarios:[],wishlist:[],compareLab:{}},\n      Principe:{bankAccounts:[],savingsTotal:'',savingsReserved:[],receivables:[],scenarios:[],wishlist:[],compareLab:{}}")

    start=s.index('function sanitizeGameProfile_(value) {')
    end=s.index('\nfunction sanitizeGame_(value)',start)
    new_func="""function sanitizeGameProfile_(value) {
  const s = value && typeof value === 'object' ? value : {};
  const awards = s.awards && typeof s.awards === 'object' ? s.awards : {};
  const packing = {};
  const planners = {};
  if (s.packing && typeof s.packing === 'object') Object.keys(s.packing).slice(0,100).forEach(function(id){
    const key=cleanText_(id,80); if(!key)return;
    packing[key]=(Array.isArray(s.packing[id])?s.packing[id]:[]).slice(0,100).map(function(x){return {text:cleanText_(x&&x.text,120),done:!!(x&&x.done)};}).filter(function(x){return !!x.text;});
  });
  if (s.planners && typeof s.planners === 'object') Object.keys(s.planners).slice(0,100).forEach(function(id){
    const key=cleanText_(id,80),p=s.planners[id]||{}; if(!key)return;
    planners[key]={stay:cleanText_(p.stay,160),transport:cleanText_(p.transport,160),booking:cleanText_(p.booking,160),notes:cleanText_(p.notes,1200)};
  });
  const v27 = String(s.twosModel||'') === 'budget-v27';
  return {
    lovis:Math.max(0, Number(s.lovis != null ? s.lovis : s.tokens) || 0),
    twos:v27 ? (Number(s.twos)||0) : 0,
    twosModel:'budget-v27',
    purchases:gameStringList_(s.purchases,100),
    theme:['default','cozy','night'].indexOf(String(s.theme||''))>=0?String(s.theme):'default',
    lastSeenAt:cleanText_(s.lastSeenAt,40),
    awards:{
      logs:gameStringList_(awards.logs,500), tripConfirms:gameStringList_(awards.tripConfirms,300), financeConfirms:gameStringList_(awards.financeConfirms,300),
      expenses:gameStringList_(awards.expenses,800), compareSaves:gameStringList_(awards.compareSaves,400), compareCompletes:gameStringList_(awards.compareCompletes,300),
      wishlistAdds:gameStringList_(awards.wishlistAdds,500), wishlistCheckouts:gameStringList_(awards.wishlistCheckouts,500),
      tripSettlements:gameStringList_(awards.tripSettlements,400), financeSettlements:gameStringList_(awards.financeSettlements,400)
    }, packing:packing, planners:planners
  };
}
"""
    s=s[:start]+new_func+s[end:]

    # default game profile.
    s=re.sub(r"function defaultGameProfile_\(\) \{.*?\n\}","""function defaultGameProfile_() {
  return {
    lovis:0, twos:0, twosModel:'budget-v27', purchases:[], theme:'default', lastSeenAt:'',
    awards:{logs:[],tripConfirms:[],financeConfirms:[],expenses:[],compareSaves:[],compareCompletes:[],wishlistAdds:[],wishlistCheckouts:[],tripSettlements:[],financeSettlements:[]},
    packing:{}, planners:{}
  };
}""",s,count=1,flags=re.S)

    # Lovis-only shop catalog.
    s=re.sub(r"function gameCatalog_\(\)\{return \{.*?\};\}","""function gameCatalog_(){return {
  'date-night-jar':{currency:'lovis',cost:35},'flying-heart':{currency:'lovis',cost:40},'trip-countdown':{currency:'lovis',cost:50},
  'flying-note':{currency:'lovis',cost:55},'theme-pack':{currency:'lovis',cost:60},'packing-list':{currency:'lovis',cost:70},
  'travel-passport':{currency:'lovis',cost:80},'world-map':{currency:'lovis',cost:120}
};}""",s,count=1,flags=re.S)

    # Confirmation now settles personal trip budget performance into Twos.
    old="""      trip.confirmed[actor] = true;
      trip.updatedAt = new Date().toISOString();
      trip.updatedBy = actor;
      state.trips[idx] = trip;
      addAudit_(state, actor, 'confirmTrip', trip.id);
      saveState_(state);
      return output_({ok:true});"""
    new="""      const alreadyConfirmed = !!trip.confirmed[actor];
      trip.confirmed[actor] = true;
      trip.updatedAt = new Date().toISOString();
      trip.updatedBy = actor;
      state.trips[idx] = trip;
      let twosDelta = 0;
      if (!alreadyConfirmed) {
        state.game = sanitizeGame_(state.game);
        const pstate = state.game[actor];
        const planForTrip = state.plans.map(sanitizePlan_).find(function(p){ return p.linkedTripId === trip.id; });
        const budgetRaw = planForTrip && planForTrip.budgets && planForTrip.budgets[actor] !== '' ? planForTrip.budgets[actor] : trip.budget;
        const actualRaw = trip.submissions[actor] && trip.submissions[actor].paid;
        if (budgetRaw !== '' && actualRaw !== '' && isFinite(Number(budgetRaw)) && isFinite(Number(actualRaw))) {
          const settleKey='trip:'+actor+':'+trip.id;
          if (pstate.awards.tripSettlements.indexOf(settleKey) < 0) {
            twosDelta = Math.round((Number(budgetRaw)-Number(actualRaw))*100)/100;
            pstate.twos += twosDelta;
            pstate.awards.tripSettlements.push(settleKey);
          }
        }
        state.game[actor]=sanitizeGameProfile_(pstate);
      }
      addAudit_(state, actor, 'confirmTrip', trip.id);
      saveState_(state);
      return output_({ok:true,twosDelta:twosDelta,game:sanitizeGame_(state.game)});"""
    s=must(s,old,new,name+' confirm trip settle')

    # Finalized month settles real leftover into Twos.
    old="""      state.finances[actor] = list;
      saveState_(state);
      return output_({ok:true, month:monthData.month});"""
    new="""      state.finances[actor] = list;
      let twosDelta = 0;
      if (monthData.finalized) {
        state.game=sanitizeGame_(state.game);
        const pstate=state.game[actor],settleKey='month:'+actor+':'+monthData.month;
        if (pstate.awards.financeSettlements.indexOf(settleKey) < 0) {
          const income=(monthData.incomes||[]).reduce(function(sum,x){return sum+Number(x.amount||0);},0);
          const outflow=(monthData.expenses||[]).reduce(function(sum,x){return sum+Number(x.amount||0);},0)+(monthData.extraSpends||[]).reduce(function(sum,x){return sum+Number(x.amount||0);},0);
          twosDelta=Math.round((income-outflow)*100)/100;
          pstate.twos+=twosDelta;
          pstate.awards.financeSettlements.push(settleKey);
        }
        state.game[actor]=sanitizeGameProfile_(pstate);
      }
      saveState_(state);
      return output_({ok:true, month:monthData.month,twosDelta:twosDelta,game:sanitizeGame_(state.game)});"""
    s=must(s,old,new,name+' finance settle')

    # Profile save awards Lovis for genuinely new Wishlist goals.
    old="""    if (action === 'saveFinanceProfile') {
      state.financeProfiles = sanitizeFinanceProfiles_(state.financeProfiles);
      const profile = sanitizeFinanceProfile_(payload.profile || {}, actor);
      profile.updatedAt = new Date().toISOString();
      profile.updatedBy = actor;
      state.financeProfiles[actor] = profile;
      saveState_(state);
      return output_({ok:true});
    }

    if (action === 'updateCompare') {"""
    new="""    if (action === 'saveFinanceProfile') {
      state.financeProfiles = sanitizeFinanceProfiles_(state.financeProfiles);
      const before = sanitizeFinanceProfile_(state.financeProfiles[actor] || {}, actor);
      const profile = sanitizeFinanceProfile_(payload.profile || {}, actor);
      profile.updatedAt = new Date().toISOString();
      profile.updatedBy = actor;
      state.game=sanitizeGame_(state.game);
      const pstate=state.game[actor],oldIds=new Set((before.wishlist||[]).map(function(x){return x.id;}));
      let wishlistAwarded=0;
      (profile.wishlist||[]).forEach(function(item){
        const key='wish:'+actor+':'+item.id;
        if(!oldIds.has(item.id) && pstate.awards.wishlistAdds.indexOf(key)<0){pstate.awards.wishlistAdds.push(key);pstate.lovis+=3;wishlistAwarded+=3;}
      });
      state.game[actor]=sanitizeGameProfile_(pstate);
      state.financeProfiles[actor] = profile;
      saveState_(state);
      return output_(gameResponse_(state,{wishlistAwarded:wishlistAwarded}));
    }

    if (action === 'wishlistCheckout') {
      state.financeProfiles=sanitizeFinanceProfiles_(state.financeProfiles);state.game=sanitizeGame_(state.game);
      const ids=(Array.isArray(payload.ids)?payload.ids:[]).slice(0,20).map(function(x){return cleanText_(x,80);}).filter(Boolean);
      const profile=sanitizeFinanceProfile_(state.financeProfiles[actor]||{},actor),now=new Date().toISOString();
      const selected=(profile.wishlist||[]).filter(function(x){return ids.indexOf(x.id)>=0&&!x.unlockedAt&&x.price!=='';});
      if(!selected.length)throw new Error('Add a priced Wishlist item to the cart first');
      const total=Math.round(selected.reduce(function(sum,x){return sum+Number(x.price||0);},0)*100)/100,pstate=state.game[actor];
      if(Number(pstate.twos)<total)throw new Error('You need '+(total-Number(pstate.twos)).toFixed(2)+' more Twos');
      pstate.twos-=total;
      const selectedIds=new Set(selected.map(function(x){return x.id;}));
      profile.wishlist=profile.wishlist.map(function(x){if(selectedIds.has(x.id)){x.unlockedAt=now;x.unlockedBy=actor;}return x;});
      const checkoutKey='checkout:'+actor+':'+selected.map(function(x){return x.id;}).sort().join('|');
      if(pstate.awards.wishlistCheckouts.indexOf(checkoutKey)<0){pstate.awards.wishlistCheckouts.push(checkoutKey);pstate.lovis+=5;}
      state.game[actor]=sanitizeGameProfile_(pstate);state.financeProfiles[actor]=sanitizeFinanceProfile_(profile,actor);saveState_(state);
      return output_(gameResponse_(state,{spentTwos:total,profile:state.financeProfiles[actor]}));
    }

    if (action === 'saveCompareLab') {
      state.financeProfiles=sanitizeFinanceProfiles_(state.financeProfiles);state.game=sanitizeGame_(state.game);
      const profile=sanitizeFinanceProfile_(state.financeProfiles[actor]||{},actor),lab=sanitizeCompareLab_(payload.lab||{}),side=String(payload.side||'').toUpperCase();
      if(!lab.id||(['A','B'].indexOf(side)<0))throw new Error('Invalid comparison');
      profile.compareLab=lab;profile.updatedAt=new Date().toISOString();profile.updatedBy=actor;
      const pstate=state.game[actor],saveKey='compare:'+actor+':'+lab.id+':'+side;let awarded=0,compareCompleteAwarded=false;
      if(pstate.awards.compareSaves.indexOf(saveKey)<0){pstate.awards.compareSaves.push(saveKey);pstate.lovis+=4;awarded+=4;}
      const complete=(lab.rowsA||[]).some(function(x){return x.amount!=='';})&&(lab.rowsB||[]).some(function(x){return x.amount!=='';});
      const completeKey='compare-complete:'+actor+':'+lab.id;
      if(complete&&pstate.awards.compareCompletes.indexOf(completeKey)<0){pstate.awards.compareCompletes.push(completeKey);pstate.lovis+=6;awarded+=6;compareCompleteAwarded=true;}
      state.game[actor]=sanitizeGameProfile_(pstate);state.financeProfiles[actor]=sanitizeFinanceProfile_(profile,actor);saveState_(state);
      return output_(gameResponse_(state,{awarded:awarded,compareCompleteAwarded:compareCompleteAwarded,compareLab:lab}));
    }

    if (action === 'updateCompare') {"""
    s=must(s,old,new,name+' profile wishlist compare actions')

    # shopSync never imports legacy Twos; v27 Twos only come from settlements.
    s=s.replace('current.twos = Math.max(current.twos, incoming.twos);','current.twos = Number(current.twos) || 0;')
    old_rules="const rules={log:{bucket:'logs',currency:'lovis',amount:5},tripConfirm:{bucket:'tripConfirms',currency:'lovis',amount:10},financeConfirm:{bucket:'financeConfirms',currency:'lovis',amount:15},expense:{bucket:'expenses',currency:'twos',amount:100},daily:{bucket:'daily',currency:'twos',amount:200},session:{bucket:'sessions',currency:'twos',amount:400}};"
    new_rules="const rules={log:{bucket:'logs',currency:'lovis',amount:5},tripConfirm:{bucket:'tripConfirms',currency:'lovis',amount:10},financeConfirm:{bucket:'financeConfirms',currency:'lovis',amount:15},expense:{bucket:'expenses',currency:'lovis',amount:2}};"
    s=must(s,old_rules,new_rules,name+' shop award rules')

    # Wishlist fields and compare lab sanitizer.
    old="""function sanitizeFinanceWishlistItem_(item) {
  return {
    id: cleanText_(item && item.id, 80) || Utilities.getUuid(),
    name: cleanText_(item && item.name, 160),
    price: cleanMoney_(item && item.price),
    note: cleanText_(item && item.note, 300),
    createdAt: cleanText_(item && item.createdAt, 40)
  };
}

function sanitizeFinanceProfile_(profile, actor) {"""
    new="""function sanitizeFinanceWishlistItem_(item) {
  const priority=Math.min(5,Math.max(1,Number(item&&item.priority)||3));
  return {
    id: cleanText_(item && item.id, 80) || Utilities.getUuid(),
    name: cleanText_(item && item.name, 160),
    price: cleanMoney_(item && item.price),
    note: cleanText_(item && item.note, 500),
    priority: priority,
    createdAt: cleanText_(item && item.createdAt, 40),
    unlockedAt: cleanText_(item && item.unlockedAt, 40),
    unlockedBy: cleanActor_(item && item.unlockedBy)==='Unknown'?'':cleanActor_(item && item.unlockedBy)
  };
}
function sanitizeCompareRow_(item){return {id:cleanText_(item&&item.id,80)||Utilities.getUuid(),name:cleanText_(item&&item.name,120)||'Cost',amount:cleanMoney_(item&&item.amount)};}
function sanitizeCompareLab_(value){
  const v=value&&typeof value==='object'?value:{};
  return {id:cleanText_(v.id,80)||Utilities.getUuid(),titleA:cleanText_(v.titleA,120)||'Scenario A',titleB:cleanText_(v.titleB,120)||'Scenario B',rowsA:(Array.isArray(v.rowsA)?v.rowsA:[]).slice(0,30).map(sanitizeCompareRow_),rowsB:(Array.isArray(v.rowsB)?v.rowsB:[]).slice(0,30).map(sanitizeCompareRow_),updatedAt:new Date().toISOString()};
}

function sanitizeFinanceProfile_(profile, actor) {"""
    s=must(s,old,new,name+' wishlist sanitizer')
    s=must(s,"wishlist: Array.isArray(source.wishlist) ? source.wishlist.slice(0,100).map(sanitizeFinanceWishlistItem_).filter(x => x.name) : [],\n    updatedAt:","wishlist: Array.isArray(source.wishlist) ? source.wishlist.slice(0,100).map(sanitizeFinanceWishlistItem_).filter(x => x.name) : [],\n    compareLab: source.compareLab && typeof source.compareLab === 'object' ? sanitizeCompareLab_(source.compareLab) : {},\n    updatedAt:",name+' profile compare lab')

    p.write_text(s)

print('v27 integration patch applied')
