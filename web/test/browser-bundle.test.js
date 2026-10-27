import test from 'node:test';
import assert from 'node:assert/strict';
import {userInfoFrame} from './reference-protocol.js';

test('browser bundle loads without CommonJS globals', async () => {
  const element=()=>({style:{},offsetWidth:100,appendChild(child){child.parentNode=this;},removeChild(){},getContext(){return {};}});
  const previous={window:globalThis.window,document:globalThis.document,MutationObserver:globalThis.MutationObserver};
  globalThis.window={console,addEventListener(){},removeEventListener(){},devicePixelRatio:1};
  globalThis.document={documentElement:{},body:element(),createElement:element};
  globalThis.MutationObserver=class {observe(){} disconnect(){}};
  try {
    const {default:RFB}=await import('../public/veyon-rfb.js');
    assert.equal(typeof RFB,'function');
    // Exercise noVNC's actual framebuffer parser: Veyon may send a metadata
    // update before the rectangle containing the desktop pixels.
    const rawModule=await import('@novnc/novnc/lib/decoders/raw.js');
    const RawDecoder=rawModule.default.default;
    const snapshot=Object.create(RFB.prototype);let queue=Buffer.alloc(0),offset=0,notified=false,flushed=false,pixels;
    snapshot._FBU={rects:0,encoding:null};snapshot._fbDepth=24;snapshot._decoders={0:new RawDecoder()};
    snapshot._sock={rQwait:(_name,n,back=0)=>{if(queue.length-offset<n){offset-=back;return true;}return false;},
      rQskipBytes:n=>{offset+=n;},rQshift16:()=>{const value=queue.readUInt16BE(offset);offset+=2;return value;},
      rQshift32:()=>{const value=queue.readUInt32BE(offset);offset+=4;return value;},
      rQshiftBytes:n=>{const value=queue.subarray(offset,offset+n);offset+=n;return value;}};
    snapshot._display={pending:()=>false,flip(){},flush:async()=>{flushed=true;},blitImage:(_x,_y,_w,_h,data)=>{pixels=Array.from(data);}};
    snapshot._fail=message=>{throw new Error(message);};
    snapshot.dispatchEvent=event=>{assert.equal(event.type,'framebufferupdate');assert.ok(flushed);notified=true;};
    function framebuffer(encoding,body=Buffer.alloc(0),width=0,height=0){const header=Buffer.alloc(15);header.writeUInt16BE(1,1);header.writeUInt16BE(width,7);header.writeUInt16BE(height,9);header.writeInt32BE(encoding,11);return Buffer.concat([header,body]);}
    queue=framebuffer(-224); // LastRect pseudo-encoding; no desktop image.
    assert.equal(snapshot._framebufferUpdate(),true);await Promise.resolve();
    assert.equal(snapshot.hasFrame,undefined,'metadata alone cannot complete a screenshot');assert.equal(notified,false);assert.equal(flushed,false);
    queue=framebuffer(0,Buffer.from([255,0,0,0]),1,1);offset=0;
    assert.equal(snapshot._framebufferUpdate(),true);assert.equal(notified,false,'wait for decoded pixels to flush');
    await Promise.resolve();assert.equal(snapshot.hasFrame,true);assert.ok(notified);assert.deepEqual(pixels,[255,0,0,255]);
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
    const userFrame=userInfoFrame('school\\student','Élodie Student');
    for(let split=1;split<userFrame.length;split++){
      let bytes=userFrame.subarray(0,split),info;
      const client=Object.create(RFB.prototype);client._FBU={rects:0};
      client._sock={rQwait:(_label,n)=>bytes.length<n,rQpeek8:()=>bytes[0],rQpeekBytes:n=>bytes.subarray(0,n),rQskipBytes:n=>{bytes=bytes.subarray(n);}};
      client.dispatchEvent=event=>{info=event.detail;};
      assert.equal(client._normalMsg(),false);assert.equal(bytes.length,split);
      bytes=Buffer.concat([bytes,userFrame.subarray(split)]);assert.equal(client._normalMsg(),true);
      assert.deepEqual(info,{login:'school\\student',fullName:'Élodie Student'});assert.equal(bytes.length,0);
    }
    await new Promise(resolve=>setImmediate(resolve));
  } finally {
    for(const [key,value] of Object.entries(previous)) {
      if(value===undefined)delete globalThis[key];else globalThis[key]=value;
    }
  }
});
