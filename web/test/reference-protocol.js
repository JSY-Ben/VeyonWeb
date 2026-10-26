// Veyon RFB security type 40 + Qt 5.5 QVariant wire format.
// Protocol references and provenance are listed in THIRD_PARTY.md.
import net from 'node:net';
import { constants, publicEncrypt, sign } from 'node:crypto';

export function u32(value) { const b = Buffer.alloc(4); b.writeUInt32BE(value); return b; }
export function variant(value) {
  if (typeof value === 'number') return Buffer.concat([u32(2), Buffer.from([0]), u32(value)]);
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf16le').swap16();
  return Buffer.concat([u32(Buffer.isBuffer(value) ? 12 : 10), Buffer.from([0]), u32(bytes.length), bytes]);
}
export function message(...values) { const data = Buffer.concat(values.map(variant)); return Buffer.concat([u32(data.length), data]); }
export function decodeVariants(data) {
  const result = []; let offset = 0;
  function need(n) { if (offset + n > data.length) throw new Error('Truncated Veyon authentication message.'); }
  function string(){need(4);const n=data.readUInt32BE(offset);offset+=4;need(n);const s=Buffer.from(data.subarray(offset,offset+n)).swap16().toString('utf16le');offset+=n;return s;}
  function value() {
    need(5); const type = data.readUInt32BE(offset); offset += 5;
    if(type===1){need(1);return data[offset++]!==0;}
    if(type===30){need(16);const h=data.subarray(offset,offset+16).toString('hex');offset+=16;return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
    if(type===8||type===11){need(4);const n=data.readUInt32BE(offset);offset+=4;const output=type===8?{}:[];for(let i=0;i<n;i++){if(type===8){const key=string();output[key]=value();}else output.push(string());}return output;}
    if (type === 2) { need(4); const number=data.readInt32BE(offset); offset += 4; return number; }
    else if (type === 10 || type === 12) {
      need(4); const length = data.readUInt32BE(offset); offset += 4;
      if (length === 0xffffffff) return type === 10 ? '' : Buffer.alloc(0);
      if (length > 65536 || (type === 10 && length % 2)) throw new Error('Invalid Veyon authentication field.');
      need(length); const bytes = Buffer.from(data.subarray(offset, offset + length)); offset += length;
      return type === 10 ? bytes.swap16().toString('utf16le') : bytes;
    } else throw new Error(`Unsupported authentication field type ${type}.`);
  }
  while (offset < data.length) result.push(value());
  return result;
}
export function decodeFeatures(data){
  const frames=[];let offset=0;
  while(offset<data.length){assertFeature(data[offset++]===41,'Feature message type');const length=data.readUInt32BE(offset);offset+=4;const bytes=data.subarray(offset,offset+length);assertFeature(bytes.length===length,'Feature message length');frames.push(decodeVariants(bytes));offset+=length;}
  return frames;
}
function assertFeature(value,message){if(!value)throw new Error(message);}

export class SocketReader {
  constructor(socket) {
    this.socket = socket; this.buffer = Buffer.alloc(0); this.pending = null; this.error = null;
    this.onData = data => {
      this.buffer = Buffer.concat([this.buffer, data]);
      if (this.buffer.length > 1024 * 1024) { socket.destroy(new Error('Authentication message exceeds limit.')); return; }
      this.drain();
    };
    this.onError = error => { this.error = error; this.drain(); };
    this.onClose = () => this.onError(new Error('Veyon closed the connection. Check credentials and access-control rules.'));
    socket.on('data', this.onData); socket.on('error', this.onError); socket.on('close', this.onClose);
  }
  drain() {
    const p = this.pending; if (!p) return;
    if (this.buffer.length >= p.length) { const data = this.buffer.subarray(0, p.length); this.buffer = this.buffer.subarray(p.length); this.pending = null; p.resolve(data); }
    else if (this.error) { this.pending = null; p.reject(this.error); }
  }
  read(length) { if (this.pending) throw new Error('Concurrent socket read.'); return new Promise((resolve, reject) => { this.pending = { length, resolve, reject }; this.drain(); }); }
  async variants() { const length = (await this.read(4)).readUInt32BE(); if (length > 65536) throw new Error('Authentication message too large.'); return decodeVariants(await this.read(length)); }
  release() {
    this.socket.pause(); this.socket.off('data', this.onData); this.socket.off('error', this.onError); this.socket.off('close', this.onClose);
    const remaining = this.buffer; this.buffer = Buffer.alloc(0); return remaining;
  }
}

export async function authenticateVeyon(socket, credentials) {
  const reader = new SocketReader(socket);
  const version = await reader.read(12);
  if (!/^RFB 003\.00[78]\n$/.test(version.toString('ascii'))) throw new Error('Expected a Veyon RFB 3.7/3.8 server.');
  socket.write('RFB 003.008\n');
  const count = (await reader.read(1))[0];
  if (!count || !(await reader.read(count)).includes(40)) throw new Error('This endpoint does not offer Veyon authentication (type 40).');
  socket.write(Buffer.from([40]));
  const methods = await reader.variants();
  if (!Number.isInteger(methods[0]) || methods[0] < 1 || methods[0] > 32 || methods.length !== methods[0] + 1) throw new Error('Invalid Veyon authentication methods.');
  const type = credentials.method === 'key' ? 3 : 4;
  if (!methods.slice(1).includes(type)) throw new Error(`Veyon does not accept ${credentials.method} authentication. Check the gateway configuration.`);
  socket.write(message(type, credentials.username || 'teacher'));
  const ack = await reader.variants(); if (ack.length) throw new Error('Unexpected Veyon authentication acknowledgement.');
  const [challenge] = await reader.variants();
  if (type === 3) {
    if (!Buffer.isBuffer(challenge) || challenge.length !== 128) throw new Error('Invalid Veyon key challenge.');
    const signature = sign('sha512', challenge, { key: credentials.privateKey, padding: constants.RSA_PKCS1_PADDING });
    socket.write(message(credentials.keyName, signature));
  } else {
    if (typeof challenge !== 'string' || !challenge.includes('PUBLIC KEY')) throw new Error('Invalid Veyon public key.');
    const encrypted = publicEncrypt({ key: challenge, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, Buffer.from(credentials.password));
    socket.write(message(encrypted));
  }
  if ((await reader.read(4)).readUInt32BE() !== 0) throw new Error('Veyon authentication failed.');
  // ClientInit is forwarded from the browser only after gateway authentication.
  return reader;
}

export async function connectVeyon(computer, credentials) {
  const socket = net.createConnection({ host: computer.host, port: computer.port });
  socket.setNoDelay(true);
  const timeout = setTimeout(() => socket.destroy(new Error('Veyon connection timed out.')), 15000);
  socket.once('error', () => {});
  try {
    const reader = await authenticateVeyon(socket, credentials);
    clearTimeout(timeout); return { socket, reader };
  } catch (error) { clearTimeout(timeout); socket.destroy(); throw error; }
}

// Enforce read-only sessions at the gateway, even if a modified browser sends input.
export class ClientFilter {
  constructor(viewOnly) { this.viewOnly = viewOnly; this.buffer = Buffer.alloc(0); }
  push(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    if (this.buffer.length > 1024 * 1024) throw new Error('Client message too large.');
    const output = [];
    while (this.buffer.length) {
      const b = this.buffer, type = b[0]; let length; let input = false;
      switch (type) {
        case 0: length = 20; break;
        case 2: if (b.length < 4) return output; length = 4 + b.readUInt16BE(2) * 4; break;
        case 3: length = 10; break;
        case 4: length = 8; input = true; break;
        case 5: length = 6; input = true; break;
        case 6: if (b.length < 8) return output; length = 8 + Math.abs(b.readInt32BE(4)); input = true; break;
        case 150: length = 10; break;
        case 248: if (b.length < 9) return output; length = 9 + b[8]; break;
        case 251: if (b.length < 8) return output; length = 8 + b[6] * 16; break;
        case 255: if (b.length < 2) return output; if (b[1] !== 0) throw new Error('Unsupported QEMU input.'); length = 12; input = true; break;
        default: throw new Error(`Unsupported RFB client message ${type}.`);
      }
      if (length > 1024 * 1024) throw new Error('Client message exceeds limit.');
      if (b.length < length) break;
      if (!(this.viewOnly && input)) output.push(b.subarray(0, length));
      this.buffer = b.subarray(length);
    }
    return output;
  }
}
