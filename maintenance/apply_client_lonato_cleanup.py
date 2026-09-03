from pathlib import Path

p=Path('workflow.js')
s=p.read_text(encoding='utf-8')

old="""  let activeFlow = null;\n  let budgetModalMode = '';\n  let budgetModalPlanId = '';\n"""
new="""  let activeFlow = null;\n  let budgetModalMode = '';\n  let budgetModalPlanId = '';\n  let lonatoCleanupRunning = false;\n  let lonatoCleanupAttempts = 0;\n"""
if old not in s: raise SystemExit('state vars block not found')
s=s.replace(old,new,1)

old="""  function planById(id){ return sharedState.plans.find(p=>p.id===id); }\n  function tripById(id){ return sharedState.trips.find(t=>t.id===id); }\n  function tripForPlan(plan){ return plan?.linkedTripId ? tripById(plan.linkedTripId) : null; }\n  function isLocked(trip){ return !!(trip?.confirmed?.Principessa && trip?.confirmed?.Principe); }\n"""
new="""  function planById(id){ return sharedState.plans.find(p=>p.id===id); }\n  function tripById(id){ return sharedState.trips.find(t=>t.id===id); }\n  function tripForPlan(plan){ return plan?.linkedTripId ? tripById(plan.linkedTripId) : null; }\n  function isLocked(trip){ return !!(trip?.confirmed?.Principessa && trip?.confirmed?.Principe); }\n  function isLonatoName(value){ return /lonato|loanto/i.test(String(value||'')); }\n  function tripCity(trip){ return trip?.submissions?.Principessa?.city || trip?.submissions?.Principe?.city || ''; }\n  function isLonatoTrip(trip){ return isLonatoName(tripCity(trip)); }\n  function isLonatoPlan(plan){ return isLonatoName(plan?.meta?.city); }\n\n  async function cleanupLonatoTrips(trips){\n    if(lonatoCleanupRunning || !trips?.length || lonatoCleanupAttempts>=3) return;\n    lonatoCleanupRunning=true; lonatoCleanupAttempts++;\n    try{\n      for(const trip of trips){\n        if(!trip?.id) continue;\n        await post('deleteTrip',{id:trip.id},'Principessa');\n        await new Promise(resolve=>setTimeout(resolve,180));\n      }\n    }catch{}\n    finally{\n      lonatoCleanupRunning=false;\n      setTimeout(()=>refreshState().catch(()=>{}),1400);\n    }\n  }\n"""
if old not in s: raise SystemExit('helper anchor not found')
s=s.replace(old,new,1)

old="""          sharedState={\n            version:Number(res.state?.version||0),\n            plans:Array.isArray(res.state?.plans)?res.state.plans:[],\n            trips:Array.isArray(res.state?.trips)?res.state.trips:[]\n          };\n          renderBudgetPlans();\n          decorateCoreWizard();\n"""
new="""          const rawPlans=Array.isArray(res.state?.plans)?res.state.plans:[];\n          const rawTrips=Array.isArray(res.state?.trips)?res.state.trips:[];\n          const lonatoTrips=rawTrips.filter(isLonatoTrip);\n          sharedState={\n            version:Number(res.state?.version||0),\n            plans:rawPlans.filter(plan=>!isLonatoPlan(plan)),\n            trips:rawTrips.filter(trip=>!isLonatoTrip(trip))\n          };\n          renderBudgetPlans();\n          decorateCoreWizard();\n          if(lonatoTrips.length&&!lonatoCleanupRunning&&lonatoCleanupAttempts<3){\n            setTimeout(()=>cleanupLonatoTrips(lonatoTrips),60);\n          }\n"""
if old not in s: raise SystemExit('refresh state assignment not found')
s=s.replace(old,new,1)

p.write_text(s,encoding='utf-8')

ip=Path('index.html')
i=ip.read_text(encoding='utf-8')
if 'workflow.js?v=9' not in i: raise SystemExit('workflow cache marker not found')
i=i.replace('workflow.js?v=9','workflow.js?v=10',1)
ip.write_text(i,encoding='utf-8')
