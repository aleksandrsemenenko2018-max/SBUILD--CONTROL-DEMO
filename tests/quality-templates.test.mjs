import test from 'node:test';
import assert from 'node:assert/strict';
import {templates,createChecklist,nextStep,isComplete} from '../modules/quality-templates.js';
for(const [key,labels] of Object.entries(templates)){
 test('checklist '+key,()=>{
  assert.ok(labels.length>0);
  assert.equal(new Set(labels).size,labels.length);
  const items=createChecklist(key);
  assert.equal(items.length,labels.length);
  assert.equal(isComplete(items),false);
  assert.equal(nextStep(items).id,1);
  for(const item of items)item.completed=true;
  assert.equal(isComplete(items),true);
  assert.equal(nextStep(items),null);
  assert.equal(createChecklist(key)[0].completed,false);
 });
}
test('reject invalid checklist',()=>{assert.equal(isComplete([]),false);assert.equal(isComplete([{}]),false);assert.equal(isComplete([null]),false);assert.throws(()=>createChecklist('unknown'));});
