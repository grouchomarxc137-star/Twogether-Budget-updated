(() => {
'use strict';

if(window.__twV22MutationObserverPatched)return;
window.__twV22MutationObserverPatched=true;
const Native=window.MutationObserver;
if(!Native)return;

class TwogetherMutationObserver extends Native{
  constructor(callback){
    const filterNext=!!window.__twV22FilterNextObserver;
    if(filterNext)window.__twV22FilterNextObserver=false;
    if(!filterNext){super(callback);return;}
    super((records,observer)=>{
      const kept=records.filter(r=>{
        const t=r.target;
        return !(t instanceof Element&&(t.matches?.('.dev22c-divider-layer')||t.closest?.('.dev22c-divider-layer')));
      });
      if(kept.length)callback(kept,observer);
    });
  }
}

window.MutationObserver=TwogetherMutationObserver;
})();
