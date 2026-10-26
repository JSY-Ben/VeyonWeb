import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, symlink, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {once} from 'node:events';

for (const automatic of [false, true]) test(`subdirectory page, assets, API and scoped login cookie (${automatic ? 'automatic' : 'configured'} path)`, async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'veyon-prefix-'));
  const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
  const port=socket.address().port;await new Promise(r=>socket.close(r));
  const origin=`http://127.0.0.1:${port}`, prefix='/tools/veyon';
  let child;
  try {
    await mkdir(path.join(dir,'tools'));
    await symlink(path.resolve('public'),path.join(dir,'tools/veyon'));
    const config={origin,base_path:automatic ? null : prefix,demo:true,data_directory:dir,overview_refresh_seconds:17};
    const configPath=path.join(dir,'config.php');
    await writeFile(configPath,`<?php return json_decode(base64_decode('${Buffer.from(JSON.stringify(config)).toString('base64')}'), true);`);
    child=spawn('php',['-S',`127.0.0.1:${port}`,'-t',dir],{env:{...process.env,CLASSROOM_CONFIG:configPath},stdio:'ignore'});
    let ready=false;
    for(let i=0;i<60;i++){try{await fetch(origin+prefix+'/');ready=true;break;}catch{await new Promise(r=>setTimeout(r,50));}}
    assert.ok(ready,'PHP server started');
    const html=await (await fetch(origin+prefix+'/index.php')).text();
    assert.ok(html.includes(`<base href="${prefix}/">`));
    for(const asset of ['app.js','rfb.js','veyon-rfb.js','classroom-actions.js','downloads.js','snapshots.js','style.css','fonts.css'])assert.equal((await fetch(origin+prefix+'/'+asset)).status,200);
    const endpoint=route=>origin+prefix+'/api.php?route='+encodeURIComponent(route);
    const session=await (await fetch(endpoint('/api/session'))).json();assert.equal(session.authenticated,false);
    const login=await fetch(endpoint('/api/login'),{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
    assert.equal(login.status,200);assert.ok(login.headers.get('set-cookie').includes(`path=${prefix}/`));
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const authenticated=await (await fetch(endpoint('/api/session'),{headers:{Cookie:cookie}})).json();assert.equal(authenticated.authenticated,true);
    const computers=await (await fetch(endpoint('/api/computers'),{headers:{Cookie:cookie}})).json();assert.equal(computers.overviewRefreshSeconds,17);
  } finally {
    if(child){child.kill();await once(child,'exit');}
    await rm(dir,{recursive:true,force:true});
  }
});
