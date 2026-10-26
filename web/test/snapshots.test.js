import test from 'node:test';
import assert from 'node:assert/strict';
import {SnapshotOverview,waitForFrame,captureDesktop} from '../public/snapshots.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('snapshot rounds are bounded, scheduled without overlap, and cancelled on navigation',async()=>{
  const pending=[],pictures=[],errors=[],timers=[];let active=0,peak=0,time=0;
  const overview=new SnapshotOverview({interval:10000,now:()=>time,
    schedule:(callback,delay)=>{timers.push({callback,delay});return timers.length;},unschedule:id=>{timers[id-1].cancelled=true;},
    capture:(computer,signal)=>new Promise((resolve,reject)=>{active++;peak=Math.max(peak,active);pending.push({computer,signal,resolve:value=>{active--;resolve(value);},reject:error=>{active--;reject(error);}});}),
    onSnapshot:(computer,blob)=>pictures.push([computer.id,blob]),onError:(computer,error)=>errors.push(computer.id),
  });
  overview.start(Array.from({length:5},(_,i)=>({id:i})));
  assert.equal(pending.length,3);assert.equal(timers.length,0);
  pending[0].resolve('picture-0');await tick();assert.equal(pending.length,4);
  pending[1].reject(new Error('offline'));await tick();assert.equal(pending.length,5);
  pending[2].resolve('picture-2');pending[3].resolve('picture-3');time=1500;pending[4].resolve('picture-4');await tick();
  assert.equal(peak,3);assert.equal(pictures.length,4);assert.deepEqual(errors,[1]);
  assert.equal(timers.length,1);assert.equal(timers[0].delay,8500);
  timers[0].callback();assert.equal(pending.length,8);
  overview.stop();assert.ok(pending[5].signal.aborted);
  pending[5].resolve('late');pending[6].resolve('late');pending[7].resolve('late');await tick();
  assert.equal(pictures.length,4,'cancelled captures cannot replace current classroom images');assert.equal(timers.length,1);
});

test('frame waiting handles first frame, timeout, disconnect and cancellation',async()=>{
  const rfb=new EventTarget(),controller=new AbortController();
  const waiting=waitForFrame(rfb,{signal:controller.signal});rfb.dispatchEvent(new Event('framebufferupdate'));await waiting;
  await assert.rejects(waitForFrame(rfb,{timeout:1}),/Timed out/);
  const disconnected=waitForFrame(rfb);rfb.gatewayError='Access denied';rfb.dispatchEvent(new Event('disconnect'));await assert.rejects(disconnected,/Access denied/);
  const cancelled=waitForFrame(rfb,{signal:controller.signal});controller.abort();await assert.rejects(cancelled,{name:'AbortError'});
  rfb.hasFrame=true;await waitForFrame(rfb);
});

test('capturing one picture disconnects and removes the temporary desktop on success and error',async()=>{
  const original=globalThis.document;let removed=0,disconnected=0,appended=0;
  globalThis.document={createElement:()=>({remove(){removed++;}}),body:{append(){appended++;}}};
  try{
    const blob=new Blob(['picture']);
    const result=await captureDesktop({id:'pc'},async(_computer,_target,mode)=>{assert.equal(mode,'view');return {hasFrame:true,disconnect(){disconnected++;},toBlob(callback){callback(blob);}};});
    assert.equal(result,blob);assert.equal(disconnected,1);assert.equal(removed,1);
    await assert.rejects(captureDesktop({id:'pc'},async()=>{throw new Error('offline');}),/offline/);
    assert.equal(removed,2);assert.equal(appended,2);
    const controller=new AbortController();let release;
    const request=captureDesktop({id:'pc'},async()=>new Promise(resolve=>{release=resolve;}),{signal:controller.signal});
    controller.abort();release({hasFrame:true,disconnect(){disconnected++;}});
    await assert.rejects(request,{name:'AbortError'});assert.equal(disconnected,2);
  }finally{if(original===undefined)delete globalThis.document;else globalThis.document=original;}
});
