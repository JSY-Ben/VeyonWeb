import test from 'node:test';
import assert from 'node:assert/strict';

test('browser bundle loads without CommonJS globals', async () => {
  const element=()=>({style:{},offsetWidth:100,appendChild(child){child.parentNode=this;},removeChild(){},getContext(){return {};}});
  const previous={window:globalThis.window,document:globalThis.document,MutationObserver:globalThis.MutationObserver};
  globalThis.window={console,addEventListener(){},removeEventListener(){},devicePixelRatio:1};
  globalThis.document={documentElement:{},body:element(),createElement:element};
  globalThis.MutationObserver=class {observe(){} disconnect(){}};
  try {
    const {default:RFB}=await import('../public/veyon-rfb.js');
    assert.equal(typeof RFB,'function');
    // Simulate every split in a feature event followed by another server message.
    const feature=Buffer.from([41,0,0,0,4,0,41,255,1]);
    for(let split=1;split<feature.length;split++) {
      let queue=feature.subarray(0,split);
      const client=Object.create(RFB.prototype);
      client._FBU={rects:0};
      client._sock={rQwait:(_label,n)=>queue.length<n,rQpeek8:()=>queue[0],rQpeekBytes:n=>queue.subarray(0,n),rQskipBytes:n=>{queue=queue.subarray(n);}};
      client._fail=message=>{throw new Error(message);};
      assert.equal(client._normalMsg(),false);
      assert.equal(queue.length,split,'partial messages consume no bytes');
      queue=Buffer.concat([queue,feature.subarray(split),feature]);
      assert.equal(client._normalMsg(),true);
      assert.deepEqual(queue,feature,'following message preserved');
      assert.equal(client._normalMsg(),true);
      assert.equal(queue.length,0);
      queue=Buffer.from([41,0,16,0,1]);
      assert.throws(()=>client._normalMsg(),/size limit/);
      client._rfbConnectionState='disconnected';client.disconnect();
      // A pending framebuffer rectangle must use noVNC's decoder even if its
      // next byte happens to equal the feature message type.
      client._FBU.rects=1;client._framebufferUpdate=()=>false;
      assert.equal(client._normalMsg(),false);
      assert.equal(queue.length,5);
    }
    await new Promise(resolve=>setImmediate(resolve));
  } finally {
    for(const [key,value] of Object.entries(previous)) {
      if(value===undefined)delete globalThis[key];else globalThis[key]=value;
    }
  }
});
