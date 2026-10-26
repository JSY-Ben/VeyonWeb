import RFB from './veyon-rfb.js';
import {setupClassroomActions} from './classroom-actions.js';
import {captureDesktop,SnapshotOverview} from './snapshots.js';
const appBase = new URL('.', import.meta.url);
const $ = selector => document.querySelector(selector);
const icons = {
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  monitor:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  activity:'<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  pause:'<path d="M9 5v14M15 5v14"/>',
  shield:'<path d="M12 3l8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5M12 17h.01"/>',
  logout:'<path d="M9 4H5v16h4M13 8l4 4-4 4M8 12h12"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  play:'<path d="m8 4 12 8-12 8z"/>',
  more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  pointer:'<path d="m5 3 14 11-7 1-3 6z"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  room:'<path d="M4 21V6l8-3v18M12 9h8v12M2 21h20M8 8v2M8 14v2M16 13v2"/>',
  left:'<path d="m14 6-6 6 6 6"/>',right:'<path d="m10 6 6 6-6 6"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',
  expand:'<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  edit:'<path d="m15 4 5 5M4 20l5-1L21 7l-4-4L5 15z"/>',
};
function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.monitor}</svg>`; }
function hydrateIcons(scope = document) { scope.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon)); }
hydrateIcons();
const state = { computers: [], room: null, search: '', page: 0, pageSize: 12, monitoring: false, demo: false, ready: false, connections: new Map(), statuses: new Map(), generation: 0, remote: null, overviewRefreshSeconds: 10 };
let toastTimer, pendingImport, overviewSnapshots;
const snapshotURLs=new Map();
const refreshStorageKey=`veyonweb-overview-refresh:${appBase.pathname}`;
function toast(text) { $('#toast').textContent = text; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 5000); }
function escapeHTML(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function api(url, options = {}) {
  const endpoint = new URL('api.php?route=' + encodeURIComponent(url), appBase);
  const headers = options.body instanceof FormData ? {...options.headers} : {'Content-Type':'application/json',...options.headers};
  const res = await fetch(endpoint, { ...options, headers });
  const body = await res.json();
  if (res.status === 401 && url !== '/api/login') { stopAll(); $('#workspace').hidden = true; $('#login').hidden = false; }
  if (!res.ok) { const error = new Error(body.error || `Request failed (${res.status}).`); error.status=res.status; throw error; }
  return body;
}
function filtered() { return state.computers.filter(c => (!state.room || c.room === state.room) && `${c.name} ${c.host}`.toLowerCase().includes(state.search.toLowerCase())); }
function currentPage() { const list = filtered(); state.page = Math.max(0,Math.min(state.page, Math.ceil(list.length / state.pageSize)-1)); return list.slice(state.page*state.pageSize, (state.page+1)*state.pageSize); }
function stopOverview() {
  overviewSnapshots?.stop();
  state.generation++;
  for (const connection of state.connections.values()) connection.disconnect();
  state.connections.clear(); state.statuses.clear();
}
function clearSnapshots(){for(const url of snapshotURLs.values())URL.revokeObjectURL(url);snapshotURLs.clear();document.querySelectorAll('.snapshot-image').forEach(image=>image.remove());}
function stopAll() { clearSnapshots();classroomActions.stop();state.monitoring = false; closeRemote(); stopOverview(); }
function renderNavigation() {
  $('#total-count').textContent = state.computers.length;
  $('#all-computers').classList.toggle('active', !state.room);
  const rooms = [...new Set(state.computers.map(c => c.room))].sort();
  $('#room-list').innerHTML = rooms.map(room => `<button class="nav-item ${state.room === room ? 'active' : ''}" data-room="${escapeHTML(room)}">${icon('room')}<span>${escapeHTML(room)}</span><span class="room-count">${state.computers.filter(c => c.room === room).length}</span></button>`).join('');
  $('#room-list').querySelectorAll('button').forEach(button => button.onclick = () => { state.room = button.dataset.room; state.page = 0; render(); });
  $('#room-suggestions').innerHTML = rooms.map(room => `<option value="${escapeHTML(room)}">`).join('');
  $('#room-title').innerHTML = `${escapeHTML(state.room || 'All computers')}<span class="heading-dot">.</span>`;
  $('#breadcrumb-room').textContent = state.room || 'All computers';
}
function updateStats() {
  const list = filtered(), online = list.filter(c => snapshotURLs.has(c.id)).length;
  $('#stat-total').textContent = list.length; $('#stat-online').textContent = online; $('#stat-idle').textContent = list.length-online;
  $('#online-label').textContent = state.demo ? 'sample pictures' : 'previews ready';
  $('#idle-label').textContent = state.monitoring ? 'awaiting preview' : 'ready to refresh';
}
function setStatus(id, kind, text) {
  state.statuses.set(id, { kind, text });
  const card = document.getElementById(`computer-${id}`); if (!card) return;
  const label = card.querySelector('.computer-state'); label.className = `computer-state ${kind}`;
  const hasPicture=!!card.querySelector('.snapshot-image');
  label.innerHTML = '<span class="dot"></span><span></span>'; label.lastElementChild.textContent = kind === 'connected' ? (state.demo ? 'Sample' : 'Updated') : kind === 'connecting' ? 'Refreshing' : kind === 'error' ? (hasPicture?'Refresh failed':'Unavailable') : 'Not refreshed';
  label.title = text;
  const placeholder = card.querySelector('.screen-placeholder');
  placeholder.hidden = kind === 'connected' || hasPicture; placeholder.classList.toggle('screen-error', kind === 'error');
  if (kind !== 'connected') placeholder.innerHTML = `${kind === 'connecting' ? '<span class="spinner"></span>' : icon(kind === 'error' ? 'info' : 'monitor')}<span>${escapeHTML(text)}</span>`;
  card.querySelector('.screen-tag').hidden = kind !== 'connected' && !hasPicture;
  updateStats();
}
function render() {
  stopOverview(); clearSnapshots(); renderNavigation();
  const list = filtered(), page = currentPage();
  $('#view-count').textContent = list.length;
  $('#computer-grid').innerHTML = page.map(c => `<article class="computer-card" id="computer-${c.id}"><label class="card-select"><input type="checkbox" class="select-computer" data-id="${c.id}" aria-label="Select ${escapeHTML(c.name)}">Select</label><div class="screen-wrap"><div class="thumbnail" id="screen-${c.id}"></div><div class="screen-placeholder">${icon('monitor')}<span>Ready to refresh</span></div><span class="screen-tag" hidden><span class="dot"></span>${state.demo ? 'SAMPLE PICTURE' : 'SNAPSHOT'}</span></div><div class="card-info"><div class="card-heading"><h3>${escapeHTML(c.name)}</h3><span class="computer-state"><span class="dot"></span>Not refreshed</span></div><p class="computer-address">${escapeHTML(c.host)} <span>· ${escapeHTML(c.room)}</span></p><div class="card-actions"><button class="button secondary view-button" data-id="${c.id}">${icon('eye')}View</button><button class="button control-button" data-id="${c.id}">${icon('pointer')}Remote control</button><button class="icon-button edit-button" data-id="${c.id}" aria-label="Edit ${escapeHTML(c.name)}" title="Edit computer">${icon('edit')}</button></div></div></article>`).join('');
  $('#computer-grid').querySelectorAll('.view-button').forEach(b => b.onclick = () => openRemote(b.dataset.id, 'view'));
  $('#computer-grid').querySelectorAll('.control-button').forEach(b => b.onclick = () => openRemote(b.dataset.id, 'control'));
  $('#computer-grid').querySelectorAll('.edit-button').forEach(b => b.onclick = () => editComputer(b.dataset.id));
  classroomActions.refresh();
  const empty = list.length === 0; $('#empty-state').hidden = !empty; $('#computer-grid').hidden = empty;
  $('#empty-title').textContent = state.computers.length ? 'No computers match your search.' : 'Make room for your classroom.';
  $('#empty-description').textContent = state.computers.length ? 'Try another name or choose a different classroom.' : 'Add your first Veyon computer to get started.';
  $('#empty-add').hidden = !!state.computers.length;
  $('#page-label').textContent = `Page ${state.page+1} of ${Math.max(1,Math.ceil(list.length/state.pageSize))}`;
  $('#prev-page').disabled = state.page === 0; $('#next-page').disabled = (state.page+1)*state.pageSize >= list.length;
  $('#monitor-dot').classList.toggle('live', state.monitoring);
  updateOverviewHint();
  updateStats();
  if (state.monitoring && !state.remote && !document.hidden) connectOverview(page);
}
async function makeRFB(computer, target, mode, {signal} = {}) {
  const { path } = await api('/api/tickets', { method:'POST', signal, body: JSON.stringify({computerId:computer.id, mode}) });
  if (!target.isConnected) throw new Error('Session cancelled.');
  const url = new URL(path, location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const channel = new WebSocket(url.href);
  let rfb;
  channel.addEventListener('close', event => { if (rfb && event.reason) rfb.gatewayError = event.reason; });
  try { rfb = new RFB(target, channel, { shared: true }); } catch (error) { channel.close(); throw error; }
  const connectionTimer=setTimeout(()=>{rfb.gatewayError=`Connection timed out after ${state.connectionTimeoutSeconds??2} seconds.`;rfb.disconnect();},(state.connectionTimeoutSeconds??2)*1000);
  const connected=()=>clearTimeout(connectionTimer);
  rfb.addEventListener('connect',connected,{once:true});
  rfb.addEventListener('disconnect',()=>{clearTimeout(connectionTimer);rfb.removeEventListener('connect',connected);},{once:true});
  rfb.viewOnly = mode === 'view'; rfb.scaleViewport = true; rfb.resizeSession = false; rfb.showDotCursor = mode === 'control';
  rfb.qualityLevel = mode === 'control' ? 6 : 2; rfb.compressionLevel = 6;
  rfb.clipViewport = false; rfb.background = '#10251f';
  return rfb;
}
function updateOverviewHint(){
  $('#overview-status').textContent=state.monitoring?`Snapshot overview · refresh every ${state.overviewRefreshSeconds}s · Open View or Remote control for live video.`:'Configure Veyon credentials to load desktop pictures automatically.';
}
function connectOverview(computers) {
  overviewSnapshots?.stop();
  overviewSnapshots=new SnapshotOverview({
    interval:state.overviewRefreshSeconds*1000,
    stagger:state.overviewStaggerMs??750,
    capture:async(computer,signal)=>{
      if(!snapshotURLs.has(computer.id))setStatus(computer.id,'connecting','Capturing a desktop picture…');
      if(!state.demo)return captureDesktop(computer,makeRFB,{signal,timeout:(state.connectionTimeoutSeconds??2)*1000});
      const staging=document.createElement('div');staging.className='screenshot-staging';document.body.append(staging);
      const demo=demoScreen(staging,computer,false);
      try{return await new Promise((resolve,reject)=>staging.querySelector('canvas').toBlob(blob=>blob?resolve(blob):reject(new Error('Sample snapshot unavailable.')),'image/png'));}
      finally{demo.disconnect();staging.remove();}
    },
    onSnapshot:(computer,blob)=>{
      const target=document.getElementById(`screen-${computer.id}`);if(!target)return;
      const previous=snapshotURLs.get(computer.id),url=URL.createObjectURL(blob),image=document.createElement('img');
      image.className='snapshot-image';image.alt=`Desktop snapshot of ${computer.name}`;image.src=url;target.replaceChildren(image);snapshotURLs.set(computer.id,url);if(previous)URL.revokeObjectURL(previous);
      const updated=new Date(),tag=target.closest('.computer-card').querySelector('.screen-tag');
      tag.textContent=`${state.demo?'Sample · ':''}Updated ${updated.toLocaleTimeString()}`;tag.title=updated.toLocaleString();
      setStatus(computer.id,'connected',`Last snapshot: ${updated.toLocaleString()}`);
    },
    onError:(computer,error)=>setStatus(computer.id,'error',error.message+(snapshotURLs.has(computer.id)?' Showing the last successful picture.':'')),
  });
  overviewSnapshots.start(computers);
}
async function loadClassroom() {
  const data = await api('/api/computers'); Object.assign(state,{ computers:data.computers, ready:data.ready, demo:data.demo, maxUploadBytes:data.maxUploadBytes });
  state.overviewRefreshSeconds=data.overviewRefreshSeconds||10;
  state.overviewStaggerMs=data.overviewStaggerMs??750;
  state.connectionTimeoutSeconds=data.connectionTimeoutSeconds??2;
  try{const saved=Number(localStorage.getItem(refreshStorageKey));if(Number.isInteger(saved)&&saved>=2&&saved<=3600)state.overviewRefreshSeconds=saved;}catch{}
  $('#overview-refresh').value=state.overviewRefreshSeconds;
  $('#demo-banner').hidden = !state.demo; $('#network-label').textContent = state.demo ? 'Sample workspace' : 'Local gateway';
  $('.local-badge').innerHTML = `<span class="dot"></span>${state.demo ? 'Sample mode' : 'School network'}`;
  state.monitoring = state.ready || state.demo; render();
}
function showHelp() {
  $('#setup-status').textContent = state.demo ? 'Sample mode: screens and input are simulated. For real computers, configure Apache/PHP and run php scripts/setup.php on your school server.' : state.ready ? 'Veyon credentials are configured on the PHP gateway. Add a target and connect to verify access.' : 'Veyon credentials are missing. Configure config/local.php and restart the PHP gateway before connecting to real computers.';
  $('#help-dialog').showModal();
}
async function showWorkspace(username) { $('#login').hidden = true; $('#workspace').hidden = false; $('#teacher-name').textContent = username; $('#teacher-initial').textContent = username[0]?.toUpperCase() || 'T'; await loadClassroom(); }
$('#login-form').onsubmit = async e => {
  e.preventDefault(); const button = e.submitter; button.disabled = true; $('#login-error').textContent = '';
  try { const fields = new FormData(e.target); await api('/api/login',{method:'POST',body:JSON.stringify({username:fields.get('username'),password:fields.get('password')})}); e.target.elements.password.value=''; const session = await api('/api/session'); await showWorkspace(session.username); }
  catch(error){ $('#login-error').textContent=error.message; } finally { button.disabled=false; }
};
$('#logout').onclick = async () => { try { await api('/api/logout',{method:'POST',body:'{}'}); stopAll(); $('#workspace').hidden=true; $('#login').hidden=false; } catch(error){toast(error.message);} };
$('#all-computers').onclick = () => { state.room=null; state.page=0; render(); };
$('#search').oninput = e => { state.search=e.target.value; state.page=0; render(); };
$('#prev-page').onclick = () => { state.page--; render(); };
$('#next-page').onclick = () => { state.page++; render(); };
$('#overview-refresh').onchange=event=>{
  const seconds=Number(event.target.value);
  if(!Number.isInteger(seconds)||seconds<2||seconds>3600){event.target.value=state.overviewRefreshSeconds;toast('Choose a refresh interval from 2 to 3600 seconds.');return;}
  state.overviewRefreshSeconds=seconds;try{localStorage.setItem(refreshStorageKey,String(seconds));}catch{}
  updateOverviewHint();if(state.monitoring&&!state.remote&&!document.hidden)connectOverview(currentPage());
};
for (const id of ['help-button','top-help','demo-setup']) $(`#${id}`).onclick=showHelp;
document.querySelectorAll('.close-dialog').forEach(b => b.onclick=()=>b.closest('dialog').close());
function editComputer(id) {
  if(state.demo){toast('The sample directory is read only. See Connection & help to set up your computers.');return;}
  const computer=state.computers.find(c=>c.id===id), form=$('#computer-form'); form.reset();
  for(const key of ['id','name','host','port','room','mac']) if(computer) form.elements[key].value=computer[key] ?? '';
  if(!computer) form.elements.room.value=state.room || '';
  $('#computer-dialog-title').textContent=computer?'Edit computer':'Add a computer';
  $('#delete-computer').hidden=!computer; $('#computer-error').textContent=''; $('#computer-dialog').showModal();
}
for(const id of ['add-computer','sidebar-add','empty-add']) $(`#${id}`).onclick=()=>editComputer();
async function saveRoster(values) {
  const data=await api('/api/computers',{method:'PUT',body:JSON.stringify(values)}); state.computers=data.computers;
  if(state.room && !state.computers.some(c=>c.room===state.room)) state.room=null;
  render();
}
$('#computer-form').onsubmit=async e=>{
  e.preventDefault(); const form=new FormData(e.target), id=form.get('id') || crypto.randomUUID();
  const computer={id,name:form.get('name'),host:form.get('host').trim(),port:Number(form.get('port')),room:form.get('room'),mac:form.get('mac').trim()};
  const values=[...state.computers], index=values.findIndex(c=>c.id===id); if(index<0)values.push(computer);else values[index]=computer;
  e.submitter.disabled=true;
  try{await saveRoster(values);$('#computer-dialog').close();toast('Classroom directory saved.');}catch(error){$('#computer-error').textContent=error.message;}finally{e.submitter.disabled=false;}
};
$('#delete-computer').onclick=async()=>{
  const id=$('#computer-form').elements.id.value;
  if(!confirm('Remove this computer from the directory? The computer itself will not be changed.'))return;
  try{await saveRoster(state.computers.filter(c=>c.id!==id));$('#computer-dialog').close();}catch(error){$('#computer-error').textContent=error.message;}
};
$('#roster-menu').onclick=()=>{$('#import-summary').hidden=true;$('#roster-error').textContent='';$('#roster-dialog').showModal();};
$('#export-roster').onclick=()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(state.computers,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='veyonweb.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('#import-roster').onchange=async e=>{
  $('#roster-error').textContent='';$('#import-summary').hidden=true;
  try{
    const file=e.target.files[0];if(!file)return;if(file.size>128*1024)throw new Error('Choose a directory smaller than 128 KB.');
    pendingImport=JSON.parse(await file.text());if(!Array.isArray(pendingImport))throw new Error('The file must contain a JSON array of computers.');
    $('#import-description').textContent=`Replace ${state.computers.length} computers with ${pendingImport.length} imported computers? Active connections will close.`;$('#import-summary').hidden=false;
  }catch(error){$('#roster-error').textContent=error.message;}finally{e.target.value='';}
};
$('#confirm-import').onclick=async()=>{try{await saveRoster(pendingImport);$('#roster-dialog').close();toast('Directory imported.');}catch(error){$('#roster-error').textContent=error.message;}};

async function openRemote(id, mode) {
  const computer=state.computers.find(c=>c.id===id);if(!computer)return;
  stopOverview();
  const remote={computer,mode,rfb:null,cancelled:false};state.remote=remote;
  $('#remote-name').textContent=computer.name;$('#remote-host').textContent=`${computer.host}:${computer.port} · ${computer.room}`;
  $('#remote-screen').replaceChildren();$('#remote-overlay').hidden=false;$('#remote-overlay').innerHTML='<span class="spinner"></span><strong>Connecting to computer…</strong>';
  updateRemoteToolbar();if(!$('#remote-dialog').open)$('#remote-dialog').showModal();
  try {
    if(state.demo){remote.rfb=demoScreen($('#remote-screen'),computer,mode==='control');remoteConnected(remote);return;}
    const rfb=await makeRFB(computer,$('#remote-screen'),mode);
    if(remote.cancelled || state.remote!==remote){rfb.disconnect();return;}
    remote.rfb=rfb;let reason='';
    rfb.addEventListener('connect',()=>{if(state.remote===remote)remoteConnected(remote);});
    rfb.addEventListener('securityfailure',e=>{reason=e.detail.reason||'Authentication rejected.';});
    rfb.addEventListener('disconnect',()=>{if(state.remote===remote&&!remote.cancelled)remoteFailed(reason||rfb.gatewayError||'Connection closed. Verify Veyon credentials, network access and access-control rules.');});
  }catch(error){if(state.remote===remote)remoteFailed(error.message);}
}
function remoteConnected(remote){
  $('#remote-overlay').hidden=true;$('#remote-status').textContent=state.demo?'SIMULATED SESSION · No remote computer is connected.':`Connected to ${remote.computer.name} through the local gateway`;
  $('#send-cad').disabled=remote.mode!=='control';
  if(remote.mode==='control')remote.rfb.focus?.();
}
function remoteFailed(message){
  $('#remote-overlay').hidden=false;$('#remote-overlay').innerHTML=`${icon('info')}<strong>${escapeHTML(message)}</strong><button class="button" id="remote-retry">Try again</button>`;
  $('#remote-status').textContent='Session disconnected';$('#send-cad').disabled=true;
  $('#remote-retry').onclick=()=>{const {computer,mode}=state.remote;disconnectRemote();openRemote(computer.id,mode);};
}
function updateRemoteToolbar(){
  const control=state.remote?.mode==='control';$('#remote-badge').textContent=control?'REMOTE CONTROL':'VIEW ONLY';$('#remote-badge').classList.toggle('control',control);
  $('#remote-mode').innerHTML=`${icon(control?'eye':'pointer')}<span>${control?'Switch to view only':'Enable control'}</span>`;
  $('#remote-input-note').textContent=control?'Click the screen to focus · Keyboard and mouse enabled':'View only · Keyboard and mouse disabled';$('#send-cad').disabled=true;
}
function disconnectRemote(){if(state.remote){state.remote.cancelled=true;state.remote.rfb?.disconnect();state.remote=null;}$('#remote-screen').replaceChildren();}
function closeRemote(){disconnectRemote();if($('#remote-dialog').open)$('#remote-dialog').close();}
$('#remote-close').onclick=()=>{closeRemote();render();};
$('#remote-dialog').addEventListener('cancel',e=>{e.preventDefault();closeRemote();render();});
$('#remote-mode').onclick=()=>{if(!state.remote)return;const{computer,mode}=state.remote;disconnectRemote();openRemote(computer.id,mode==='control'?'view':'control');};
$('#send-cad').onclick=()=>{if(state.remote?.mode==='control'){state.remote.rfb?.sendCtrlAltDel();state.remote.rfb?.focus?.();}};
$('#remote-fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('#remote-dialog').requestFullscreen();}catch{toast('Full screen is unavailable in this browser.');}};
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopOverview();if(state.remote?.mode==='control'){const id=state.remote.computer.id;disconnectRemote();openRemote(id,'view');}}else if(!state.remote)render();});
window.addEventListener('pagehide',stopAll);

function demoScreen(target,computer,control){
  const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=800;canvas.className='demo-canvas';canvas.tabIndex=control?0:-1;canvas.setAttribute('aria-label',control?'Simulated desktop. Type to test the keyboard interface.':'Simulated sample desktop');target.replaceChildren(canvas);
  const ctx=canvas.getContext('2d'), number=Number(computer.id.split('-')[1])||1;
  let entry='An idea starts with a question.',pointer=null,alive=true;
  const palettes=[['#d7e4d0','#76956b','#314c31'],['#e7dfd0','#ac9577','#69583f'],['#d5e4e5','#82a6a5','#3d6266'],['#e5dce6','#ac96ab','#6e516b']];
  const [background,accent,ink]=palettes[(number-1)%palettes.length];
  const rect=(x,y,w,h,color)=>{ctx.fillStyle=color;ctx.fillRect(x,y,w,h);};
  const text=(content,x,y,size=18,color=ink,weight=400)=>{ctx.fillStyle=color;ctx.font=`${weight} ${size}px -apple-system, sans-serif`;ctx.fillText(content,x,y);};
  function draw(){
    if(!alive)return;rect(0,0,1280,800,background);rect(0,0,1280,32,'#ffffffb0');text('Studio workspace',20,22,13,ink,600);text('SAMPLE SCREEN',1090,22,12,ink,600);
    rect(65,75,1150,640,'#fbfcf7');rect(65,75,1150,37,'#edf0e7');for(let i=0;i<3;i++){ctx.beginPath();ctx.fillStyle=['#bf9681','#d1bd83','#a5b587'][i];ctx.arc(85+i*17,94,5,0,Math.PI*2);ctx.fill();}rect(330,85,620,19,'#fff');text('learning.school / creative-studio',344,99,11,'#89917f');
    rect(65,112,1150,60,'#fff');text('Fieldnotes',100,150,23,ink,600);text('EXPLORE     PROJECTS     MY WORK',850,149,12,'#9ba48e');rect(65,172,1150,1,'#e4e9dc');
    if(number%3===1){
      text('CREATIVE PRACTICE / WEEK 04',105,220,12,accent,600);text('Looking at the world',105,280,40,ink,550);text('a little differently.',105,326,40,ink,550);
      text('Collect. Consider. Create.',105,378,17,'#89957b');text(entry.length>45?entry.slice(-45):entry,105,424,18,ink);rect(105,460,145,40,ink);text('Open notebook  →',121,485,13,'#fff');
      rect(725,207,420,420,background);ctx.save();ctx.translate(930,421);ctx.rotate(-.22);rect(-110,-150,190,280,accent);ctx.rotate(.48);rect(-50,-100,170,240,ink);ctx.restore();ctx.beginPath();ctx.arc(1050,300,65,0,Math.PI*2);ctx.fillStyle='#f4efd8';ctx.fill();text('01 — Shapes & stories',738,662,12,accent);
    }else if(number%3===2){
      rect(65,173,210,542,'#f2f4eb');text('MY NOTEBOOK',90,214,12,accent,600);['Overview','Research notes','Ideas & sketches','Reflection'].forEach((t,i)=>{if(i===2)rect(79,325,182,38,background);text(t,94,259+i*40,14,i===2?ink:'#9ca58f');});
      text('Ideas worth exploring',320,235,33,ink,550);text('What if we could design a better everyday?',320,275,16,'#a0a890');
      for(let i=0;i<3;i++){rect(320+i*273,320,245,235,i===1?background:'#f1f2e9');text(`0${i+1}`,338+i*273,354,13,accent,600);text(['Observe','Question','Make'][i],338+i*273,450,26,ink,500);text(['Notice the small things.','Challenge an assumption.','Give your idea a shape.'][i],338+i*273,482,12,'#87967c');}text(entry,320,612,17,ink);
    }else{
      text('A study in balance',105,238,36,ink,500);text('VISUAL JOURNAL  /  ENTRY 03',105,276,12,accent,600);
      for(let i=0;i<4;i++){let x=105+i*265;rect(x,320,237,250,i%2?background:'#eef0e5');ctx.fillStyle=i%2?ink:accent;ctx.beginPath();ctx.arc(x+118,430,70-i*7,0,Math.PI*2);ctx.fill();text(['FORM','COLOUR','SPACE','RHYTHM'][i],x+18,548,11,i%2?ink:accent,600);}text(entry,105,630,17,ink);
    }
    rect(0,766,1280,34,'#ffffff70');text(control?'SIMULATED INPUT · Click and type to try the controls':'SIMULATED CLASSROOM · no real computer connected',22,788,12,ink);
    if(pointer){ctx.beginPath();ctx.moveTo(pointer.x,pointer.y);ctx.lineTo(pointer.x+6,pointer.y+22);ctx.lineTo(pointer.x+12,pointer.y+13);ctx.lineTo(pointer.x+22,pointer.y+10);ctx.closePath();ctx.fillStyle=ink;ctx.fill();ctx.strokeStyle='#fff';ctx.stroke();}
  }
  const onKey=e=>{if(!control)return;e.preventDefault();if(e.key==='Backspace')entry=entry.slice(0,-1);else if(e.key.length===1)entry=(entry+e.key).slice(-70);else if(e.key==='Enter')entry='';draw();};
  const onPointer=e=>{if(!control)return;canvas.focus();const r=canvas.getBoundingClientRect();const scale=Math.min(r.width/1280,r.height/800);const w=1280*scale,h=800*scale;pointer={x:(e.clientX-r.left-(r.width-w)/2)/scale,y:(e.clientY-r.top-(r.height-h)/2)/scale};draw();};
  canvas.addEventListener('keydown',onKey);canvas.addEventListener('pointerdown',onPointer);draw();
  return{disconnect(){alive=false;canvas.removeEventListener('keydown',onKey);canvas.removeEventListener('pointerdown',onPointer);canvas.remove();},focus(){canvas.focus();},sendCtrlAltDel(){entry='Ctrl + Alt + Delete (simulated)';draw();}};
}

const classroomActions=setupClassroomActions({state,filtered,api,makeRFB,escapeHTML});
$('#remote-screenshot').onclick=()=>{if(state.remote)classroomActions.open('screenshot',[state.remote.computer]);};

try{
  const session=await api('/api/session');state.demo=session.demo;
  if(session.authenticated)await showWorkspace(session.username);
  else{
    $('#login').hidden=false;
    if(session.demo){$('#login-fields').hidden=true;$('#login-fields').querySelectorAll('input').forEach(i=>i.required=false);$('#login-description').textContent='Explore the sample teacher dashboard. No real computers are connected.';$('.login-submit').innerHTML='Explore sample classroom <span aria-hidden="true">↗</span>';$('#login-note').textContent='Sample mode uses simulated screens and keyboard/mouse input.';}
  }
}catch(error){$('#login').hidden=false;$('#login-error').textContent=error.message;}
