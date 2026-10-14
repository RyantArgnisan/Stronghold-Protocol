// Opt-in real UI + server + renderer verification. Never targets production by default.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { writeFile } from 'node:fs/promises';
if(process.env.SP_SKIN_E2E!=='1') process.exit(0);
const base=process.env.SP_URL||'http://127.0.0.1:3001',out=process.env.SP_SMOKE_OUT||'/scratch';
const browser=await puppeteer.connect({browserURL:process.env.SP_CDP||'http://127.0.0.1:9223',protocolTimeout:90000});
const contexts=[],pages=[],checks=[],evidence=[];
const mark=n=>{checks.push(n);console.log('PASS '+n);};
const req=(p,t,f={})=>p.evaluate((t,f)=>__SP__.net.request(t,f),t,f);
const state=p=>p.evaluate(()=>{const s=__SP__.store.get();return {me:s.me.playerId,room:s.room,pub:s.match.public,priv:s.match.private,field:s.match.field};});
const phase=(p,v)=>p.waitForFunction(v=>__SP__.store.get().match.public?.phase===v,{timeout:45000},v);
async function player(name){
 const c=await browser.createBrowserContext();contexts.push(c);const p=await c.newPage();pages.push(p);p.problems=[];
 p.on('pageerror',e=>p.problems.push(e.message));
 p.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)p.problems.push(`${r.status()} ${r.url()}`);});
 await p.setViewport({width:1280,height:800});
 await p.evaluateOnNewDocument(name=>{localStorage.setItem('sp.name',name);localStorage.setItem('sp.lang','zh');sessionStorage.setItem('sp.entered','1');},name);
 await p.goto(base+'/?render=engine',{waitUntil:'domcontentloaded'});
 try { await p.waitForFunction(()=>globalThis.__SP__?.store.get().connection.status==='online',{timeout:45000}); }
 catch(e){console.error('PLAYER BOOT',p.problems,await p.evaluate(()=>({text:document.body.innerText.slice(0,2000),sp:!!globalThis.__SP__})));throw e;}return p;
}
async function rendered(p,skin,prep=true){
 await p.bringToFront();
 await p.waitForFunction((skin,prep)=>{const R=globalThis.__SP_VIEW__?.raw;
  return !!R?.debug && [...R.debug.views.values()].some(v=>v.info?.skin===skin&&v.actor&&v.spineReady&&v.entry?.skel?.startsWith('/assets/skins/'));
 },{timeout:45000},skin,prep);
 const e=await p.evaluate(skin=>{const R=__SP_VIEW__.raw,v=[...R.debug.views.values()].find(v=>v.info?.skin===skin&&v.actor&&v.spineReady);
  const rd=R.debug.app.renderer,gl=rd.gl;R.debug.ctx.impostors?.flush?.();
  const w=rd.view.width,h=rd.view.height,read=()=>{rd.render(R.debug.app.stage);const a=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,a);return a;};
  const before=read();v.root.visible=false;const after=read();v.root.visible=true;let diff=0;for(let i=0;i<before.length;i+=4)if(Math.abs(before[i]-after[i])+Math.abs(before[i+1]-after[i+1])+Math.abs(before[i+2]-after[i+2])>30)diff++;
  const slots=v.actor.spine.skeleton.slots;const textures=slots.filter(s=>s.currentSprite?.texture||s.currentMesh?.texture).map(s=>(s.currentSprite||s.currentMesh).texture);
  return {skin:v.info.skin,skel:v.entry.skel,actor:!!v.actor,changedPixels:diff,textures:textures.length,valid:textures.every(t=>!t.destroyed&&!t.baseTexture.destroyed&&t.baseTexture.valid),kind:v.info.kind,defId:v.info.defId};
 },skin);
 assert.ok(e.valid&&e.textures>0&&e.changedPixels>40,JSON.stringify(e));evidence.push(e);return e;
}
try{
 const host=await player('皮肤验证房主'),guest=await player('皮肤验证队友');
 const assets=await (await fetch(base+'/data/skins-assets.json')).json();
 const chess=await (await fetch(base+'/data/chess.json')).json();
 const choices=Object.fromEntries(Object.entries(assets.chars).map(([char,r])=>[char,Object.keys(r.skins)[0]]));
 const inside=Object.values(chess).find(c=>c.charId==='char_498_inside'&&!c.isGolden);
 const chosen=choices[inside.charId];
 await host.evaluate(async id=>{const u=await import('/js/ui/loadoutSync.js');u.openLoadout('lobby',id);},inside.chessId);
 await host.waitForSelector(`.skin-picker[data-char="${inside.charId}"] button[data-skin="${chosen}"]:not([disabled])`);
 await host.click(`.skin-picker[data-char="${inside.charId}"] button[data-skin="${chosen}"]`);
 await host.waitForFunction(()=>JSON.parse(localStorage.getItem('sp.pref.skins')).skins.char_498_inside);
 await host.evaluate(async choices=>{const u=await import('/js/ui/loadoutSync.js');u.setSkins(choices);u.closeLoadout();},choices);
 await host.waitForFunction(async()=>{const u=await import('/js/ui/loadoutSync.js');return u.loadoutStore.get().skinSync==='synced';});
 mark('actual picker click persists exact skin ID and main installs room.skins sync');
 await req(host,'room.create',{mode:'coop',difficulty:'NORMAL',capacity:8});await host.waitForFunction(()=>!!__SP__.store.get().room);
 const room=(await state(host)).room,hostId=(await state(host)).me;
 assert.deepEqual(room.seats.find(s=>s?.playerId===hostId).skins,choices);
 await req(guest,'room.join',{code:room.code});await guest.waitForFunction(()=>!!__SP__.store.get().room);
 assert.deepEqual((await state(guest)).room.seats.find(s=>s?.playerId===hostId).skins,choices);
 assert.equal((await state(guest)).room.seats.find(s=>s?.playerId!==hostId)?.skins,undefined);
 mark('two isolated real browser clients see owner choices without viewer defaults leaking');
 await host.reload({waitUntil:'domcontentloaded'});await host.waitForFunction(()=>__SP__?.store.get().connection.status==='online'&&!!__SP__.store.get().room,{timeout:45000});
 assert.equal((await state(host)).me,hostId);assert.deepEqual((await state(host)).room.seats.find(s=>s?.playerId===hostId).skins,choices);
 mark('real browser page reload resumes same session and skin preferences');
 const watcher=await player('皮肤观战验证');await req(watcher,'room.spectate',{code:room.code});
 await watcher.waitForFunction(()=>!!__SP__.store.get().room);
 assert.deepEqual((await state(watcher)).room.seats.find(s=>s?.playerId===hostId).skins,choices);
 const refusal=await watcher.evaluate(async()=>{try{await __SP__.net.request('room.skins',{skins:{}});}catch(e){return e.code;}});assert.equal(refusal,'SPECTATOR');
 mark('third real browser spectator receives choices and server rejects edits');
 await req(guest,'room.ready',{ready:true});await req(host,'room.start');await phase(host,'INFO_CHECK');
 assert.deepEqual((await state(host)).priv.skins,choices);
 await host.evaluate(async id=>{const u=await import('/js/ui/loadoutSync.js');u.openLoadout('briefing',id);},inside.chessId);
 await host.waitForSelector('.skin-picker');assert.equal(await host.$$eval('.skin-picker button',bs=>bs.every(b=>b.disabled)),true);
 await host.evaluate(async()=>{(await import('/js/ui/loadoutSync.js')).closeLoadout();});
 await req(host,'g.infoReady');await req(guest,'g.infoReady');await phase(host,'BAND_DRAFT');
 const members=new Map([[hostId,host],[(await state(guest)).me,guest]]);
 const bands=await(await fetch(base+'/data/bands.json')).json(),used=new Set();
 for(let i=0;i<2;i++){
  await host.waitForFunction(()=>__SP__.store.get().match.public?.draft?.turn!=null);
  const turn=(await state(host)).pub.draft.turn;let ok=false;
  for(const [id,b] of Object.entries(bands))if(!used.has(id)&&(!b.modeTypeList||b.modeTypeList.includes('MULTI'))){try{await req(members.get(turn),'g.band',{bandId:id});used.add(id);ok=true;break;}catch{}}
  assert.ok(ok);await host.waitForFunction(t=>__SP__.store.get().match.public?.draft?.turn!==t,{},turn);
 }
 await phase(host,'PREP');
 const priv=(await state(host)).priv;let slot=priv.shop.slots.findIndex(x=>x&&!x.sold&&x.kind==='chess'&&choices[chess[x.id]?.charId]&&x.price<=priv.funds);
 assert.ok(slot>=0,'actual shop has an affordable installed operator');
 const id=priv.shop.slots[slot].id,skin=choices[chess[id].charId];await req(host,'g.buy',{slot});
 await host.waitForFunction(id=>__SP__.store.get().match.private.hand.some(p=>p?.id===id),{},id);
 const piece=(await state(host)).priv.hand.find(p=>p?.id===id);assert.equal(piece.skin,skin);
 await rendered(host,skin);await host.screenshot({path:out+'/skins-owner-prep.png'});
 await req(guest,'g.watch',{fieldId:'n:'+hostId,playerId:hostId});await guest.waitForFunction(()=>!!__SP__.store.get().match.field?.prep);
 assert.equal((await state(guest)).field.units.find(u=>u.uid===piece.uid).skin,skin);await rendered(guest,skin);
 await req(watcher,'g.watch',{fieldId:'n:'+hostId,playerId:hostId});await rendered(watcher,skin);await watcher.screenshot({path:out+'/skins-spectator-prep.png'});
 mark('real shop piece, own prep, teammate scouting and spectator all draw actual owner skin skeleton and nonzero pixels');
 let moved=false;for(let row=6;row>=0&&!moved;row--)for(let col=0;col<7&&!moved;col++)try{await req(host,'g.move',{uid:piece.uid,to:{area:'board',row,col},dir:'UP'});moved=true;}catch{}
 assert.ok(moved);await rendered(host,skin);
 await req(host,'g.ready',{ready:true});await req(guest,'g.ready',{ready:true});await phase(host,'COMBAT');
 await rendered(host,skin,false);
 await req(watcher,'g.watch',{fieldId:'n:'+hostId,playerId:hostId});await rendered(watcher,skin,false);
 mark('real client combat simulation and live spectator preserve skin UnitInfo, Spine textures and drawn pixels');
 await host.reload({waitUntil:'domcontentloaded'});
 await host.waitForFunction(()=>__SP__?.store.get().connection.status==='online'&&!!__SP__.store.get().match.private,{timeout:45000});
 assert.deepEqual((await state(host)).priv.skins,choices);
 mark('reload during a running match restores locked owner skins');
 // Real models for normal, elite and a composed DIY body, through production renderer, not mock model fixtures.
 const probe=await player('模型矩阵验证');
 const matrix=await probe.evaluate(async ({normal,skin})=>{
  const {data}=await import('/js/data.js'),{assets}=await import('/js/assets.js');
  await Promise.all(['assets','skinsAssets','chess','backups','tokens','stages'].map(n=>data.load(n)));assets.seed(data.get('assets'));assets.seedSkins(data.get('skinsAssets'));
  const {createFieldView}=await import('/js/render/app.js');
  const root=document.createElement('div');root.style.cssText='position:fixed;inset:0;z-index:999;background:#10201f';document.body.append(root);
  const view=await createFieldView(root,{data,assets,settings:{quality:'low',board:'2d'},board:'2d'});globalThis.__skinProbe=view;
  const records=[data.lookup('chess',normal),data.lookup('chess',normal).goldenId];
  const ids=[normal,records[1]];
  view.enterBattle({fieldId:'skin-models',kind:'normal',rect:{r0:0,c0:0,rows:7,cols:7},units:ids.map((id,i)=>{const c=data.lookup('chess',id);return {id:i+1,kind:'op',side:'ally',defId:id,spine:c.charId,avatar:c.charId,skin,x:i+2,y:5,golden:!!c.isGolden,maxHp:100};})});
  return ids;
 },{normal:inside.chessId,skin:chosen});
 await probe.waitForFunction(()=>[...__skinProbe.debug.views.values()].length===2&&[...__skinProbe.debug.views.values()].every(v=>v.actor&&v.spineReady),{timeout:45000});
 const drawn=await probe.evaluate(()=>[...__skinProbe.debug.views.values()].map(v=>({golden:v.info.golden,skin:v.info.skin,skel:v.entry.skel,anims:v.entry.animations,valid:!!v.actor.spine.skeleton})));assert.equal(drawn.filter(v=>v.golden).length,1);assert.ok(drawn.every(v=>v.skin===chosen&&v.skel.startsWith('/assets/skins/')));
 await probe.screenshot({path:out+'/skins-normal-elite-models.png'});await probe.evaluate(()=>__skinProbe.destroy());
 mark('normal and elite use the same actual downloaded skin with parsed runtime animations');
 for(const p of pages)assert.deepEqual(p.problems,[],'no local asset failures or page errors');
 await writeFile(out+'/skins-browser-evidence.json',JSON.stringify({base,checks,evidence,matrix,drawn,browserClients:2,browserSpectators:1},null,2));
 console.log(JSON.stringify({passed:checks.length,checks,evidence}));
}catch(e){for(const p of pages)try{const s=await state(p);console.error('BROWSER FAILURE STATE',JSON.stringify({phase:s.pub?.phase,draft:s.pub?.draft,problems:p.problems,renderer:await p.evaluate(()=>({kind:globalThis.__SP_VIEW__?.kind,views:globalThis.__SP_VIEW__?.raw?.debug?[...__SP_VIEW__.raw.debug.views.values()].map(v=>({info:v.info,spineReady:v.spineReady,actor:!!v.actor,entry:v.entry?.skel})):null}))}));}catch{}throw e;}finally{
 for(const p of pages)try{await req(p,'room.leave');}catch{}
 for(const c of contexts)await c.close().catch(()=>{});browser.disconnect();
}
