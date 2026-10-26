import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {fakeVeyon,privateKey} from './fixture.js';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function port(){const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const value=socket.address().port;await new Promise(resolve=>socket.close(resolve));return value;}

test('users: migration, role boundaries, assigned classrooms, settings, and live-session revocation',{timeout:30000},async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'veyon-users-http-')),children=[],sockets=[];
  const target=await fakeVeyon(),httpPort=await port(),wsPort=await port(),origin=`http://127.0.0.1:${httpPort}`;
  const endpoint=route=>origin+'/api.php?route='+encodeURIComponent(route);let logs='';
  async function request(cookie,route,method='GET',body){return fetch(endpoint(route),{method,headers:{Origin:origin,Cookie:cookie||'','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});}
  async function json(cookie,route,method,body,status=200){const response=await request(cookie,route,method,body),text=await response.text();assert.equal(response.status,status,text);return JSON.parse(text);}
  async function login(username,password,status=200){const response=await request('','/api/login','POST',{username,password});assert.equal(response.status,status,await response.clone().text());return response.headers.get('set-cookie')?.split(';')[0]||'';}
  async function connect(cookie,ticket){const ws=new WebSocket(new URL(ticket.path,origin.replace('http','ws')),{headers:{Origin:origin,Cookie:cookie}});sockets.push(ws);ws.on('error',()=>{});const first=once(ws,'message');await once(ws,'open');assert.equal((await first)[0].toString(),'RFB 003.008\n');return ws;}
  try{
    const hash=spawnSync('php',['-r',"echo password_hash('original-admin-password', PASSWORD_DEFAULT);"],{encoding:'utf8'}).stdout;
    const keyPath=path.join(dir,'key.pem');await writeFile(keyPath,privateKey,{mode:0o600});
    const config={origin,teacher_username:'teacher',teacher_password_hash:hash,database:path.join(dir,'data.sqlite'),gateway_listen:`websocket://127.0.0.1:${wsPort}`,websocket_url:`ws://127.0.0.1:${wsPort}/remote`,veyon:{method:'key',username:'teacher',key_name:'teacher',private_key_file:keyPath}};
    const configPath=path.join(dir,'config.php');await writeFile(configPath,`<?php return json_decode(base64_decode('${Buffer.from(JSON.stringify(config)).toString('base64')}'),true);`);
    for(const args of [['-S',`127.0.0.1:${httpPort}`,'-t','public','router.php'],['gateway.php','start']]){
      const child=spawn('php',args,{env:{...process.env,CLASSROOM_CONFIG:configPath},stdio:['ignore','pipe','pipe']});children.push(child);child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);
    }
    let started=false;for(let i=0;i<80;i++){try{if((await request('','/api/session')).ok){started=true;break;}}catch{}await delay(50);}assert.ok(started,logs);await delay(100);
    await json('','/api/users','GET',undefined,401);
    const admin=await login('teacher','original-admin-password');
    const session=await json(admin,'/api/session');assert.equal(session.role,'admin');
    const before=await json(admin,'/api/users');assert.equal(before.users.length,1);assert.equal(before.users[0].role,'admin');assert.ok(!JSON.stringify(before).includes('password_hash'));
    const roster=[{id:'a',name:'PC A',host:'127.0.0.1',port:target.port,room:'Room A'},{id:'b',name:'PC B',host:'127.0.0.1',port:target.port,room:'Room B'}];
    await json(admin,'/api/computers','PUT',roster);
    const teacherId=(await json(admin,'/api/users','POST',{username:'restricted',password:'teacher-password',role:'teacher',classrooms:['Room A']})).id;
    const supervisorId=(await json(admin,'/api/users','POST',{username:'supervisor',password:'supervisor-password',role:'supervisor'})).id;
    await json(admin,'/api/users','POST',{username:'unassigned',password:'unassigned-password',role:'teacher',classrooms:[]});
    let teacher=await login('restricted','teacher-password');const supervisor=await login('supervisor','supervisor-password'),unassigned=await login('unassigned','unassigned-password');
    assert.deepEqual((await json(teacher,'/api/computers')).computers.map(c=>c.id),['a']);
    assert.deepEqual((await json(supervisor,'/api/computers')).computers.map(c=>c.id),['a','b']);
    assert.deepEqual((await json(unassigned,'/api/computers')).computers,[]);
    assert.equal((await json(supervisor,'/api/session')).role,'supervisor');assert.deepEqual((await json(teacher,'/api/session')).classrooms,['Room A']);
    for(const cookie of [teacher,supervisor,unassigned]){
      await json(cookie,'/api/computers','PUT',roster,403);
      await json(cookie,'/api/settings','GET',undefined,403);
      await json(cookie,'/api/settings','PUT',{overview_max_connections:10},403);
      await json(cookie,'/api/users','GET',undefined,403);
      await json(cookie,'/api/users','POST',{username:'attacker',password:'attacker-password',role:'admin'},403);
      await json(cookie,'/api/users','PUT',{id:teacherId,username:'restricted',role:'admin'},403);
      await json(cookie,'/api/users','DELETE',{id:session.userId},403);
      await json(cookie,'/api/actions','POST',{computerId:'a',action:'lock'},403);
      await json(cookie,'/api/files','POST',{},403);
    }
    await json(teacher,'/api/tickets','POST',{computerId:'b',mode:'control'},403);
    await json(unassigned,'/api/tickets','POST',{computerId:'a',mode:'view'},403);
    await json(supervisor,'/api/tickets','POST',{computerId:'b',mode:'control'});
    const ticket=await json(teacher,'/api/tickets','POST',{computerId:'a',mode:'control'}),pending=await json(teacher,'/api/tickets','POST',{computerId:'a',mode:'view'});
    const active=await connect(teacher,ticket),closed=once(active,'close');
    await json(admin,'/api/users','PUT',{id:teacherId,username:'restricted',role:'teacher',classrooms:['Room B']});
    assert.equal((await closed)[0],1011);await json(teacher,'/api/computers','GET',undefined,401);
    const revoked=new WebSocket(new URL(pending.path,origin.replace('http','ws')),{headers:{Origin:origin,Cookie:teacher}});sockets.push(revoked);revoked.on('error',()=>{});
    const rejected=await once(revoked,'unexpected-response');assert.equal(rejected[1].statusCode,403);rejected[1].resume();revoked.terminate();
    teacher=await login('restricted','teacher-password');assert.deepEqual((await json(teacher,'/api/computers')).computers.map(c=>c.id),['b']);
    await json(admin,'/api/users','PUT',{id:teacherId,username:'restricted',role:'teacher',enabled:false,classrooms:['Room B']});
    await json(teacher,'/api/session','GET');assert.equal((await json(teacher,'/api/session')).authenticated,false);await login('restricted','teacher-password',401);
    await json(admin,'/api/users','PUT',{id:teacherId,username:'restricted',role:'teacher',enabled:true,password:'changed-password',classrooms:['Room B']});
    await login('restricted','teacher-password',401);teacher=await login('restricted','changed-password');
    const teacherSocket=await connect(teacher,await json(teacher,'/api/tickets','POST',{computerId:'b',mode:'view'})),teacherClosed=once(teacherSocket,'close');
    await json(admin,'/api/users','DELETE',{id:teacherId});assert.equal((await teacherClosed)[0],1011);await json(teacher,'/api/computers','GET',undefined,401);
    await json(admin,'/api/users','DELETE',{id:session.userId},400);
    await json(admin,'/api/users','PUT',{id:session.userId,username:'teacher',role:'teacher'},400);
    await json(admin,'/api/users','PUT',{id:session.userId,username:'teacher',role:'admin',enabled:false},400);
    await json(admin,'/api/settings','PUT',{overview_refresh_seconds:45,overview_max_connections:2});
    assert.equal((await json(admin,'/api/computers')).overviewRefreshSeconds,45);assert.equal((await json(admin,'/api/settings')).settings.overview_max_connections,2);
    await json(admin,'/api/settings','PUT',{origin:'https://attacker.example'},400);
    await json(admin,'/api/users','PUT',{id:supervisorId,username:'supervisor',role:'admin'});
    await json(supervisor,'/api/users','GET',undefined,401);const promoted=await login('supervisor','supervisor-password');assert.equal((await json(promoted,'/api/session')).role,'admin');
    const demoted=await json(admin,'/api/users','PUT',{id:session.userId,username:'teacher',role:'supervisor'});assert.equal(demoted.sessionRevoked,true);
    await json(admin,'/api/users','GET',undefined,401);
    const demotedCookie=await login('teacher','original-admin-password');assert.equal((await json(demotedCookie,'/api/session')).role,'supervisor','Legacy config must not restore administrator privileges');
    assert.doesNotMatch(logs,/Fatal error|Warning:|Deprecated:/);
  }finally{
    for(const socket of sockets)socket.terminate();for(const child of children)child.kill();await Promise.all(children.map(async child=>{if(child.exitCode===null)await once(child,'exit');}));await target.close();await rm(dir,{recursive:true,force:true});
  }
});
