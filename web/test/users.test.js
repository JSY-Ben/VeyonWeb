import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {fakeVeyon,privateKey} from './fixture.js';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function port(){const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const value=socket.address().port;await new Promise(resolve=>socket.close(resolve));return value;}

test('users: config master, role boundaries, assigned classrooms, settings, and live-session revocation',{timeout:30000},async()=>{
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
    const config={origin,masteradmin_username:'teacher',masteradmin_password_hash:hash,database:path.join(dir,'data.sqlite'),gateway_listen:`websocket://127.0.0.1:${wsPort}`,websocket_url:`ws://127.0.0.1:${wsPort}/remote`,veyon:{method:'key',username:'teacher',key_name:'teacher',private_key_file:keyPath}};
    const configDirectory=path.join(dir,'config');await mkdir(configDirectory);
    const configPath=path.join(configDirectory,'local.php');await writeFile(configPath,`<?php return json_decode(base64_decode('${Buffer.from(JSON.stringify(config)).toString('base64')}'),true);`);
    for(const args of [['-S',`127.0.0.1:${httpPort}`,'-t','public','router.php'],['gateway.php','start']]){
      const child=spawn('php',args,{env:{...process.env,CLASSROOM_CONFIG:configPath},stdio:['ignore','pipe','pipe']});children.push(child);child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);
    }
    let started=false;for(let i=0;i<80;i++){try{if((await request('','/api/session')).ok){started=true;break;}}catch{}await delay(50);}assert.ok(started,logs);await delay(100);
    await json('','/api/users','GET',undefined,401);
    const admin=await login('teacher','original-admin-password');
    const seeded=spawnSync('php',['-r',`require $argv[1];$db=new Classroom\\Database($argv[2]);$db->query('CREATE TABLE settings(name TEXT PRIMARY KEY,value TEXT NOT NULL)');$db->query('INSERT INTO settings VALUES (?,?)',['overview_refresh_seconds','37']);`,path.resolve('vendor/autoload.php'),path.join(dir,'data.sqlite')],{encoding:'utf8'});assert.equal(seeded.status,0,seeded.stderr);
    assert.equal((await json(admin,'/api/computers')).overviewRefreshSeconds,30,'Old SQLite settings must be ignored');
    const session=await json(admin,'/api/session');assert.equal(session.role,'admin');assert.equal(session.isMaster,true);assert.equal(session.userId,0);
    const before=await json(admin,'/api/users');assert.equal(before.users.length,0);assert.ok(!JSON.stringify(before).includes('password_hash'));
    await json(admin,'/api/users','POST',{username:'TEACHER',password:'duplicate-password',role:'admin'},400);
    // A database account with the same username cannot bypass the config password.
    const collision=spawnSync('php',['-r',`require $argv[1];$db=new Classroom\\Database($argv[2]);$db->query("INSERT INTO users(username,password_hash,role,enabled,created_at) VALUES (?,?,'admin',1,?)",['teacher',password_hash('shadow-admin-password',PASSWORD_DEFAULT),time()]);echo $db->pdo->lastInsertId();`,path.resolve('vendor/autoload.php'),path.join(dir,'data.sqlite')],{encoding:'utf8'});assert.equal(collision.status,0,collision.stderr);
    await login('teacher','shadow-admin-password',401);
    const shadow=(await json(admin,'/api/users')).users.find(user=>user.username==='teacher');assert.equal(shadow.reserved,true);
    await json(admin,'/api/users','DELETE',{id:Number(collision.stdout)});assert.equal((await json(admin,'/api/session')).isMaster,true);
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
    const saved=await readFile(configPath,'utf8');assert.match(saved,/'overview_refresh_seconds'\s*=>\s*45/);assert.ok(saved.includes(keyPath),'Saving preview settings must preserve the Veyon key path');
    const savedValues=spawnSync('php',['-r','echo json_encode(require $argv[1]);',configPath],{encoding:'utf8'});assert.equal(savedValues.status,0,savedValues.stderr);assert.equal(JSON.parse(savedValues.stdout).masteradmin_password_hash,hash);
    if(process.getuid?.()!==0){
      await chmod(configDirectory,0o500);
      try{const failed=await json(admin,'/api/settings','PUT',{overview_refresh_seconds:46},500);assert.match(failed.error,/write access|permissions/);assert.equal(await readFile(configPath,'utf8'),saved);}
      finally{await chmod(configDirectory,0o700);}
    }
    const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1sAAAAASUVORK5CYII=';
    const branding={app_name:"School's \\ Classroom",primary_colour:'#ffd900',theme:'dark',app_logo:png,login_graphic:png};
    await json(admin,'/api/settings','PUT',branding);
    const publicBranding=await json('','/api/appearance');assert.deepEqual(publicBranding.appearance,branding);assert.ok(!JSON.stringify(publicBranding).includes(hash));
    assert.equal((await json(admin,'/api/settings')).settings.overview_refresh_seconds,45,'Appearance saves preserve connection settings');
    for(const invalid of [{primary_colour:'red;display:none'},{theme:'anything'},{app_name:''},{app_logo:'data:image/svg+xml;base64,PHN2Zz4='},{login_graphic:'https://example.com/picture.png'}])await json(admin,'/api/settings','PUT',invalid,400);
    await json(supervisor,'/api/settings','PUT',{theme:'light'},403);
    await json(admin,'/api/settings','PUT',{origin:'https://attacker.example'},400);
    await json(admin,'/api/users','PUT',{id:supervisorId,username:'supervisor',role:'admin'});
    await json(supervisor,'/api/users','GET',undefined,401);const promoted=await login('supervisor','supervisor-password');assert.equal((await json(promoted,'/api/session')).role,'admin');
    await json(admin,'/api/users','DELETE',{id:supervisorId});
    assert.equal((await json(admin,'/api/session')).isMaster,true);
    assert.equal((await json(await login('teacher','original-admin-password'),'/api/session')).role,'admin');
    // Password rotation in local.php invalidates existing master sessions.
    const rotated=spawnSync('php',['-r',"$p=$argv[1];$c=require $p;$c['masteradmin_password_hash']=password_hash('rotated-admin-password',PASSWORD_DEFAULT);file_put_contents($p,'<?php return '.var_export($c,true).';');",configPath],{encoding:'utf8'});assert.equal(rotated.status,0,rotated.stderr);
    assert.equal((await json(admin,'/api/session')).authenticated,false);
    await login('teacher','original-admin-password',401);assert.ok(await login('teacher','rotated-admin-password'));
    assert.doesNotMatch(logs,/Fatal error|Warning:|Deprecated:/);
  }finally{
    for(const socket of sockets)socket.terminate();for(const child of children)child.kill();await Promise.all(children.map(async child=>{if(child.exitCode===null)await once(child,'exit');}));await target.close();await rm(dir,{recursive:true,force:true});
  }
});
