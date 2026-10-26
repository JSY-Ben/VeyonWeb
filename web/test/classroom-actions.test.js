import test from 'node:test';
import assert from 'node:assert/strict';
import {setupClassroomActions} from '../public/classroom-actions.js';

test('action buttons open the matching popup and respect selection and permissions',()=>{
  const previous=globalThis.document;
  const actions=['message','lock','unlock','website','program','screenshot','files','wake','reboot','shutdown','logoff'];
  const buttons=actions.map(action=>({dataset:{classroomAction:action}}));
  const elements=new Map();
  const element=selector=>{
    if(!elements.has(selector))elements.set(selector,{textContent:'',value:'',hidden:false,disabled:false,required:false,
      replaceChildren(){},addEventListener(){},reset(){},showModal(){this.open=true;},close(){this.open=false;},querySelectorAll(){return [];}});
    return elements.get(selector);
  };
  const fields=['message','website','program','files'].map(action=>({dataset:{actions:action},inputs:[{}],querySelectorAll(){return this.inputs;}}));
  element('#action-form').querySelectorAll=selector=>selector==='[data-actions]'?fields:[];
  globalThis.document={querySelector:element,querySelectorAll:selector=>selector==='[data-classroom-action]'?buttons:[]};
  try{
    const computers=[{id:'one',name:'PC One'},{id:'two',name:'PC Two'}];
    const state={computers,canManage:true,demo:false};
    const controller=setupClassroomActions({state,filtered:()=>computers,api(){throw new Error('Opening a popup must not send commands.');},makeRFB(){},escapeHTML:value=>value});
    controller.refresh();assert.ok(buttons.every(button=>button.disabled));
    element('#select-classroom').onclick();assert.ok(buttons.every(button=>!button.disabled&&!button.hidden));
    assert.equal(element('#selection-count').textContent,'2 selected');
    for(const button of buttons){
      button.onclick();const action=button.dataset.classroomAction;
      assert.equal(element('#action-dialog').open,true);
      assert.equal(element('#action-kind').value,action);
      assert.equal(element('#action-title').textContent,element('#action-submit').textContent);
      assert.match(element('#action-targets').textContent,/2 computers: PC One, PC Two/);
      assert.equal(element('#action-confirm').required,['reboot','shutdown','logoff'].includes(action));
      for(const field of fields){
        assert.equal(field.hidden,field.dataset.actions!==action);
        assert.equal(field.inputs[0].disabled,field.hidden);
      }
      element('#action-close').onclick();assert.equal(element('#action-dialog').open,false);
    }
    state.canManage=false;controller.refresh();
    assert.deepEqual(buttons.filter(button=>!button.hidden).map(button=>button.dataset.classroomAction),['screenshot']);
    element('#clear-selection').onclick();assert.ok(buttons.every(button=>button.disabled));
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
