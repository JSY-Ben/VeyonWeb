const $=selector=>document.querySelector(selector);
const labels={overview_refresh_seconds:'Default refresh interval (seconds)',overview_max_connections:'Maximum simultaneous previews',overview_stagger_ms:'Gap between starts (milliseconds)',overview_retry_seconds:'Retry unavailable PCs (seconds)',connection_timeout_seconds:'Gateway TCP timeout (seconds)',preview_timeout_seconds:'Preview / authentication timeout (seconds)'};
const ranges={overview_refresh_seconds:[2,3600],overview_max_connections:[1,10],overview_stagger_ms:[0,10000],overview_retry_seconds:[2,3600],connection_timeout_seconds:[1,120],preview_timeout_seconds:[1,120]};

export function setupAdminSettings({state,api,escapeHTML,onSessionRevoked,onSettingsChanged}){
  const dialog=$('#settings-dialog'),form=$('#user-form');let users=[],rooms=[],editing=null;
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
    $('#settings-error').textContent='';$('#settings-saved').textContent='';dialog.showModal();
    try{
      const [userData,settingsData]=await Promise.all([api('/api/users'),api('/api/settings')]);
      if(!dialog.open||!state.canManage)return;
      $('#masteradmin-info').textContent=userData.masterAdmin?`Master administrator: ${userData.masterAdmin.username}. This backup account is managed in config/local.php and always has full access.`:'No master administrator configured in local.php.';
      users=userData.users;rooms=userData.classrooms;renderUsers();resetUser();
      $('#settings-error').textContent=settingsData.notice||'';
      $('#web-setting-fields').innerHTML=Object.entries(settingsData.settings).map(([name,value])=>`<label>${labels[name]}<input type="number" name="${name}" value="${value}" min="${ranges[name][0]}" max="${ranges[name][1]}" step="1" required></label>`).join('');
    }catch(error){$('#settings-error').textContent=error.message;}
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
    try{await api('/api/settings',{method:'PUT',body:JSON.stringify(values)});await onSettingsChanged();$('#settings-saved').textContent='Saved to local.php. New connections use these settings.';}
    catch(error){$('#settings-error').textContent=error.message;}finally{button.disabled=false;}
  };
  $('#settings-button').onclick=open;$('#settings-close').onclick=close;
  dialog.addEventListener('close',()=>{form.elements.password.value='';});
  return {close};
}
