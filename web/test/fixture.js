import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { generateKeyPairSync, randomBytes, verify, privateDecrypt, constants } from 'node:crypto';
import { SocketReader, message } from './reference-protocol.js';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const privateKey = keys.privateKey.export({ type:'pkcs8', format:'pem' });
export const credentials = { method:'key', username:'teacher', keyName:'teacher', privateKey };

export async function fakeVeyon({ method='key', fragment=false, onInput=()=>{} }={}) {
  const errors=[], sockets=new Set();
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    const send = async data => {
      if(fragment){for(let i=0;i<data.length;i+=3){socket.write(data.subarray(i,i+3));await new Promise(resolve=>setImmediate(resolve));}}
      else socket.write(data);
    };
    (async()=>{
      const reader=new SocketReader(socket);
      await send(Buffer.from('RFB 003.008\n'));
      assert.equal((await reader.read(12)).toString(),'RFB 003.008\n');
      await send(Buffer.from([1,40]));assert.equal((await reader.read(1))[0],40);
      await send(message(1,method==='key'?3:4));
      assert.deepEqual(await reader.variants(),[method==='key'?3:4,'teacher']);
      const challenge=randomBytes(128);
      const publicPEM=keys.publicKey.export({type:'spki',format:'pem'});
      await send(Buffer.concat([message(),message(method==='key'?challenge:publicPEM)]));
      const response=await reader.variants();
      if(method==='key'){assert.equal(response[0],'teacher');assert.ok(verify('sha512',challenge,keys.publicKey,response[1]));}
      else assert.equal(privateDecrypt({key:keys.privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha1'},response[0]).toString(),'secret-password');
      await send(Buffer.alloc(4));
      assert.equal((await reader.read(1))[0],1);
      const init=Buffer.alloc(24);init.writeUInt16BE(2,0);init.writeUInt16BE(2,2);init[4]=32;init[5]=24;init[7]=1;init.writeUInt16BE(255,8);init.writeUInt16BE(255,10);init.writeUInt16BE(255,12);init[14]=16;init[15]=8;init[16]=0;
      await send(init);
      const extra=reader.release();if(extra.length)onInput(extra);
      socket.on('data',onInput);socket.resume();
    })().catch(error=>{if(!socket.destroyed)errors.push(error);socket.destroy();});
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  return{port:server.address().port,errors,sendFrame:data=>{for(const socket of sockets)socket.write(data);},close:async()=>{for(const socket of sockets)socket.destroy();server.close();await once(server,'close');}};
}
