import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
if(process.env.SP_SKIN_E2E!=='1')process.exit(0);
const browser=await puppeteer.connect({browserURL:process.env.SP_CDP||'http://127.0.0.1:9223',protocolTimeout:60000});
const context=await browser.createBrowserContext(); const page=await context.newPage();
try {
 await page.setViewport({width:1280,height:800});
 await page.evaluateOnNewDocument(()=>{localStorage.setItem('sp.name','皮肤界面专项');sessionStorage.setItem('sp.entered','1');localStorage.setItem('sp.lang','zh');});
 await page.goto(process.env.SP_URL||'http://127.0.0.1:3001',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>globalThis.__SP__?.store.get().connection.status==='online');
 await page.evaluate(async()=>{const ui=await import('/js/ui/loadoutSync.js'); ui.openLoadout('lobby','chess_char_498_inside_a');});
 await page.waitForSelector('.lo-detail',{timeout:30000});
 assert.ok(await page.$('.skin-picker'),'normal roster detail must mount a skin picker');
 console.log('PASS actual normal roster skin picker mounted');
} finally {await context.close();browser.disconnect();}
