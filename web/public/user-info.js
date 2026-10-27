// Veyon MonitoringMode UserInfo: arguments 0 (login name) and 1 (full name).
// https://github.com/veyon/veyon/blob/master/core/src/MonitoringMode.cpp
const userInfoId='79a5e74d50bd4aab80120e70dc08cc72';
export const userInfoRequest=Uint8Array.from(('29000000270000001e00'+userInfoId+'000000020000000000000000080000000000').match(/../g),byte=>parseInt(byte,16));

export function decodeUserInfo(bytes){
  let offset=0;
  const take=size=>{if(size<0||offset+size>bytes.length)throw new Error('Truncated user information');const value=bytes.subarray(offset,offset+size);offset+=size;return value;};
  const uint=()=>{const value=take(4);return new DataView(value.buffer,value.byteOffset,4).getUint32(0);};
  const string=()=>{const length=uint();if(length===0xffffffff)return '';if(length>65536||length%2)throw new Error('Invalid user information');return new TextDecoder('utf-16be',{fatal:true}).decode(take(length));};
  if(uint()!==30)return null;take(1);
  if(Array.from(take(16),byte=>byte.toString(16).padStart(2,'0')).join('')!==userInfoId)return null;
  if(uint()!==2)return null;take(1);if(uint()!==0)return null;
  if(uint()!==8)return null;take(1);const count=uint();if(count>64)return null;
  const args=new Map();
  for(let i=0;i<count;i++){const key=string();if(uint()!==10)return null;take(1);args.set(key,string());}
  if(offset!==bytes.length||!args.has('0')||!args.has('1'))return null;
  return {login:args.get('0').trim(),fullName:args.get('1').trim()};
}

export function userInfoLabel(info){
  if(!info)return 'User unavailable';
  if(!info.login&&!info.fullName)return 'No user signed in';
  return info.fullName&&info.login&&info.fullName!==info.login?`${info.fullName} (${info.login})`:info.fullName||info.login;
}
