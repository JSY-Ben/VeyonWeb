import test from 'node:test';
import assert from 'node:assert/strict';
import {SnapshotOverview,waitForFrame,captureDesktop} from '../public/snapshots.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function fakeClock(){
  let time=0,id=0;const timers=new Map();
  return {now:()=>time,schedule:(callback,delay)=>{timers.set(++id,{callback,at:time+delay});return id;},unschedule:id=>timers.delete(id),timers,
    async advance(ms){const end=time+ms;while(true){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;time=next[1].at;timers.delete(next[0]);next[1].callback();await tick();}time=end;await tick();}};
}

test('default browser timers retain their Window receiver across staggered starts',async()=>{
  const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout;
  const timers=[];let overview,time=0;
  globalThis.setTimeout=function(callback,delay){assert.equal(this,globalThis,'Safari requires a Window timer receiver');timers.push({callback,delay});return timers.length;};
  globalThis.clearTimeout=function(id){assert.equal(this,globalThis);timers[id-1].cancelled=true;};
  try{
    const captured=[];
    overview=new SnapshotOverview({now:()=>time,capture:async computer=>computer.id,onSnapshot:(computer,blob)=>captured.push(blob),onError:error=>{throw error;}});
    overview.start([{id:'first'},{id:'second'}]);await tick();assert.deepEqual(captured,['first']);
    assert.equal(timers.at(-1).delay,300);time=300;timers.at(-1).callback();await tick();assert.deepEqual(captured,['first','second']);
    overview.stop();assert.ok(timers.at(-1).cancelled);
  }finally{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});

test('pool starts 300ms apart, caps captures at three, and lets fast PCs pass a slow PC',async()=>{
  const clock=fakeClock(),pending=[],pictures=[],errors=[];let active=0,peak=0;
  const overview=new SnapshotOverview({...clock,
    capture:(computer,signal)=>new Promise((resolve,reject)=>{active++;peak=Math.max(peak,active);pending.push({computer,signal,resolve:value=>{active--;resolve(value);},reject:error=>{active--;reject(error);}});}),
    onSnapshot:(computer,blob)=>pictures.push([computer.id,blob]),onError:(computer,error)=>errors.push(computer.id),
  });
  overview.start(Array.from({length:6},(_,id)=>({id})));await tick();assert.equal(pending.length,1);
  await clock.advance(299);assert.equal(pending.length,1);await clock.advance(1);assert.equal(pending.length,2);
  await clock.advance(300);assert.equal(pending.length,3);assert.equal(active,3);
  pending[1].resolve('fast');await tick();await clock.advance(300);assert.equal(pending.length,4,'slow first PC does not block next capture');assert.equal(peak,3);
  pending[0].resolve('first');pending[2].reject(new Error('offline'));await tick();
  await clock.advance(300);assert.equal(pending.length,5);await clock.advance(300);assert.equal(pending.length,6);
  for(const job of pending.slice(3))job.resolve('picture');await tick();assert.equal(pictures.length,5);assert.deepEqual(errors,[2]);
  await clock.advance(29099);assert.equal(pending.length,6); // First success at 600ms, next due at 30600ms.
  await clock.advance(1);assert.equal(pending.length,7);assert.equal(pending[6].computer.id,1);
  overview.stop();assert.ok(pending[6].signal.aborted);assert.equal(clock.timers.size,0);
  pending[6].resolve('late');await tick();assert.equal(pictures.length,5,'cancelled captures cannot overwrite another classroom');
  overview.start([{id:'new'},{id:'queued'}]);await tick();overview.stop();
  pending.at(-1).resolve('cancelled');await clock.advance(1000);assert.equal(pending.length,8);
});

test('each PC has its own refresh deadline and failures retry only after 60 seconds',async()=>{
  const clock=fakeClock(),starts=[];
  const overview=new SnapshotOverview({...clock,capture:async computer=>{starts.push([computer.id,clock.now()]);if(computer.id==='offline')throw new Error('offline');return 'picture';},onSnapshot(){},onError(){}});
  overview.start([{id:'offline'},{id:'online'}]);await tick();await clock.advance(60300);
  assert.deepEqual(starts.filter(([id])=>id==='offline'),[['offline',0],['offline',60000]]);
  assert.deepEqual(starts.filter(([id])=>id==='online'),[['online',300],['online',30300],['online',60300]]);
  overview.stop();assert.equal(clock.timers.size,0);
});

test('visible cards get available slots first and hidden cards still load before refreshes',async()=>{
  const clock=fakeClock(),started=[];
  const overview=new SnapshotOverview({...clock,priority:computer=>computer.visible?0:1,capture:async computer=>{started.push(computer.id);return 'picture';},onSnapshot(){},onError(){}});
  overview.start([{id:'below-fold',visible:false},{id:'on-screen',visible:true}]);await tick();assert.deepEqual(started,['on-screen']);
  await clock.advance(300);assert.deepEqual(started,['on-screen','below-fold']);overview.stop();
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
