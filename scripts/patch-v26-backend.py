from pathlib import Path

HELPERS = r'''

function defaultGameProfile_() {
  return {
    lovis:0, twos:0, purchases:[], theme:'default', lastSeenAt:'',
    awards:{logs:[],tripConfirms:[],financeConfirms:[],expenses:[],daily:[],sessions:[]},
    packing:{}, planners:{}
  };
}

function defaultGame_() {
  return {Principessa:defaultGameProfile_(), Principe:defaultGameProfile_(), signals:[]};
}

function gameStringList_(value, maxItems) {
  const arr = Array.isArray(value) ? value.map(function(x){ return cleanText_(x, 180); }).filter(Boolean) : [];
  return Array.from(new Set(arr)).slice(-(maxItems || 500));
}

function sanitizeGameProfile_(value) {
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
  return {
    lovis:Math.max(0, Number(s.lovis != null ? s.lovis : s.tokens) || 0),
    twos:Math.max(0, Number(s.twos) || 0),
    purchases:gameStringList_(s.purchases,100),
    theme:['default','cozy','night'].indexOf(String(s.theme||''))>=0?String(s.theme):'default',
    lastSeenAt:cleanText_(s.lastSeenAt,40),
    awards:{
      logs:gameStringList_(awards.logs,500), tripConfirms:gameStringList_(awards.tripConfirms,300), financeConfirms:gameStringList_(awards.financeConfirms,300),
      expenses:gameStringList_(awards.expenses,800), daily:gameStringList_(awards.daily,500), sessions:gameStringList_(awards.sessions,500)
    }, packing:packing, planners:planners
  };
}

function sanitizeGame_(value) {
  const g=value&&typeof value==='object'?value:{};
  const signals=(Array.isArray(g.signals)?g.signals:[]).slice(-40).map(function(x){
    const from=cleanActor_(x&&x.from),to=cleanActor_(x&&x.to); if(from==='Unknown'||to==='Unknown'||from===to)return null;
    const type=String(x&&x.type)==='note'?'note':'heart';
    return {id:cleanText_(x&&x.id,80)||Utilities.getUuid(),from:from,to:to,type:type,text:type==='note'?cleanText_(x&&x.text,160):'',createdAt:cleanText_(x&&x.createdAt,40)||new Date().toISOString(),seenAt:cleanText_(x&&x.seenAt,40)};
  }).filter(Boolean);
  return {Principessa:sanitizeGameProfile_(g.Principessa),Principe:sanitizeGameProfile_(g.Principe),signals:signals};
}

function mergeGameLists_(a,b,maxItems){return gameStringList_((a||[]).concat(b||[]),maxItems||500);}
function gameCatalog_(){return {
  'gold-heart':{currency:'lovis',cost:20},'cute-icons':{currency:'lovis',cost:30},'soft-sparkles':{currency:'twos',cost:800},
  'trip-countdown':{currency:'lovis',cost:50},'theme-pack':{currency:'lovis',cost:60},'packing-list':{currency:'lovis',cost:70},
  'flying-heart':{currency:'twos',cost:1200},'travel-passport':{currency:'lovis',cost:80},'flying-note':{currency:'twos',cost:2000},
  'custom-dashboard':{currency:'lovis',cost:100},'trip-planner-plus':{currency:'lovis',cost:120},'world-map':{currency:'lovis',cost:150}
};}
function gameResponse_(state, extra){return Object.assign({ok:true,game:sanitizeGame_(state.game)},extra||{});}
'''

ACTIONS = r'''

    if (action === 'shopSync') {
      state.game = sanitizeGame_(state.game);
      const current = state.game[actor], incoming = sanitizeGameProfile_(payload.local || {});
      current.lovis = Math.max(current.lovis, incoming.lovis);
      current.twos = Math.max(current.twos, incoming.twos);
      current.purchases = mergeGameLists_(current.purchases, incoming.purchases, 100);
      Object.keys(current.awards).forEach(function(k){ current.awards[k]=mergeGameLists_(current.awards[k], incoming.awards[k], k==='expenses'?800:500); });
      current.packing = Object.assign({}, incoming.packing || {}, current.packing || {});
      current.planners = Object.assign({}, incoming.planners || {}, current.planners || {});
      if(current.theme==='default' && incoming.theme!=='default') current.theme=incoming.theme;
      current.lastSeenAt = new Date().toISOString();
      state.game[actor]=sanitizeGameProfile_(current); saveState_(state);
      return output_(gameResponse_(state,{profile:state.game[actor]}));
    }

    if (action === 'shopAward') {
      state.game = sanitizeGame_(state.game);
      const rules={log:{bucket:'logs',currency:'lovis',amount:5},tripConfirm:{bucket:'tripConfirms',currency:'lovis',amount:10},financeConfirm:{bucket:'financeConfirms',currency:'lovis',amount:15},expense:{bucket:'expenses',currency:'twos',amount:100},daily:{bucket:'daily',currency:'twos',amount:200},session:{bucket:'sessions',currency:'twos',amount:400}};
      const kind=cleanText_(payload.kind,30),key=cleanText_(payload.key,180),rule=rules[kind];
      if(!rule||!key)throw new Error('Invalid shop reward');
      const pstate=state.game[actor]; let awarded=0;
      if(pstate.awards[rule.bucket].indexOf(key)<0){pstate.awards[rule.bucket].push(key);pstate.awards[rule.bucket]=gameStringList_(pstate.awards[rule.bucket],rule.bucket==='expenses'?800:500);pstate[rule.currency]+=rule.amount;awarded=rule.amount;}
      pstate.lastSeenAt=new Date().toISOString(); state.game[actor]=sanitizeGameProfile_(pstate); saveState_(state);
      return output_(gameResponse_(state,{awarded:awarded,currency:rule.currency,profile:state.game[actor]}));
    }

    if (action === 'shopPurchase') {
      state.game=sanitizeGame_(state.game); const id=cleanText_(payload.id,60),item=gameCatalog_()[id]; if(!item)throw new Error('Unknown shop reward');
      const pstate=state.game[actor]; if(pstate.purchases.indexOf(id)<0){if(Number(pstate[item.currency])<item.cost)throw new Error('Not enough '+(item.currency==='lovis'?'Lovis':'Twos'));pstate[item.currency]-=item.cost;pstate.purchases.push(id);}state.game[actor]=sanitizeGameProfile_(pstate);saveState_(state);return output_(gameResponse_(state,{profile:state.game[actor]}));
    }

    if (action === 'shopSetTheme') {
      state.game=sanitizeGame_(state.game);const pstate=state.game[actor];if(pstate.purchases.indexOf('theme-pack')<0)throw new Error('Unlock the theme pack first');const theme=cleanText_(payload.theme,20);pstate.theme=['default','cozy','night'].indexOf(theme)>=0?theme:'default';state.game[actor]=sanitizeGameProfile_(pstate);saveState_(state);return output_(gameResponse_(state));
    }

    if (action === 'shopSavePacking') {
      state.game=sanitizeGame_(state.game);const pstate=state.game[actor];if(pstate.purchases.indexOf('packing-list')<0)throw new Error('Unlock Packing List first');const id=cleanText_(payload.id,80);if(!id)throw new Error('Trip not found');pstate.packing[id]=(Array.isArray(payload.list)?payload.list:[]).slice(0,100).map(function(x){return {text:cleanText_(x&&x.text,120),done:!!(x&&x.done)};}).filter(function(x){return !!x.text;});state.game[actor]=sanitizeGameProfile_(pstate);saveState_(state);return output_(gameResponse_(state));
    }

    if (action === 'shopSavePlanner') {
      state.game=sanitizeGame_(state.game);const pstate=state.game[actor];if(pstate.purchases.indexOf('trip-planner-plus')<0)throw new Error('Unlock Trip Planner+ first');const id=cleanText_(payload.id,80),p=payload.planner||{};if(!id)throw new Error('Trip not found');pstate.planners[id]={stay:cleanText_(p.stay,160),transport:cleanText_(p.transport,160),booking:cleanText_(p.booking,160),notes:cleanText_(p.notes,1200)};state.game[actor]=sanitizeGameProfile_(pstate);saveState_(state);return output_(gameResponse_(state));
    }

    if (action === 'shopSendSignal') {
      state.game=sanitizeGame_(state.game);const type=String(payload.type)==='note'?'note':'heart',need=type==='note'?'flying-note':'flying-heart',pstate=state.game[actor];if(pstate.purchases.indexOf(need)<0)throw new Error('Unlock '+(type==='note'?'Flying Note':'Flying Heart')+' first');const to=actor==='Principessa'?'Principe':'Principessa';state.game.signals.push({id:Utilities.getUuid(),from:actor,to:to,type:type,text:type==='note'?cleanText_(payload.text,160):'',createdAt:new Date().toISOString(),seenAt:''});state.game.signals=state.game.signals.slice(-40);saveState_(state);return output_(gameResponse_(state));
    }

    if (action === 'shopMarkSignalsSeen') {
      state.game=sanitizeGame_(state.game);const now=new Date().toISOString();state.game.signals.forEach(function(x){if(x.to===actor&&!x.seenAt)x.seenAt=now;});saveState_(state);return output_(gameResponse_(state));
    }
'''

def patch(text: str) -> str:
    if 'function defaultGameProfile_()' in text:
        return text
    text=text.replace("    compare: {\n", "    game: defaultGame_(),\n    compare: {\n", 1)
    text=text.replace("      financeProfiles: sanitizeFinanceProfiles_(parsed.financeProfiles),\n      compare:", "      financeProfiles: sanitizeFinanceProfiles_(parsed.financeProfiles),\n      game: sanitizeGame_(parsed.game),\n      compare:", 1)
    text=text.replace("  state.financeProfiles = sanitizeFinanceProfiles_(state.financeProfiles);\n  PropertiesService", "  state.financeProfiles = sanitizeFinanceProfiles_(state.financeProfiles);\n  state.game = sanitizeGame_(state.game);\n  PropertiesService", 1)
    marker='\nfunction migrateTrip_(trip) {'
    if marker not in text: raise RuntimeError('migrate marker missing')
    text=text.replace(marker, HELPERS+marker, 1)
    unknown="\n    return output_({ok:false, error:'Unknown action'});"
    if unknown not in text: raise RuntimeError('unknown-action marker missing')
    text=text.replace(unknown, ACTIONS+unknown, 1)
    return text

paths=[Path('backend/Code.gs'),Path('backend/Code-v17.gs')]
for p in paths:
    p.write_text(patch(p.read_text()),encoding='utf-8')
if paths[0].read_text()!=paths[1].read_text():
    raise RuntimeError('canonical backend copies diverged')
print('Patched shared game backend into both canonical files.')
