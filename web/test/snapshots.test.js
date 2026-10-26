import test from 'node:test';
import assert from 'node:assert/strict';
import {SnapshotOverview,waitForFrame,captureDesktop} from '../public/snapshots.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('snapshots are sequential, staggered after failures, and cancelled on navigation',async()=>{
  const pending=[],pictures=[],errors=[],timers=[];let active=0,peak=0,time=0;
  const overview=new SnapshotOverview({interval:10000,stagger:750,now:()=>time,
    schedule:(callback,delay)=>{timers.push({callback,delay});return timers.length;},unschedule:id=>{timers[id-1].cancelled=true;},
    capture:(computer,signal)=>new Promise((resolve,reject)=>{active++;peak=Math.max(peak,active);pending.push({computer,signal,resolve:value=>{active--;resolve(value);},reject:error=>{active--;reject(error);}});}),
    onSnapshot:(computer,blob)=>pictures.push([computer.id,blob]),onError:(computer,error)=>errors.push(computer.id),
  });
  overview.start([{id:0},{id:1},{id:2}]);
  assert.equal(pending.length,1);assert.equal(timers.length,0);
  pending[0].resolve('picture-0');await tick();assert.equal(pending.length,1);assert.equal(timers[0].delay,750);
  timers[0].callback();await tick();assert.equal(pending.length,2);
  pending[1].reject(new Error('offline'));await tick();assert.equal(pending.length,2);assert.equal(timers[1].delay,750);
  timers[1].callback();await tick();assert.equal(pending.length,3);
  time=15000;pending[2].resolve('picture-2');await tick();
  assert.equal(peak,1);assert.equal(pictures.length,2);assert.deepEqual(errors,[1]);
  assert.equal(timers[2].delay,750,'slow rounds retain a pause before starting again');
  timers[2].callback();assert.equal(pending.length,4);
  overview.stop();assert.ok(pending[3].signal.aborted);
  pending[3].resolve('late');await tick();assert.equal(pictures.length,2);assert.equal(timers.length,3);
  overview.start([{id:4},{id:5}]);pending[4].resolve('new');await tick();
  const gap=timers[3];overview.stop();assert.ok(gap.cancelled);await tick();assert.equal(pending.length,5,'stopping during a gap prevents the next capture');
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

test('connection timeout includes ticket acquisition and closes a late connection',async()=>{
  const original=globalThis.document;let disconnected=0,release,requestSignal;
  globalThis.document={createElement:()=>({remove(){}}),body:{append(){}}};
  try{
    const capture=captureDesktop({id:'slow'},async(_computer,_target,_mode,{signal})=>{requestSignal=signal;return new Promise(resolve=>{release=resolve;});},{timeout:10});
    await assert.rejects(capture,/Connection timed out/);assert.ok(requestSignal.aborted);
    release({hasFrame:true,disconnect(){disconnected++;}});await tick();assert.equal(disconnected,1);
    const rfb=new EventTarget();rfb.disconnect=()=>{disconnected++;};
    await assert.rejects(captureDesktop({id:'slow-frame'},async()=>rfb,{timeout:10}),/Connection timed out/);
    assert.equal(disconnected,2,'waiting for a first frame also has a bounded connection deadline');
  }finally{if(original===undefined)delete globalThis.document;else globalThis.document=original;}
});
