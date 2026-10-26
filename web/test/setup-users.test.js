import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,symlink,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('CLI setup creates the first administrator and can recover its password',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'veyon-setup-users-')),data=path.join(dir,'private data');
  try{
    await mkdir(path.join(dir,'scripts'));await mkdir(path.join(dir,'config'));
    for(const file of ['setup.php','gateway-service.php'])await copyFile(path.resolve('scripts',file),path.join(dir,'scripts',file));
    await symlink(path.resolve('vendor'),path.join(dir,'vendor'));
    const config={masteradmin_username:'admin',masteradmin_password_hash:'',data_directory:data};
    await writeFile(path.join(dir,'config/example.php'),`<?php return json_decode(base64_decode('${Buffer.from(JSON.stringify(config)).toString('base64')}'),true);`);
    function setup(password,username){const input=[username,'http://127.0.0.1:8080','auto',password,password,data,'n',''].join('\n');const run=spawnSync('php',[path.join(dir,'scripts/setup.php')],{input,encoding:'utf8'});assert.equal(run.status,0,run.stdout+run.stderr);assert.match(run.stdout,/Master administrator saved/);}
    function inspect(password){const run=spawnSync('php',['-r',`$c=require $argv[1];echo json_encode(['username'=>$c['masteradmin_username'],'valid'=>password_verify($argv[2],$c['masteradmin_password_hash']),'databaseExists'=>is_file($argv[3])]);`,path.join(dir,'config/local.php'),password,path.join(data,'classroom.sqlite')],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);return JSON.parse(run.stdout);}
    setup('first-admin-password','first-admin');assert.deepEqual(inspect('first-admin-password'),{username:'first-admin',valid:true,databaseExists:false});
    setup('recovered-admin-password','');assert.deepEqual(inspect('recovered-admin-password'),{username:'first-admin',valid:true,databaseExists:false});assert.equal(inspect('first-admin-password').valid,false);
  }finally{await rm(dir,{recursive:true,force:true});}
});
