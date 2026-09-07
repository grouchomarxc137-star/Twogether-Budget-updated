(() => {
'use strict';

if(window.__twV22MutationObserverPatched)return;
window.__twV22MutationObserverPatched=true;
const Native=window.MutationObserver;
if(!Native)return;

class TwogetherMutationObserver extends Native{
  constructor(callback){
    const src=Function.prototype.toString.call(callback);
    const isDividerObserver=src.includes('scheduleDividers')&&src.includes('dev22-selection');
    if(!isDividerObserver){super(callback);return;}
    super((records,observer)=>{
      const kept=records.filter(r=>{
        const t=r.target;
        if(!(t instanceof Element))return false;
        return t.matches?.('.dev22-selection')||!!t.closest?.('.dev22-inspector');
      });
      if(kept.length)callback(kept,observer);
    });
  }
}

window.MutationObserver=TwogetherMutationObserver;
})();
