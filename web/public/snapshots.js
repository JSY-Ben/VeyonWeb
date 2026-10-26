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

// One round at a time, with at most three short-lived desktop connections.
export class SnapshotOverview {
  constructor({capture,onSnapshot,onError,interval=10000,schedule=setTimeout,unschedule=clearTimeout,now=Date.now}) {
    Object.assign(this,{capture,onSnapshot,onError,interval,schedule,unschedule,now});
  }
  start(computers){this.stop();this.controller=new AbortController();this.round(computers,this.controller.signal);}
  stop(){this.controller?.abort();if(this.timer!==undefined)this.unschedule(this.timer);this.timer=undefined;}
  async round(computers,signal){
    const started=this.now();let next=0;
    const worker=async()=>{while(!signal.aborted&&next<computers.length){const computer=computers[next++];
      try{const blob=await this.capture(computer,signal);if(!signal.aborted)this.onSnapshot(computer,blob);}
      catch(error){if(!signal.aborted)this.onError(computer,error);}
    }};
    await Promise.all(Array.from({length:Math.min(3,computers.length)},worker));
    if(!signal.aborted&&computers.length)this.timer=this.schedule(()=>this.round(computers,signal),Math.max(0,this.interval-(this.now()-started)));
  }
}
