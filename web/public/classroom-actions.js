import {download,safeName,screenshotZip} from './downloads.js';
import {captureDesktop,waitForFrame} from './snapshots.js?v=preview-start-20261026';
const $=s=>document.querySelector(s);
const labels={screenshot:'Capture screenshots',message:'Send message',lock:'Lock screens',unlock:'Unlock screens',website:'Open website',program:'Run program',wake:'Wake computers',reboot:'Restart computers',shutdown:'Shut down computers',logoff:'Log off users',files:'Distribute file'};
const destructive=new Set(['reboot','shutdown','logoff']);

export function setupClassroomActions({state,filtered,api,makeRFB,escapeHTML}) {
  const selected=new Set();let targets=[],busy=false,stopped=false,shots=[],objectURLs=[];
  const dialog=$('#action-dialog'),form=$('#action-form');
  function refresh(){
    const visible=filtered(),valid=new Set(visible.map(c=>c.id));
    for(const id of selected)if(!valid.has(id))selected.delete(id);
    $('#selection-count').textContent=`${selected.size} selected`;
    document.querySelectorAll('[data-classroom-action]').forEach(button=>{
      button.hidden=!state.canManage&&button.dataset.classroomAction!=='screenshot';
      button.disabled=!selected.size;
    });
    $('#clear-selection').disabled=!selected.size;
    $('#select-classroom').disabled=!visible.length;
    document.querySelectorAll('.select-computer').forEach(input=>{
      input.checked=selected.has(input.dataset.id);
      input.closest('.computer-card').classList.toggle('is-selected',input.checked);
      input.onchange=()=>{if(input.checked)selected.add(input.dataset.id);else selected.delete(input.dataset.id);refresh();};
    });
  }
  function open(action,computers=state.computers.filter(c=>selected.has(c.id))){
    if(busy||!computers.length)return;
    targets=[...computers];form.reset();$('#action-kind').value=state.canManage?action:'screenshot';$('#action-progress').textContent='';
    $('#action-results').replaceChildren();clearShots();updateForm();dialog.showModal();
  }
  function clearShots(){for(const url of objectURLs)URL.revokeObjectURL(url);objectURLs=[];shots=[];$('#download-screenshots').hidden=true;}
  function updateForm(){
    const action=$('#action-kind').value;
    $('#action-title').textContent=labels[action];
    $('#action-submit').textContent=labels[action];
    $('#action-targets').textContent=`${targets.length} computer${targets.length===1?'':'s'}: ${targets.map(c=>c.name).join(', ')}`;
    for(const field of form.querySelectorAll('[data-actions]')){
      const show=field.dataset.actions.split(' ').includes(action);field.hidden=!show;
      field.querySelectorAll('input,textarea').forEach(input=>{input.disabled=!show;});
    }
    $('#action-confirm-row').hidden=!destructive.has(action);
    $('#action-confirm').required=destructive.has(action);$('#action-confirm').disabled=!destructive.has(action);
    $('#action-note').textContent=action==='files'?'Files go to the destination configured on each PC, usually the signed-in user’s home folder. “Sent” does not confirm that the file was saved.':action==='wake'?'Needs a saved MAC address, Wake-on-LAN enabled on the PC, and a reachable broadcast network.':action==='lock'?'Locks the screen and input devices. Select Unlock screens to restore access.':action==='screenshot'?'Captures the current desktop through the gateway. Downloads stay in your browser.':'Commands use the existing Veyon credentials and access-control rules. “Sent” means delivered to the Veyon connection, not confirmed execution.';
    $('#action-submit').disabled=state.demo&&action!=='screenshot';
    if(state.demo&&action!=='screenshot')$('#action-note').textContent='Classroom commands are unavailable in sample mode.';
    $('#action-error').textContent='';
  }
  async function capture(computer){
    if(state.demo){
      let canvas=state.remote?.computer.id===computer.id?$('#remote-screen canvas'):$(`#screen-${computer.id} canvas`);
      if(!canvas){
        const image=$(`#screen-${computer.id} .snapshot-image`);if(!image)throw new Error('Refresh this sample picture first.');
        await image.decode();canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d').drawImage(image,0,0);
      }
      return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Screenshot unavailable.')),'image/png'));
    }
    const rfb=state.remote?.computer.id===computer.id?state.remote.rfb:state.connections.get(computer.id);
    if(!rfb||rfb._rfbConnectionState!=='connected')return captureDesktop(computer,makeRFB,{timeout:(state.previewTimeoutSeconds??10)*1000});
    await waitForFrame(rfb,{timeout:(state.previewTimeoutSeconds??10)*1000});
    return await new Promise((resolve,reject)=>rfb.toBlob(blob=>blob?resolve(blob):reject(new Error('Screenshot unavailable.')),'image/png'));
  }
  async function run(computer,action,values,file){
    if(action==='screenshot'){
      const blob=await capture(computer),name=`${safeName(computer.name)}-${safeName(computer.id)}.png`;
      shots.push({blob,name});return {message:'Screenshot ready',blob,name};
    }
    if(action==='files'){
      const body=new FormData();body.append('computerId',computer.id);body.append('file',file);body.append('overwrite',values.overwrite?'1':'0');body.append('open',values.open?'1':'0');
      return api('/api/files',{method:'POST',body});
    }
    return api('/api/actions',{method:'POST',body:JSON.stringify({computerId:computer.id,action,...values})});
  }
  form.onsubmit=async event=>{
    event.preventDefault();if(busy)return;
    const action=$('#action-kind').value,data=new FormData(form),file=data.get('file');
    if(action==='files'&&(!file||!file.name)){ $('#action-error').textContent='Choose a file to distribute.';return; }
    if(action==='files'&&file.size>(state.maxUploadBytes||20971520)){ $('#action-error').textContent='File exceeds the configured upload limit.';return; }
    busy=true;stopped=false;clearShots();$('#action-results').replaceChildren();$('#action-progress').textContent='Starting…';
    const values={text:data.get('text'),url:data.get('url'),program:data.get('program'),confirmed:data.get('confirmed')==='on',overwrite:data.get('overwrite')==='on',open:data.get('open')==='on'};
    form.querySelectorAll('input,textarea,select,button').forEach(input=>input.disabled=true);
    $('#stop-actions').disabled=false;$('#stop-actions').hidden=false;
    let index=0,done=0,sent=0,failed=0;
    const rows=targets.map(computer=>{const li=document.createElement('li');li.innerHTML=`<strong>${escapeHTML(computer.name)}</strong><span>Waiting</span>`;$('#action-results').append(li);return li;});
    const worker=async()=>{while(index<targets.length&&!stopped){
      const i=index++,row=rows[i];row.lastElementChild.textContent='Connecting…';
      try{
        const result=await run(targets[i],action,values,file);sent++;row.className='action-sent';row.lastElementChild.textContent=result.message;
        if(result.blob){const link=document.createElement('a');link.textContent='Download PNG';link.download=result.name;link.href=URL.createObjectURL(result.blob);objectURLs.push(link.href);row.append(link);}
      }catch(error){failed++;if(error.status===401)stopped=true;row.className='action-failed';row.lastElementChild.textContent=error.message;}
      done++;$('#action-progress').textContent=`${done} of ${targets.length} processed · ${sent} ${action==='screenshot'?'captured':'sent'} · ${failed} failed`;
    }};
    try{await Promise.all(Array.from({length:Math.min(3,targets.length)},worker));}
    finally{
      rows.slice(index).forEach(row=>row.lastElementChild.textContent='Not sent — stopped');
      busy=false;$('#stop-actions').hidden=true;form.querySelectorAll('input,textarea,select,button').forEach(input=>input.disabled=false);
      updateForm();$('#download-screenshots').hidden=!shots.length;if(!dialog.open)clearShots();
    }
  };
  $('#select-classroom').onclick=()=>{for(const c of filtered())selected.add(c.id);refresh();};
  $('#clear-selection').onclick=()=>{selected.clear();refresh();};
  document.querySelectorAll('[data-classroom-action]').forEach(button=>{
    button.onclick=()=>open(button.dataset.classroomAction);
  });
  $('#action-close').onclick=()=>{if(!busy)dialog.close();};
  $('#stop-actions').onclick=()=>{stopped=true;$('#stop-actions').disabled=true;$('#action-progress').textContent='Stopping after in-flight requests. Commands already sent cannot be recalled.';};
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  dialog.addEventListener('close',clearShots);
  $('#download-screenshots').onclick=async()=>{
    const button=$('#download-screenshots');button.disabled=true;
    try{if(shots.length===1)download(shots[0].blob,shots[0].name);else download(await screenshotZip(shots),`classroom-screenshots-${new Date().toISOString().replace(/[:.]/g,'-')}.zip`);}
    catch(error){$('#action-error').textContent=error.message;}finally{button.disabled=false;}
  };
  return {refresh,open,stop(){stopped=true;selected.clear();if(dialog.open)dialog.close();clearShots();}};
}
