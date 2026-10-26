import test from 'node:test';
import assert from 'node:assert/strict';
const previous=globalThis.window;
globalThis.window={matchMedia:()=>({matches:false,addEventListener(){}})};
const {colourTokens}=await import('../public/appearance.js');
if(previous===undefined)delete globalThis.window;else globalThis.window=previous;
function luminance(hex){return [1,3,5].map(i=>{const c=parseInt(hex.slice(i,i+2),16)/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);}
function contrast(a,b){const values=[luminance(a),luminance(b)].sort((a,b)=>b-a);return (values[0]+.05)/(values[1]+.05);}
test('custom primary colours retain readable button text, including on hover',()=>{
  for(const colour of ['#ffffff','#000000','#ffd900','#7850c8','#215c48','#ff0000','#00ff00','#0000ff','#747474','#777777']){
    const tokens=colourTokens(colour);
    assert.ok(contrast(tokens.primary,tokens.onPrimary)>=4.5,colour+' normal');
    assert.ok(contrast(tokens.hover,tokens.onPrimary)>=4.5,colour+' hover');
  }
  assert.equal(colourTokens('invalid').primary,'#215c48');
});
