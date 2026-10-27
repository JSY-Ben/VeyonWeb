import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeUserInfo,userInfoRequest,userInfoLabel} from '../public/user-info.js';
import {userInfoFrame,decodeFeatures} from './reference-protocol.js';

test('user queries use Veyon MonitoringMode and decode full names, usernames and signed-out sessions',()=>{
  assert.deepEqual(decodeFeatures(Buffer.from(userInfoRequest)),[['79a5e74d-50bd-4aab-8012-0e70dc08cc72',0,{}]]);
  for(const [login,fullName,expected] of [
    ['SCHOOL\\student1','Élodie Student','Élodie Student (SCHOOL\\student1)'],
    ['student1','','student1'],['','Student One','Student One'],['','','No user signed in'],
  ]){
    const info=decodeUserInfo(userInfoFrame(login,fullName).subarray(5));
    assert.deepEqual(info,{login,fullName});assert.equal(userInfoLabel(info),expected);
  }
  assert.equal(userInfoLabel(undefined),'User unavailable');
  const payload=userInfoFrame('student','Student').subarray(5);
  for(let size=0;size<payload.length;size++)assert.throws(()=>decodeUserInfo(payload.subarray(0,size)));
  const unrelated=Buffer.from(payload);unrelated[5]^=1;assert.equal(decodeUserInfo(unrelated),null);
});
