export function waitForFrame(rfb, {signal, timeout = 20000} = {}) {
  if (signal?.aborted) return Promise.reject(new DOMException('Snapshot cancelled.', 'AbortError'));
  if (rfb.hasFrame) return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const finish=error=>{
      clearTimeout(timer);rfb.removeEventListener('framebufferupdate',ready);rfb.removeEventListener('disconnect',closed);signal?.removeEventListener('abort',cancel);
      error?reject(error):resolve();
    };
    const ready=()=>finish(),closed=()=>finish(new Error(rfb.gatewayError||'Disconnected before a screen was received.'));
    const cancel=()=>finish(new DOMException('Snapshot cancelled.','AbortError'));
    const timer=setTimeout(()=>finish(new Error('Timed out waiting for a screen.')),timeout);
    rfb.addEventListener('framebufferupdate',ready);rfb.addEventListener('disconnect',closed);signal?.addEventListener('abort',cancel,{once:true});
    if(rfb.hasFrame)ready();
  });
}

export async function captureDesktop(computer, makeRFB, {signal} = {}) {
  if(signal?.aborted)throw new DOMException('Snapshot cancelled.','AbortError');
  const staging=document.createElement('div');staging.className='screenshot-staging';document.body.append(staging);
  let rfb;
  const cancel=()=>{rfb?.disconnect();staging.remove();};
  signal?.addEventListener('abort',cancel,{once:true});
  try{
    rfb=await makeRFB(computer,staging,'view');
    await waitForFrame(rfb,{signal});
    const blob=await new Promise((resolve,reject)=>rfb.toBlob(image=>image?resolve(image):reject(new Error('Snapshot unavailable.')),'image/png'));
    if(signal?.aborted)throw new DOMException('Snapshot cancelled.','AbortError');
    return blob;
  } finally {signal?.removeEventListener('abort',cancel);rfb?.disconnect();staging.remove();}
}

// Capture one computer at a time, with breathing room between connections.
export class SnapshotOverview {
  constructor({capture,onSnapshot,onError,interval=10000,stagger=750,schedule=setTimeout,unschedule=clearTimeout,now=Date.now}) {
    Object.assign(this,{capture,onSnapshot,onError,interval,stagger,schedule,unschedule,now});
  }
  start(computers){this.stop();this.controller=new AbortController();this.round(computers,this.controller.signal);}
  stop(){this.controller?.abort();if(this.timer!==undefined)this.unschedule(this.timer);this.timer=undefined;}
  pause(signal){
    if(signal.aborted)return Promise.resolve();
    return new Promise(resolve=>{
      const finish=()=>{this.unschedule(timer);signal.removeEventListener('abort',finish);resolve();};
      const timer=this.schedule(finish,this.stagger);signal.addEventListener('abort',finish,{once:true});
    });
  }
  async round(computers,signal){
    const started=this.now();
    for(let i=0;i<computers.length&&!signal.aborted;i++){
      if(i>0)await this.pause(signal);
      if(signal.aborted)break;
      const computer=computers[i];
      try{const blob=await this.capture(computer,signal);if(!signal.aborted)this.onSnapshot(computer,blob);}
      catch(error){if(!signal.aborted)this.onError(computer,error);}
    }
    if(!signal.aborted&&computers.length)this.timer=this.schedule(()=>this.round(computers,signal),Math.max(this.stagger,this.interval-(this.now()-started)));
  }
}
