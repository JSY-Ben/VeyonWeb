import test from 'node:test';
import assert from 'node:assert/strict';
import {classroomFromURL,classroomURL} from '../public/classroom-url.js';
const href='https://school.example/Web/VeyonWeb/web/public/?other=keep#overview';
const room='Art & Design / Études + 1';
const computers=[{room},{room:'Computing'}];
test('classroom links round-trip names and retain the installation path and other URL state',()=>{
  const url=classroomURL(href,room);
  assert.equal(url.pathname,new URL(href).pathname);assert.equal(url.searchParams.get('other'),'keep');assert.equal(url.hash,'#overview');
  assert.equal(classroomFromURL(url.href,computers),room);
  assert.equal(classroomURL(url.href,null).href,href);
});
test('refresh and browser history restore each selected classroom from its URL',()=>{
  const first=classroomURL(href,room),second=classroomURL(first.href,'Computing');
  assert.equal(classroomFromURL(second.href,computers),'Computing');
  assert.equal(classroomFromURL(first.href,computers),room);
  assert.equal(classroomFromURL(href,computers),null);
});
test('deleted, unknown and inaccessible classrooms fall back to all accessible computers',()=>{
  const url=classroomURL(href,room);
  assert.equal(classroomFromURL(url.href,[{room:'Computing'}]),null);
  assert.equal(classroomFromURL(url.href,[]),null);
  assert.equal(classroomFromURL(classroomURL(href,'Missing').href,computers),null);
});
