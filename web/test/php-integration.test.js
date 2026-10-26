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

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function port(){const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const value=server.address().port;await new Promise(resolve=>server.close(resolve));return value;}
const apache=process.env.APACHE_HTTPD && process.env.PHP_FPM;
for(const method of ['key','logon'])test(`${apache?'Apache/PHP-FPM':'PHP HTTP'} + PHP gateway: ${method}, screens, input, read-only, ticket replay and logout`,{timeout:20000},async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'veyon-php-integration-')),input=[],sockets=[],children=[];
  const fake=await fakeVeyon({method,greeting:method==='key'?'RFB 003.008\0':'RFB 003.008\n',onInput:data=>input.push(data)}),httpPort=await port(),wsPort=await port(),origin=`http://127.0.0.1:${httpPort}`;
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
    const config={origin,teacher_username:'teacher',teacher_password_hash:hash,database:path.join(dir,'data.sqlite'),gateway_listen:`websocket://127.0.0.1:${wsPort}`,websocket_url:apache?'/remote':`ws://127.0.0.1:${wsPort}/remote`,veyon:{method,username:'teacher',key_name:'teacher',private_key_file:path.join(dir,'key.pem'),password:'secret-password'}};
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
    const page=await request('/');assert.equal(page.status,200,apache?await readFile(path.join(dir,'apache.log'),'utf8'):'Main page failed');assert.match(await page.text(),/Teacher workspace/);
    const bundle=await request('/rfb.js');assert.equal(bundle.status,200);assert.match(bundle.headers.get('content-type'),/javascript/);
    assert.equal((await request('/api/computers')).status,401);
    assert.equal((await request('/api/login','POST',{username:'teacher',password:'integration-password'},'https://attacker.example')).status,403);
    assert.equal((await request('/api/login','POST',{username:'teacher',password:'wrong'})).status,401);
    const response=await request('/api/login','POST',{username:'teacher',password:'integration-password'});assert.equal(response.status,200);cookie=response.headers.get('set-cookie').split(';')[0];assert.match(response.headers.get('set-cookie'),/HttpOnly/i);assert.match(response.headers.get('set-cookie'),/SameSite=Strict/i);
    assert.equal((await request('/api/computers','PUT',[{id:'lab',name:'Lab',host:'127.0.0.1',port:fake.port,room:'Lab'}])).status,200);
    const readonly=await open('view'),key=Buffer.from([4,1,0,0,0,0,0,65]),pointer=Buffer.from([5,1,0,10,0,20]),update=Buffer.from([3,0,0,0,0,0,0,2,0,2]);
    readonly.ws.send(Buffer.concat([key,pointer,update]));await delay(80);assert.deepEqual(Buffer.concat(input),update);input.length=0;
    const frame=Buffer.alloc(32);frame.writeUInt16BE(1,2);frame.writeUInt16BE(2,8);frame.writeUInt16BE(2,10);frame.fill(255,16);fake.sendFrame(frame);assert.deepEqual(await readonly.next(),frame);
    const replay=new WebSocket(new URL(readonly.ticket.path,origin.replace('http','ws')),{headers:{Origin:origin,Cookie:cookie}});replay.on('error',()=>{});await once(replay,'unexpected-response').then(([req,res])=>{assert.equal(res.statusCode,403);res.resume();req.destroy();});
    const control=await open('control');control.ws.send(Buffer.concat([key,pointer]));await delay(80);assert.deepEqual(Buffer.concat(input),Buffer.concat([key,pointer]));
    const revoked=Promise.all([once(readonly.ws,'close'),once(control.ws,'close')]);
    assert.equal((await request('/api/computers','PUT',[{id:'lab',name:'Lab updated',host:'127.0.0.1',port:fake.port,room:'Lab'}])).status,200);await revoked;
    const final=await open('control'),closed=once(final.ws,'close');assert.equal((await request('/api/logout','POST',{})).status,200);await closed;
    assert.equal((await request('/api/computers')).status,401);assert.deepEqual(fake.errors,[]);
    assert.doesNotMatch(logs, /Fatal error|Warning:|Deprecated:/);
  }finally{for(const ws of sockets)ws.terminate();for(const child of children)child.kill('SIGTERM');await Promise.all(children.map(async child=>{if(child.exitCode===null)await once(child,'exit');}));await fake.close();await rm(dir,{recursive:true,force:true});}
});
