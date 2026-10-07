import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {renderBanner, APPROVED_BANNER_MODEL as model} from '../lib/banner-renderer-briefing.mjs';
import { APPROVED_BANNER_MODEL as centralModel } from '../lib/banner-approved-model.mjs';
import { WIREGEEK_CATEGORIES } from '../lib/wiregeek-categories.mjs';
const imageBuffer = await sharp({create:{width:1080,height:1350,channels:3,background:'#646080'}}).png().toBuffer();
const input = {imageBuffer, category:'GEEK', shortTitle:'OPENAI',titleMain:'OPENAI',titleTheme:'AGENTES PROFISSIONAIS',editorialCopy:'GPT-6 ASTRA SUPEROU GPT-5.6 SOL E REDUZIU O TEMPO POR TENTATIVA.'};
test('thematic reference hierarchy, clear gaps and footer safe area', async () => {
  const {layout,png} = await renderBanner(input);
  const [,main,theme,...rest] = layout.bounds;
  const copy = rest.filter(b=>b.fontSize===44);
  const brand = rest.find(b=>b.text==='BAGAÇA');
  assert.equal(main.top,826);
  assert.equal(main.fontSize,132);
  assert.equal(theme.fontSize,78);
  assert.equal(theme.top,932);
  assert.ok(main.height>=93 && main.height<=99);
  assert.equal(theme.top-main.top-main.height,11);
  assert.equal(copy[0].top,1042);
  assert.equal(copy[1].top-copy[0].top,52);
  assert.equal(brand.top,1195);
  assert.equal(1350-rest.at(-1).top-rest.at(-1).height,103);
  assert.ok(layout.bounds.every(b=>b.width<=950 && b.left>=0));
  const {data,info}=await sharp(png).raw().toBuffer({resolveWithObject:true});
  const pixel=(x,y)=>Array.from(data.subarray((y*info.width+x)*info.channels,(y*info.width+x)*info.channels+3));
  assert.notDeepEqual(pixel(540,1000),[255,151,0], 'clear gap between theme and copy');
  assert.deepEqual(pixel(100,1209),[255,151,0], 'footer divider preserved');
  assert.equal(model.shortTitle.autoScale,false);
  assert.equal(model.editorial.autoScale,false);
});

test('one immutable global model locks approved thematic metrics', () => {
  assert.equal(model,centralModel);
  for (const value of [model,...Object.values(model).filter(v=>v && typeof v==='object')]) {
    assert.ok(Object.isFrozen(value));
  }
  assert.deepEqual(model.thematicTitle,{
    mainTop:826,mainFontSize:132,mainLetterSpacing:-2,mainWordGap:18,
    themeTop:932,themeFontSize:78,themeLetterSpacing:-2,maxWidth:950,
    autoScale:false,titleGap:11,firstEditorialLineTop:1042,maxEditorialLines:3,
    bottomSafeArea:103,intermediateDivider:false,editorialTop:986,brandTop:1195,studiosTop:1235,
  });
  assert.deepEqual(model.colors,{black:'#000000',white:'#FFFFFF',orange:'#FF9700'});
  assert.throws(()=>{model.thematicTitle.mainTop=785;},TypeError);
});

test('every editorial category shares geometry, including one and three copy lines', async () => {
  const copies = ['UMA NOVA ERA.', 'GPT-6 ASTRA SUPEROU GPT-5.6 SOL E REDUZIU O TEMPO POR TENTATIVA. MAIS DETALHES CHEGAM EM BREVE.'];
  for (const category of WIREGEEK_CATEGORIES) {
    for (const editorialCopy of copies) {
      const {layout} = await renderBanner({...input,category,editorialCopy});
      const copy = layout.bounds.filter(b=>b.fontSize===44);
      assert.equal(copy.length,editorialCopy===copies[0]?1:3);
      assert.equal(copy[0].top,1042);
      assert.ok(copy.every((b,i)=>b.top===1042+i*52 && b.top+b.height<=1181 && b.width<=950));
      assert.equal(layout.bounds[1].top,826);
      assert.equal(layout.bounds[2].top,932);
      assert.equal(layout.bounds.find(b=>b.text==='BAGAÇA').top,1195);
    }
  }
});
test('width overflow retains field-specific retry errors', async () => {
  for (const [field,code] of [['titleMain','TITLE_MAIN_TOO_WIDE'],['titleTheme','TITLE_THEME_TOO_WIDE']]) {
    await assert.rejects(renderBanner({...input,[field]:'EXCESSIVAMENTE LARGO '.repeat(8)}),e=>e.code===code);
  }
});
test('legacy layout retains positions; thematic overflow fails instead of scaling', async () => {
  const {layout}=await renderBanner({...input,titleMain:'',titleTheme:''});
  assert.equal(layout.bounds.find(b=>b.fontSize===100).top,835);
  assert.equal(layout.bounds.find(b=>b.text==='BAGAÇA').top,1260);
  await assert.rejects(renderBanner({...input,editorialCopy:'UMA NOTICIA COM MUITOS DETALHES IMPORTANTES PARA O PUBLICO. '.repeat(3)}),e=>e.code==='COPY_TOO_LONG');
});
