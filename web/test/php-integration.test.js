import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir, userInfo } from 'node:os';
import { WebSocket } from 'ws';
import { fakeVeyon, privateKey } from './fixture.js';
import { decodeFeatures } from './reference-protocol.js';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function port(){const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const value=server.address().port;await new Promise(resolve=>server.close(resolve));return value;}
const apache=process.env.APACHE_HTTPD && process.env.PHP_FPM;
for(const method of ['key','logon'])test(`${apache?'Apache/PHP-FPM':'PHP HTTP'} + PHP gateway: ${method}, screens, input, read-only, ticket replay and logout`,{timeout:20000},async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'veyon-php-integration-')),input=[],sockets=[],children=[];
  const fake=await fakeVeyon({method,greeting:method==='key'?'RFB 003.008\0':'RFB 003.008\n',onInput:data=>input.push(data)}),silent=await fakeVeyon({greeting:''}),httpPort=await port(),wsPort=await port(),origin=`http://127.0.0.1:${httpPort}`;
  let logs='',cookie='';
  async function request(route,verb='GET',body,requestOrigin=origin){return fetch(origin+route,{method:verb,headers:{Origin:requestOrigin,Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});}
  async function open(mode){
    const response=await request('/api/tickets','POST',{computerId:'lab',mode});assert.equal(response.status,200);const ticket=await response.json();
    const ws=new WebSocket(new URL(ticket.path,origin.replace('http','ws')),{headers:{Origin:origin,Cookie:cookie}});sockets.push(ws);ws.on('error',()=>{});
    const queue=[];let wake;ws.on('message',bytes=>{queue.push(bytes);wake?.();});
    async function next(){if(!queue.length)await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`Gateway timed out. ${logs}`)),3000);wake=()=>{clearTimeout(timer);wake=null;resolve();};});return queue.shift();}
    assert.equal((await next()).toString(),'RFB 003.008\n');ws.send(Buffer.from('RFB 003.008\n'));assert.deepEqual(await next(),Buffer.from([1,1]));ws.send(Buffer.from([1]));assert.deepEqual(await next(),Buffer.alloc(4));ws.send(Buffer.from([1]));assert.equal((await next()).readUInt16BE(),2);
    return{ws,next,ticket};
  }
  try{
    await writeFile(path.join(dir,'key.pem'),privateKey,{mode:0o600});
    const hash=spawnSync('php',['-r',"echo password_hash('integration-password', PASSWORD_DEFAULT);"],{encoding:'utf8'}).stdout;
    const config={origin,preview_timeout_seconds:3,masteradmin_username:'teacher',masteradmin_password_hash:hash,database:path.join(dir,'data.sqlite'),gateway_listen:`websocket://127.0.0.1:${wsPort}`,websocket_url:apache?'/remote':`ws://127.0.0.1:${wsPort}/remote`,veyon:{method,username:'teacher',key_name:'teacher',private_key_file:path.join(dir,'key.pem'),password:'secret-password'}};
    const configPath=path.join(dir,'config.php');await writeFile(configPath,`<?php return json_decode(base64_decode('${Buffer.from(JSON.stringify(config)).toString('base64')}'), true);`);
    const commands=apache?[]:[['php','-S',`127.0.0.1:${httpPort}`,'-t','public','router.php']];
    if(apache){
      // macOS protects Documents from httpd. Stage a normal document root in the
      // temporary test installation, as production would under /opt or /var/www.
      for(const directory of ['public','php','vendor'])await cp(path.resolve(directory),path.join(dir,'app',directory),{recursive:true});
      const fpmPort=await port(),modules=process.env.APACHE_MODULE_DIR || '/usr/libexec/apache2',publicPath=path.join(dir,'app/public');
      const loads=['mpm_event','unixd','authz_core','dir','mime','rewrite','proxy','proxy_http','proxy_fcgi'].map(name=>`LoadModule ${name}_module ${modules}/mod_${name}.so`).join('\n');
      await writeFile(path.join(dir,'httpd.conf'),`ServerRoot "${dir}"\nPidFile "${dir}/httpd.pid"\nDefaultRuntimeDir "${dir}"\nListen 127.0.0.1:${httpPort}\nServerName 127.0.0.1\n${loads}\nUser ${userInfo().username}\nGroup staff\nErrorLog "${dir}/apache.log"\nTypesConfig /etc/apache2/mime.types\nDocumentRoot "${publicPath}"\n<Directory "${publicPath}">\nRequire all granted\nAllowOverride None\nOptions -Indexes -MultiViews\nDirectoryIndex index.html\nRewriteEngine On\nRewriteRule ^api(?:/.*)?$ api.php [END]\n</Directory>\n<FilesMatch "\\.php$">\nSetHandler "proxy:fcgi://127.0.0.1:${fpmPort}"\n</FilesMatch>\nProxyRequests Off\nProxyPass /remote http://127.0.0.1:${wsPort}/remote upgrade=websocket\nProxyPassReverse /remote http://127.0.0.1:${wsPort}/remote\n`);
      await writeFile(path.join(dir,'fpm.conf'),`[global]\npid=${dir}/fpm.pid\nerror_log=${dir}/fpm.log\ndaemonize=no\n[www]\nuser=${userInfo().username}\ngroup=staff\nlisten=127.0.0.1:${fpmPort}\npm=static\npm.max_children=2\nclear_env=no\ncatch_workers_output=yes\n`);
      commands.push([process.env.PHP_FPM,'-y',path.join(dir,'fpm.conf'),'-F'],[process.env.APACHE_HTTPD,'-f',path.join(dir,'httpd.conf'),'-DFOREGROUND']);
    }
    commands.push(['php','gateway.php','start']);
    for(const [command,...args] of commands){
      const child=spawn(command,args,{env:{...process.env,CLASSROOM_CONFIG:configPath,VEYON_DEMO:'0'},stdio:['ignore','pipe','pipe']});children.push(child);child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);
    }
    let started=false;for(let i=0;i<80;i++){try{const response=await request('/api/session');if(response.ok){started=true;break;}}catch{}await delay(50);}assert.ok(started,logs);await delay(100);
    const page=await request('/');assert.equal(page.status,200,apache?await readFile(path.join(dir,'apache.log'),'utf8'):'Main page failed');assert.match(await page.text(),/<title>VeyonWeb<\/title>/);
    const bundle=await request('/rfb.js');assert.equal(bundle.status,200);assert.match(bundle.headers.get('content-type'),/javascript/);
    assert.equal((await request('/api/computers')).status,401);
    assert.equal((await request('/api/login','POST',{username:'teacher',password:'integration-password'},'https://attacker.example')).status,403);
    assert.equal((await request('/api/login','POST',{username:'teacher',password:'wrong'})).status,401);
    const response=await request('/api/login','POST',{username:'teacher',password:'integration-password'});assert.equal(response.status,200);cookie=response.headers.get('set-cookie').split(';')[0];assert.match(response.headers.get('set-cookie'),/HttpOnly/i);assert.match(response.headers.get('set-cookie'),/SameSite=Strict/i);
    assert.equal((await request('/api/computers','PUT',[{id:'lab',name:'Lab',host:'127.0.0.1',port:fake.port,room:'Lab'},{id:'slow',name:'Unresponsive',host:'127.0.0.1',port:silent.port,room:'Lab'}])).status,200);
    assert.equal((await (await request('/api/computers')).json()).connectionTimeoutSeconds,2);
    // HTTP actions authenticate independently and preserve Veyon's Qt types.
    assert.equal((await request('/api/actions','POST',{computerId:'lab',action:'reboot'})).status,400);
    assert.equal((await request('/api/actions','POST',{computerId:'missing',action:'lock'})).status,404);
    assert.equal((await request('/api/actions','POST',{computerId:'lab',action:'website',url:'javascript:alert(1)'})).status,400);
    assert.equal((await request('/api/actions','POST',{computerId:'lab',action:'lock'},'https://attacker.example')).status,403);
    const actions=[
      ['message',{text:'Hello <class> — café'},'e75ae9c8-ac17-4d00-8f0d-019348346208',0,{'0':'Hello &lt;class&gt; — café','1':1,'2':'Message from teacher'}],
      ['lock',{},'ccb535a2-1d24-4cc1-a709-8b47d2b2ac79',0,{}],
      ['unlock',{},'ccb535a2-1d24-4cc1-a709-8b47d2b2ac79',1,{}],
      ['website',{url:'https://school.example/lesson'},'8a11a75d-b3db-48b6-b9cb-f8422ddd5b0c',0,{'1':['https://school.example/lesson']}],
      ['program',{program:'notepad.exe'},'da9ca56a-b2ad-4fff-8f8a-929b2927b442',0,{'0':['notepad.exe']}],
      ['reboot',{confirmed:true},'4f7d98f0-395a-4fff-b968-e49b8d0f748c',0,{}],
      ['shutdown',{confirmed:true},'6f5a27a0-0e2f-496e-afcc-7aae62eede10',0,{}],
      ['logoff',{confirmed:true},'7311d43d-ab53-439e-a03a-8cb25f7ed526',0,{}],
    ];
    for(const [action,params,uuid,command,args] of actions){
      input.length=0;const response=await request('/api/actions','POST',{computerId:'lab',action,...params});
      assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).status,'sent');await delay(20);
      assert.deepEqual(decodeFeatures(Buffer.concat(input)),[[uuid,command,args]]);
    }
    input.length=0;
    const fileBytes=Buffer.alloc(140000,0x29);fileBytes.write('lesson content');
    const form=new FormData();form.set('computerId','lab');form.set('file',new Blob([fileBytes]),'lesson.txt');form.set('overwrite','1');form.set('open','1');
    const uploaded=await fetch(origin+'/api.php?route=%2Fapi%2Ffiles',{method:'POST',headers:{Origin:origin,Cookie:cookie},body:form});assert.equal(uploaded.status,200,await uploaded.text());await delay(30);
    const fileFrames=decodeFeatures(Buffer.concat(input));assert.deepEqual(fileFrames.map(f=>f[1]),[0,1,1,1,3]);
    const transferId=fileFrames[0][2]['0'];assert.match(transferId,/^[a-f0-9-]{36}$/);
    assert.deepEqual(fileFrames[0][2],{'0':transferId,'1':'lesson.txt','4':true});
    assert.ok(fileFrames.every(f=>f[0]==='4a70bd5a-fab2-4a4b-a92a-a1e81d2b75ed'&&f[2]['0']===transferId));
    assert.deepEqual(Buffer.concat(fileFrames.slice(1,-1).map(f=>f[2]['2'])),fileBytes);
    assert.deepEqual(fileFrames.at(-1)[2],{'0':transferId,'1':'lesson.txt','3':true});input.length=0;
    const actionStarted=Date.now(),timedOut=await request('/api/actions','POST',{computerId:'slow',action:'lock'});
    assert.equal(timedOut.status,502);assert.ok(Date.now()-actionStarted>=2500,'TCP accepted; authentication uses its separate 3-second budget');assert.ok(Date.now()-actionStarted<5000,'HTTP action connection deadline');
    const slowTicket=await (await request('/api/tickets','POST',{computerId:'slow',mode:'view'})).json();
    const slowSocket=new WebSocket(new URL(slowTicket.path,origin.replace('http','ws')),{headers:{Origin:origin,Cookie:cookie}});sockets.push(slowSocket);slowSocket.on('error',()=>{});
    const gatewayStarted=Date.now(),[closeCode,closeReason]=await once(slowSocket,'close');
    assert.equal(closeCode,1011);assert.match(closeReason.toString(),/timed out/i);assert.ok(Date.now()-gatewayStarted>=2500,'Gateway separates TCP connection and authentication budgets');assert.ok(Date.now()-gatewayStarted<5000,'Gateway connection deadline');
    const readonly=await open('view'),key=Buffer.from([4,1,0,0,0,0,0,65]),pointer=Buffer.from([5,1,0,10,0,20]),update=Buffer.from([3,0,0,0,0,0,0,2,0,2]);
    readonly.ws.send(Buffer.concat([key,pointer,update]));await delay(80);assert.deepEqual(Buffer.concat(input),update);input.length=0;
    const frame=Buffer.alloc(32);frame.writeUInt16BE(1,2);frame.writeUInt16BE(2,8);frame.writeUInt16BE(2,10);frame.fill(255,16);fake.sendFrame(frame);assert.deepEqual(await readonly.next(),frame);
    const replay=new WebSocket(new URL(readonly.ticket.path,origin.replace('http','ws')),{headers:{Origin:origin,Cookie:cookie}});replay.on('error',()=>{});await once(replay,'unexpected-response').then(([req,res])=>{assert.equal(res.statusCode,403);res.resume();req.destroy();});
    const control=await open('control');control.ws.send(Buffer.concat([key,pointer]));await delay(80);assert.deepEqual(Buffer.concat(input),Buffer.concat([key,pointer]));
    const revoked=Promise.all([once(readonly.ws,'close'),once(control.ws,'close')]);
    assert.equal((await request('/api/computers','PUT',[{id:'lab',name:'Lab updated',host:'127.0.0.1',port:fake.port,room:'Lab'}])).status,200);await revoked;
    // Exercise concurrent ticket consumption and bridges with the default
    // four-worker pool, then verify revocation reaches every connection.
    const concurrent=await Promise.all(Array.from({length:8},()=>open('view')));
    const final=await open('control'),closed=Promise.all([final,...concurrent].map(connection=>once(connection.ws,'close')));assert.equal((await request('/api/logout','POST',{})).status,200);await closed;
    assert.equal((await request('/api/computers')).status,401);assert.deepEqual(fake.errors,[]);
    assert.equal((await request('/api/actions','POST',{computerId:'lab',action:'lock'})).status,401);
    assert.doesNotMatch(logs, /Fatal error|Warning:|Deprecated:/);
  }finally{for(const ws of sockets)ws.terminate();for(const child of children)child.kill('SIGTERM');await Promise.all(children.map(async child=>{if(child.exitCode===null)await once(child,'exit');}));await fake.close();await silent.close();await rm(dir,{recursive:true,force:true});}
});
