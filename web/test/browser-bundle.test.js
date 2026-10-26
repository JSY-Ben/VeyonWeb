import test from 'node:test';
import assert from 'node:assert/strict';

test('browser bundle loads without CommonJS globals', async () => {
  const element=()=>({style:{},offsetWidth:100,appendChild(child){child.parentNode=this;},removeChild(){},getContext(){return {};}});
  const previous={window:globalThis.window,document:globalThis.document,MutationObserver:globalThis.MutationObserver};
  globalThis.window={console,addEventListener(){},removeEventListener(){},devicePixelRatio:1};
  globalThis.document={documentElement:{},body:element(),createElement:element};
  globalThis.MutationObserver=class {observe(){} disconnect(){}};
  try {
    const {default:RFB}=await import('../public/rfb.js');
    assert.equal(typeof RFB,'function');
    await new Promise(resolve=>setImmediate(resolve));
  } finally {
    for(const [key,value] of Object.entries(previous)) {
      if(value===undefined)delete globalThis[key];else globalThis[key]=value;
    }
  }
});
