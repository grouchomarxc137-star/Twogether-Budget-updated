import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const navigation=readFileSync(new URL('../../src/app/navigation.js',import.meta.url),'utf8');
const checklist=readFileSync(new URL('../../src/trips/current-trips.js',import.meta.url),'utf8');

function globalEdgeSwipe(mode,{recurrent=false,hasBack=false}={}) {
  const start=navigation.indexOf('function installSurfaceNavigation() {');
  const end=navigation.indexOf('let edgeSubnavInstalled = false;',start);
  assert.ok(start>=0&&end>start,'Global surface navigation code missing');
  const code=navigation.slice(start,end);
  const listeners={},calls=[];
  const surface={
    _twogetherBack:hasBack?()=>calls.push('return-to-checklist'):undefined,
    matches:selector=>selector==='.tv2-layer',
    querySelector:selector=>selector==='.tv2-recurrent-sheet'&&recurrent?{}:null,
    isConnected:true
  };
  const document={addEventListener:(name,fn)=>{listeners[name]=fn;}};
  const innerWidth=390,innerHeight=800;
  // Other feature navigation methods are unchanged; simulate the actual
  // document-capture mobile edge swipe from touchstart through touchend.
  new Function('document','window','topSurface','surfaceUsesNativeSwipe',
    'surfaceCard','surfaceBlocksGlobalDown','createSurfaceVisual',
    'paintSurfaceSwipe','resetSurfaceVisual','finishSurfaceVisual',
    'goSurfaceBack','goSurfaceHome','isMobile',
    'surfaceHomeBusy','surfaceActionDispatching','Element',
    `let surfaceNavigationInstalled=false;
    let surfaceSwipe={tracking:false,active:false,mode:'',startX:0,startY:0,lastX:0,lastY:0,surface:null,visual:null};
    ${code}
    installSurfaceNavigation();`
  )(document,{innerWidth,innerHeight},()=>surface,()=>false,()=>({scrollTop:0}),
    ()=>recurrent,()=>({target:{isConnected:true}}),()=>calls.push('paint'),
    ()=>calls.push('reset'),(_visual,_mode,complete)=>{calls.push('animate');complete();},
    target=>{calls.push('back');target._twogetherBack?.();},
    ()=>calls.push('main'),()=>true,false,false,class {});
  const touch=(x,y)=>({touches:[{clientX:x,clientY:y}],
    preventDefault(){calls.push('prevent')},
    stopImmediatePropagation(){calls.push('stop')}});
  assert.ok(listeners.touchstart&&listeners.touchmove&&listeners.touchend);
  listeners.touchstart(touch(20,20));
  listeners.touchmove(touch(mode==='right'?175:20,mode==='down'?200:20));
  listeners.touchend(touch(mode==='right'?175:20,mode==='down'?200:20));
  return calls;
}

test('right-edge swipe from Recurrent Items returns to parent checklist',()=>{
  assert.match(checklist,/layer\._twogetherBack=returnToChecklist;/);
  assert.match(checklist,/layer\.__tv2SwipeBack=returnToChecklist;/);
  const calls=globalEdgeSwipe('right',{recurrent:true,hasBack:true});
  assert.ok(calls.includes('back'));
  assert.ok(calls.includes('return-to-checklist'));
  assert.equal(calls.includes('main'),false);
});

test('right-edge swipe from ordinary checklist still returns to main Trips page',()=>{
  const calls=globalEdgeSwipe('right',{recurrent:false});
  assert.ok(calls.includes('main'));
  assert.equal(calls.includes('back'),false);
});

test('unrelated surfaces with a back action keep their existing swipe behavior',()=>{
  const calls=globalEdgeSwipe('right',{recurrent:false,hasBack:true});
  assert.ok(calls.includes('main'));
  assert.equal(calls.includes('back'),false);
});

test('Recurrent Items local swipe-down and back button still return to checklist',()=>{
  assert.match(checklist,/layer\.__tv2SwipeBack=returnToChecklist;/);
  assert.match(checklist,/if\(typeof layer\.__tv2SwipeBack==='function'\)layer\.__tv2SwipeBack\(\);/);
  assert.match(checklist,/if\(b\.hasAttribute\('data-check-back'\)\)\{returnToChecklist\(\);return;\}/);
});
