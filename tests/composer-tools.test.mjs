import test from 'node:test';
import assert from 'node:assert/strict';
import '../app/static/composer-tools.js';

const tools = globalThis.composerTools;
function paste(file, blocked=false) {
  let prevented=false, selected=null, error='';
  const event = {clipboardData:{items:file ? [{kind:'file',type:file.type,getAsFile:() => file}] : [{kind:'string',type:'text/plain'}]},preventDefault:() => {prevented=true;}};
  const handled = tools.handlePaste(event, {blocked,error:value => {error=value;},select:value => {selected=value;}});
  return {handled,prevented,selected,error};
}
test('picked and pasted images share format, size and empty-file validation', () => {
  for (const type of ['image/png','image/jpeg','image/webp','image/gif']) {
    assert.equal(tools.imageError({type,size:1}), '');
    assert.equal(tools.imageError({type,size:5 * 1024 * 1024}), '');
  }
  assert.match(tools.imageError({type:'image/png',size:5 * 1024 * 1024 + 1}), /5 MB/);
  assert.match(tools.imageError({type:'image/svg+xml',size:20}), /PNG/);
  assert.match(tools.imageError({type:'text/plain',size:20}), /PNG/);
  for (const size of [0,-1,NaN,Infinity,undefined]) {
    assert.match(tools.imageError({type:'image/png',size}), /empty/);
  }
  assert.match(tools.imageError(null), /PNG/);
});
test('clipboard text and links are not treated as image attachments', () => {
  assert.equal(tools.pastedImage(null), null);
  assert.equal(tools.pastedImage({items:[]}), null);
  assert.equal(tools.pastedImage({items:[{kind:'string',type:'text/plain'}]}), null);
  assert.equal(tools.pastedImage({items:[{kind:'file',type:'application/pdf'}]}), null);
});
test('clipboard images are selected without reading text, sending or uploading', () => {
  const image = {type:'image/png',size:30};
  const items = [
    {kind:'string',type:'text/html'},
    {kind:'file',type:'image/png',getAsFile:() => null},
    {kind:'file',type:'image/png',getAsFile:() => image},
  ];
  assert.equal(tools.pastedImage({items}), image);
  assert.equal(tools.pastedImage({items:[{kind:'file',type:'image/svg+xml',getAsFile:() => ({type:'image/svg+xml',size:30})}]}).type, 'image/svg+xml');
});
test('image pasting previews one attachment without interfering with text pastes', () => {
  const file = {type:'image/png',size:30};
  assert.deepEqual(paste(file), {handled:true,prevented:true,selected:file,error:''});
  assert.deepEqual(paste(null), {handled:false,prevented:false,selected:null,error:''});
});
test('blocked, oversized and unsupported pastes never replace the selected image', () => {
  for (const [file,blocked,expected] of [
    [{type:'image/png',size:30},true,/Wait until/],
    [{type:'image/png',size:6*1024*1024},false,/5 MB/],
    [{type:'image/svg+xml',size:30},false,/PNG/],
  ]) {
    const result = paste(file,blocked);
    assert.equal(result.handled,true);
    assert.equal(result.prevented,true);
    assert.equal(result.selected,null);
    assert.match(result.error,expected);
  }
});
