import {applyAppearance,defaultAppearance} from './appearance.js?v=appearance-20261026';
const $=selector=>document.querySelector(selector);
const labels={gateway_workers:'Gateway processes (restart gateway to apply)',overview_refresh_seconds:'Default refresh interval (seconds)',overview_max_connections:'Maximum simultaneous previews',overview_stagger_ms:'Gap between starts (milliseconds)',overview_retry_seconds:'Retry unavailable PCs (seconds)',connection_timeout_seconds:'Gateway TCP timeout (seconds)',preview_timeout_seconds:'Preview / authentication timeout (seconds)'};
const descriptions={
  gateway_workers:'How many server processes handle remote sessions and desktop previews. More processes can help busy classrooms, but use more server memory. Restart veyon-gateway after changing this.',
  overview_refresh_seconds:'How long to wait after a successful desktop picture before updating that computer again. Lower values show newer pictures and use more network and server resources. Each browser can choose its own interval.',
  overview_max_connections:'How many desktop pictures one browser can capture at the same time. Higher values can load the classroom faster, but put more load on the server and network.',
  overview_stagger_ms:'The minimum gap between starting desktop captures in one browser. 1,000 milliseconds is one second. A larger gap spreads out connection requests; zero allows them to start together, up to the simultaneous preview limit.',
  overview_retry_seconds:'How long to wait before trying a computer again after a failed preview. Larger values reduce repeated requests to unavailable computers. A first connection timeout gets one earlier retry.',
  connection_timeout_seconds:'How long the server waits to make the initial network connection to a computer. Increase this if computers on a slow network are being marked unavailable too quickly.',
  preview_timeout_seconds:'How long to allow a remote session or preview to connect and authenticate. Desktop previews then get the same amount of time again to receive their first picture. Increase this for slow computers; lower values report failures sooner.',
};
const ranges={gateway_workers:[1,16],overview_refresh_seconds:[2,3600],overview_max_connections:[1,10],overview_stagger_ms:[0,10000],overview_retry_seconds:[2,3600],connection_timeout_seconds:[1,120],preview_timeout_seconds:[1,120]};

export function setupAdminSettings({state,api,escapeHTML,onSessionRevoked,onSettingsChanged}){
  const dialog=$('#settings-dialog'),form=$('#user-form');let users=[],rooms=[],editing=null,appearance={...defaultAppearance};
  function resetUser(){
    editing=null;form.reset();form.elements.username.disabled=false;form.elements.password.required=true;
    form.elements.role.value='teacher';form.elements.enabled.checked=true;
    $('#user-form-title').textContent='Create user';$('#user-save').textContent='Create user';$('#user-error').textContent='';renderRooms();
  }
  function renderRooms(selected=[]){
    const teacher=form.elements.role.value==='teacher';$('#user-rooms').hidden=!teacher;
    $('#user-room-options').innerHTML=rooms.map(room=>`<label class="check-label"><input type="checkbox" name="classrooms" value="${escapeHTML(room)}" ${selected.includes(room)?'checked':''} ${teacher?'':'disabled'}>${escapeHTML(room)}</label>`).join('');
    $('#user-no-rooms').hidden=rooms.length>0;
  }
  function renderUsers(){
    $('#users-list').innerHTML=users.map(user=>`<tr><td><strong>${escapeHTML(user.username)}</strong>${user.id===state.userId?' <small>(you)</small>':''}${user.reserved?' <small>Reserved by config master; database login unavailable</small>':''}${user.enabled?'':' <small>Disabled</small>'}</td><td>${escapeHTML(user.role)}</td><td>${user.role==='teacher'?(user.classrooms.length?user.classrooms.map(escapeHTML).join(', '):'No classrooms'):'All classrooms'}</td><td><button type="button" class="button secondary user-edit" ${user.reserved?'disabled':''} aria-label="Edit ${escapeHTML(user.username)}" data-id="${user.id}">Edit</button><button type="button" class="button danger user-delete" aria-label="Delete ${escapeHTML(user.username)}" data-id="${user.id}">Delete</button></td></tr>`).join('');
    document.querySelectorAll('.user-edit').forEach(button=>button.onclick=()=>{
      const user=users.find(user=>user.id===Number(button.dataset.id));editing=user.id;form.reset();
      form.elements.username.value=user.username;form.elements.username.disabled=true;
      form.elements.role.value=user.role;form.elements.enabled.checked=user.enabled;form.elements.password.required=false;
      $('#user-form-title').textContent=`Edit ${user.username}`;$('#user-save').textContent='Save user';$('#user-error').textContent='';renderRooms(user.classrooms);
      form.scrollIntoView({behavior:'smooth',block:'nearest'});
    });
    document.querySelectorAll('.user-delete').forEach(button=>button.onclick=async()=>{
      const user=users.find(user=>user.id===Number(button.dataset.id));
      if(!confirm(`Delete ${user.username}? Their active sessions will end.`))return;
      button.disabled=true;$('#settings-error').textContent='';
      try{
        const result=await api('/api/users',{method:'DELETE',body:JSON.stringify({id:user.id})});
        if(result.sessionRevoked){close();onSessionRevoked();return;}
        await loadUsers();resetUser();
      }catch(error){$('#settings-error').textContent=error.message;button.disabled=false;}
    });
  }
  async function loadUsers(){const data=await api('/api/users');if(!dialog.open||!state.canManage)return;users=data.users;rooms=data.classrooms;renderUsers();}
  async function open(){
    if(!state.canManage)return;
    $('#settings-error').textContent='';$('#settings-saved').textContent='';dialog.setAttribute('aria-busy','true');
    dialog.querySelectorAll('[data-settings-section]').forEach(section=>section.inert=true);dialog.showModal();
    try{
      const [userData,settingsData]=await Promise.all([api('/api/users'),api('/api/settings')]);
      if(!dialog.open||!state.canManage)return;
      $('#masteradmin-info').textContent=userData.masterAdmin?`Master administrator: ${userData.masterAdmin.username}. This backup account is managed in config/local.php and always has full access.`:'No master administrator configured in local.php.';
      users=userData.users;rooms=userData.classrooms;renderUsers();resetUser();
      $('#settings-error').textContent=settingsData.notice||'';
      appearance={...defaultAppearance,...Object.fromEntries(Object.keys(defaultAppearance).map(name=>[name,settingsData.settings[name]??defaultAppearance[name]]))};
      const appearanceForm=$('#appearance-form');for(const name of ['app_name','primary_colour','theme'])appearanceForm.elements[name].value=appearance[name];
      renderImages();
      $('#web-setting-fields').innerHTML=Object.entries(settingsData.settings).filter(([name])=>ranges[name]).map(([name,value])=>`<label>${labels[name]}<input type="number" name="${name}" value="${value}" min="${ranges[name][0]}" max="${ranges[name][1]}" step="1" aria-describedby="setting-help-${name}" required><small id="setting-help-${name}">${descriptions[name]}</small></label>`).join('');
    }catch(error){$('#settings-error').textContent=error.message;}finally{dialog.removeAttribute('aria-busy');dialog.querySelectorAll('[data-settings-section]').forEach(section=>section.inert=false);}
  }
  function close(){if(dialog.open)dialog.close();form.reset();users=[];rooms=[];$('#users-list').replaceChildren();}
  form.onsubmit=async event=>{
    event.preventDefault();const button=$('#user-save');button.disabled=true;$('#user-error').textContent='';
    const input={username:form.elements.username.value,role:form.elements.role.value,enabled:form.elements.enabled.checked,password:form.elements.password.value,classrooms:[...form.querySelectorAll('input[name="classrooms"]:checked')].map(input=>input.value)};
    if(editing!==null)input.id=editing;
    try{
      const result=await api('/api/users',{method:editing===null?'POST':'PUT',body:JSON.stringify(input)});
      form.elements.password.value='';
      if(result.sessionRevoked){close();onSessionRevoked();return;}
      await loadUsers();resetUser();$('#settings-saved').textContent='User saved. Changed permissions and passwords end that user’s sessions.';
    }catch(error){$('#user-error').textContent=error.message;}finally{button.disabled=false;}
  };
  form.elements.role.onchange=()=>renderRooms([...form.querySelectorAll('input[name="classrooms"]:checked')].map(input=>input.value));
  $('#new-user').onclick=resetUser;
  $('#web-settings-form').onsubmit=async event=>{
    event.preventDefault();const button=$('#web-settings-save');button.disabled=true;$('#settings-error').textContent='';$('#settings-saved').textContent='';
    const values=Object.fromEntries([...new FormData(event.target)].map(([key,value])=>[key,Number(value)]));
    try{await api('/api/settings',{method:'PUT',body:JSON.stringify(values)});await onSettingsChanged();$('#settings-saved').textContent='Settings saved. Connection settings apply to new connections. If you changed Gateway processes, restart veyon-gateway on the server to apply the process count.';}
    catch(error){$('#settings-error').textContent=error.message;}finally{button.disabled=false;}
  };
  document.querySelectorAll('[data-settings-tab]').forEach(button=>button.onclick=()=>{
    document.querySelectorAll('[data-settings-tab]').forEach(tab=>tab.setAttribute('aria-pressed',String(tab===button)));
    document.querySelectorAll('[data-settings-section]').forEach(section=>section.hidden=section.dataset.settingsSection!==button.dataset.settingsTab);
  });
  function renderImages(){
    for(const [key,prefix] of [['app_logo','logo'],['login_graphic','graphic']]){
      const image=$(`#${prefix}-preview`);image.hidden=!appearance[key];$(`#${prefix}-default`).hidden=!!appearance[key];
      if(appearance[key])image.src=appearance[key];else image.removeAttribute('src');
    }
  }
  for(const [key,prefix] of [['app_logo','logo'],['login_graphic','graphic']]){
    $(`#${prefix}-upload`).onchange=async event=>{
      const file=event.target.files[0];if(!file)return;
      $('#appearance-error').textContent='';const save=$('#appearance-save');save.disabled=true;
      try{
        if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>262144)throw new Error('Choose a PNG, JPEG or WebP image up to 256 KB.');
        const url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read this image.'));reader.readAsDataURL(file);});
        const image=new Image();image.src=url;await image.decode();
        if(image.naturalWidth>8192||image.naturalHeight>8192)throw new Error('Images must be 8192 pixels or smaller on each side.');
        appearance[key]=url;renderImages();
      }catch(error){$('#appearance-error').textContent=error.message;}finally{event.target.value='';save.disabled=false;}
    };
    $(`#${prefix}-remove`).onclick=()=>{appearance[key]='';renderImages();};
  }
  $('#appearance-form').onsubmit=async event=>{
    event.preventDefault();const button=$('#appearance-save');button.disabled=true;$('#appearance-error').textContent='';$('#settings-saved').textContent='';
    const form=event.target,values={...appearance,app_name:form.elements.app_name.value.trim(),primary_colour:form.elements.primary_colour.value,theme:form.elements.theme.value};
    try{
      const result=await api('/api/settings',{method:'PUT',body:JSON.stringify(values)});
      appearance={...values};applyAppearance(result.settings);$('#settings-saved').textContent='Appearance saved for everyone.';
    }catch(error){$('#appearance-error').textContent=error.message;}finally{button.disabled=false;}
  };
  $('#settings-button').onclick=open;$('#settings-close').onclick=close;
  dialog.addEventListener('close',()=>{form.elements.password.value='';});
  return {close};
}
