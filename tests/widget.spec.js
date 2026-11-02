import {test,expect} from '@playwright/test';
import {startServer} from './server.js';
import Ajv from 'ajv/dist/2020.js';
import {readFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
let server,base;
test.beforeAll(async()=>{({server,base}=await startServer());});
test.afterAll(()=>server.close());
async function load(page,config={},csp=0){
  await page.addInitScript(cfg=>{window.__violations=[];window.addEventListener('securitypolicyviolation',e=>window.__violations.push(e.violatedDirective+':'+e.blockedURI));window.AnnotateHtmlConfig=cfg;},config);
  await page.goto(base+'/fixture?csp='+csp);await expect.poll(()=>page.evaluate(()=>!!window.__annotateHtml)).toBe(true);
}
const schema=JSON.parse(readFileSync('schema/feedback-v1.schema.json','utf8'));
const validate=new Ajv({strict:false,formats:{uuid:/^[0-9a-f-]{36}$/i,'date-time':/^\d{4}-/}}).compile(schema);
for(let i=0;i<3;i++)test('shadow render and CSP policy '+i,async({page})=>{
  await load(page,{endpoint:'/submit'},i);
  const root=page.locator('annotate-html-widget');await expect(root.locator('#ann-toolbar')).toBeVisible();
  await expect(root.locator('#ann-submit-btn')).toBeVisible();
  expect(await page.evaluate(()=>window.__violations)).toEqual([]);
});
test('hostile CSS cannot hide widget',async({page})=>{
  await load(page);const button=page.locator('annotate-html-widget').locator('#ann-toggle-btn');
  const before=await button.evaluate(el=>({display:getComputedStyle(el).display,size:getComputedStyle(el).fontSize}));
  await page.evaluate(()=>{const sheet=new CSSStyleSheet();sheet.replaceSync('* { all: unset !important } button { display:none !important } div { font-size:40px !important }');document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet]});
  expect(await button.evaluate(el=>({display:getComputedStyle(el).display,size:getComputedStyle(el).fontSize}))).toEqual(before);
});
test('UI annotation, markdown, multipart and schema',async({page})=>{
  await load(page,{endpoint:'/submit'});const root=page.locator('annotate-html-widget');
  await root.locator('#ann-toggle-btn').click();await page.locator('#target').click();
  await root.locator('#ann-popup textarea').fill('Fix save');await root.locator('#ann-popup button.primary').click();
  const payload=await page.evaluate(()=>window.__annotateHtml.buildPayload({kind:'bug'}));
  expect(validate(payload.payload),JSON.stringify(validate.errors)).toBe(true);expect(payload.payload.markdown).toContain('Fix save');
  await root.locator('#ann-submit-btn').click();await root.locator('#ann-popup input[aria-label="Title"]').fill('Save broken');
  await root.locator('#ann-popup button.primary').click();await expect(root.locator('#ann-submit-status')).toContainText('Received');
  expect(server.lastBody).toContain('annotate-html/feedback@1');expect(server.lastBody).toContain('Fix save');
});
test('headless API, hook, error and network context',async({page})=>{
  await load(page,{ui:false,clearOnSubmit:false});
  const result=await page.evaluate(async()=>{
    const api=window.__annotateHtml;console.error('example failure');await fetch('/missing?token=private&view=public');
    await api.annotate({target:'#target',comment:'Agent finding',screenshot:false});
    const built=await api.buildPayload({kind:'agent',reporter:{type:'agent',name:'QA'}});
    api.configure({onSubmit:async(payload,files)=>({message:payload.kind+' '+Object.keys(files).length})});
    const submitted=await api.submit({kind:'agent',reporter:{type:'agent'}});return {payload:built.payload,submitted,count:api.list().length};
  });
  expect(validate(result.payload),JSON.stringify(validate.errors)).toBe(true);
  expect(result.payload.console.some(x=>x.message.includes('example failure'))).toBe(true);
  expect(result.payload.network.some(x=>x.status===404 && !x.url.includes('private') && x.url.includes('view=public'))).toBe(true);
  expect(result.payload.reporter.type).toBe('agent');expect(result.submitted.message).toBe('agent 0');expect(result.count).toBe(1);
  await expect(page.locator('annotate-html-widget').locator('#ann-toolbar')).toHaveCount(0);
});
test('extension mode hides Submit',async({page})=>{await load(page);await expect(page.locator('annotate-html-widget').locator('#ann-submit-btn')).toHaveCount(0);});
test('screenshot under strict CSP',async({page})=>{
  await load(page,{screenshot:false},0);
  const result=await page.evaluate(async()=>{const a=await window.__annotateHtml.annotate({target:'#target',comment:'Screenshot',screenshot:true});const built=await window.__annotateHtml.buildPayload();const blob=built.files['screenshot-'+a.id];const bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);const r=document.querySelector('#secret').getBoundingClientRect(),x=Math.floor(r.left-a.screenshot.region.x+10),y=Math.floor(r.top-a.screenshot.region.y+10);return {shot:a.screenshot,blob:blob.size,pixel:[...ctx.getImageData(x,y,1,1).data],pixel2:[...ctx.getImageData(x+4,y+4,1,1).data],violations:window.__violations};});
  expect(result.blob).toBeGreaterThan(100);expect(result.shot.width).toBeGreaterThan(0);
  expect(result.pixel).toEqual([34,34,34,255]);expect(result.pixel2).toEqual(result.pixel);expect(result.violations).toEqual([]);
});

test('capture widget states',async({page})=>{
  await load(page,{endpoint:'/submit',screenshot:true});
  const dir=join(process.env.TMPDIR,'annotate-shots');mkdirSync(dir,{recursive:true});
  const root=page.locator('annotate-html-widget');
  await page.screenshot({path:join(dir,'toolbar.png')});
  await page.evaluate(()=>window.__annotateHtml.annotate({target:'#target',comment:'Please improve this',screenshot:true}));
  await root.locator('.ann-marker').click();await expect(root.locator('.ann-preview')).toBeVisible();
  await page.waitForTimeout(300);await page.screenshot({path:join(dir,'popup.png')});
  await root.locator('#ann-popup button').last().click();
  await root.locator('#ann-submit-btn').click();await expect(root.locator('#ann-popup.ann-submit-form')).toBeVisible();await page.waitForTimeout(300);await page.screenshot({path:join(dir,'submit.png')});
});
