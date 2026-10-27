export function waitForFrame(rfb, {signal, timeout = 10000} = {}) {
  if (signal?.aborted) return Promise.reject(new DOMException('Snapshot cancelled.', 'AbortError'));
  if (rfb.hasFrame) return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const finish=error=>{
      clearTimeout(timer);rfb.removeEventListener('framebufferupdate',ready);rfb.removeEventListener('disconnect',closed);signal?.removeEventListener('abort',cancel);
      error?reject(error):resolve();
    };
    const ready=()=>finish(),closed=()=>{
      const error=new Error(rfb.gatewayError||'Disconnected before a screen was received.');
      if(/timed out/i.test(error.message))error.code='PREVIEW_TIMEOUT';
      finish(error);
    };
    const cancel=()=>finish(new DOMException('Snapshot cancelled.','AbortError'));
    const timer=timeout===null?undefined:setTimeout(()=>finish(new Error('Timed out waiting for a screen.')),timeout);
    rfb.addEventListener('framebufferupdate',ready);rfb.addEventListener('disconnect',closed);signal?.addEventListener('abort',cancel,{once:true});
    if(rfb.hasFrame)ready();
  });
}

export async function captureDesktop(computer, makeRFB, {signal, timeout=10000} = {}) {
  if(signal?.aborted)throw new DOMException('Snapshot cancelled.','AbortError');
  const staging=document.createElement('div');staging.className='screenshot-staging';document.body.append(staging);
  const controller=new AbortController();let rfb,disconnected=false,timedOut=false;
  const cleanup=()=>{if(rfb&&!disconnected){disconnected=true;rfb.disconnect();}staging.remove();};
  const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
  let onAbort,timer,phase='connection';
  const startDeadline=()=>{clearTimeout(timer);timer=setTimeout(()=>{timedOut=true;controller.abort();},timeout);};
  const connected=()=>{phase='screen';startDeadline();};
  const cancelled=new Promise((resolve,reject)=>{
    onAbort=()=>{
      const error=timedOut?new Error(phase==='screen'?`Timed out waiting for the first picture after ${timeout/1000} seconds.`:`Connection timed out after ${timeout/1000} seconds.`):new DOMException('Snapshot cancelled.','AbortError');
      if(timedOut)error.code='PREVIEW_TIMEOUT';reject(error);cleanup();
    };
    controller.signal.addEventListener('abort',onAbort,{once:true});
  });
  startDeadline();
  const capture=async()=>{
    try{
      rfb=await makeRFB(computer,staging,'view',{signal:controller.signal});
      controller.signal.throwIfAborted();
      if(rfb._rfbConnectionState==='connected')connected();
      else rfb.addEventListener?.('connect',connected,{once:true});
      // The connection and first-picture phases each get the configured budget.
      await waitForFrame(rfb,{signal:controller.signal,timeout:null});
      const blob=await new Promise((resolve,reject)=>rfb.toBlob(image=>image?resolve(image):reject(new Error('Snapshot unavailable.')),'image/png'));
      clearTimeout(timer);
      await rfb.waitForUserInfo?.();
      controller.signal.throwIfAborted();return blob;
    }finally{cleanup();}
  };
  try{return await Promise.race([capture(),cancelled]);}
  finally{clearTimeout(timer);rfb?.removeEventListener?.('connect',connected);signal?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',onAbort);}
}

// A bounded pool with spaced starts and independent deadlines for each PC.
export class SnapshotOverview {
  constructor({capture,onSnapshot,onError,interval=30000,retry=60000,concurrency=3,stagger=300,initialRetry=2000,priority=()=>0,schedule=(callback,delay)=>globalThis.setTimeout(callback,delay),unschedule=timer=>globalThis.clearTimeout(timer),now=Date.now}) {
    Object.assign(this,{capture,onSnapshot,onError,interval,retry,concurrency,stagger,initialRetry,priority,schedule,unschedule,now});
  }
  start(computers){
    this.stop();
    const seen=new Set();
    this.session={controller:new AbortController(),active:0,nextStart:this.now(),timer:undefined,
      entries:computers.filter(computer=>{if(seen.has(computer.id))return false;seen.add(computer.id);return true;}).map(computer=>({computer,due:this.now(),active:false,attempted:false,hasPicture:false}))};
    this.pump(this.session);
  }
  stop(){
    const session=this.session;if(!session)return;
    session.controller.abort();if(session.timer!==undefined)this.unschedule(session.timer);this.session=null;
  }
  pump(session){
    if(session.controller.signal.aborted)return;
    if(session.timer!==undefined){this.unschedule(session.timer);session.timer=undefined;}
    while(session.active<this.concurrency){
      let next,earliest;const time=this.now();
      for(const entry of session.entries){
        if(entry.active)continue;
        if(!earliest||entry.due<earliest.due)earliest=entry;
        if(entry.due<=time&&(!next||this.priority(entry.computer)<this.priority(next.computer)||(this.priority(entry.computer)===this.priority(next.computer)&&entry.due<next.due)))next=entry;
      }
      next??=earliest;
      if(!next)return;
      const delay=Math.max(next.due,session.nextStart)-this.now();
      if(delay>0){session.timer=this.schedule(()=>{session.timer=undefined;this.pump(session);},delay);return;}
      next.active=true;session.active++;session.nextStart=this.now()+this.stagger;
      this.run(next,session);
    }
  }
  async run(entry,session){
    const signal=session.controller.signal;
    try{
      // Defer invocation so even a synchronous capture failure cannot recurse
      // into the scheduler while it is filling the pool.
      const blob=await Promise.resolve().then(()=>signal.aborted?undefined:this.capture(entry.computer,signal));
      if(!signal.aborted){await this.onSnapshot(entry.computer,blob,signal);entry.hasPicture=true;entry.due=this.now()+this.interval;}
    }catch(error){
      if(!signal.aborted){
        const initialTimeout=!entry.attempted&&!entry.hasPicture&&error.code==='PREVIEW_TIMEOUT';
        entry.due=this.now()+(initialTimeout?this.initialRetry:this.retry);
        try{this.onError(entry.computer,error);}catch(reportError){console.error('Could not update preview status.',reportError);}
      }
    }finally{entry.attempted=true;entry.active=false;session.active--;if(!signal.aborted)this.pump(session);}
  }
}
