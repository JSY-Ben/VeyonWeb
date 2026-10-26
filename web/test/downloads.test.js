import test from 'node:test';
import assert from 'node:assert/strict';
import {screenshotZip,safeName} from '../public/downloads.js';

test('screenshot ZIP preserves PNG bytes, offsets and checksums',async()=>{
  const files=[{name:'pc-one.png',blob:new Blob(['123456789'])},{name:'pc-two.png',blob:new Blob([new Uint8Array([0,41,255,3])])}];
  const zip=Buffer.from(await (await screenshotZip(files)).arrayBuffer());
  let offset=0;
  for(const [index,file] of files.entries()){
    assert.equal(zip.readUInt32LE(offset),0x04034b50);
    const nameLength=zip.readUInt16LE(offset+26),length=zip.readUInt32LE(offset+18);
    assert.equal(zip.subarray(offset+30,offset+30+nameLength).toString(),file.name);
    assert.deepEqual(zip.subarray(offset+30+nameLength,offset+30+nameLength+length),Buffer.from(await file.blob.arrayBuffer()));
    if(index===0)assert.equal(zip.readUInt32LE(offset+14),0xcbf43926); // Standard CRC32 reference vector.
    offset+=30+nameLength+length;
  }
  const centralOffset=offset;assert.equal(zip.readUInt32LE(offset),0x02014b50);
  assert.equal(zip.readUInt32LE(offset+42),0);
  const end=zip.length-22;assert.equal(zip.readUInt32LE(end),0x06054b50);assert.equal(zip.readUInt16LE(end+10),2);
  assert.equal(zip.readUInt32LE(end+16),centralOffset);
  assert.equal(safeName('../PC / 1'),'.._PC___1');
});
