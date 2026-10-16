import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
const module = await import('../tools/build-skin-assets.mjs').catch(() => null);
const buildSkinAssets = (...args) => { assert.ok(module, 'missing production offline skin generator'); return module.buildSkinAssets(...args); };
import { SKIN_CATALOGUE } from '../shared/skin-catalogue.js';
import { roleAnimationNames } from '../tools/assets/anim-roles.mjs';
test('offline manifest admits only complete parsed models and avatars, derives actual animation mappings',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(), 'skin-generator-test-')); t.after(()=>rm(root,{recursive:true,force:true}));
 const s=SKIN_CATALOGUE[0], base=JSON.parse(await readFile('data/assets.json','utf8')).chars[s.charId];
 const front=base.spine.front;
 const required=[base.avatar, front.skel, front.atlas, ...front.textures];
 if (!required.every(url => existsSync('public'+url))) { t.skip('requires downloaded base avatar and Spine assets, not included in source CI'); return; }
 const d=path.join(root,'public/assets/skins',s.stem); await mkdir(path.join(d,'front'),{recursive:true});
 await copyFile('public'+base.avatar,path.join(d,'avatar.png'));
 for(const url of [front.skel,front.atlas,...front.textures]) await copyFile('public'+url,path.join(d,'front',path.basename(url)));
 // Test fixture: a known real base model in an isolated temporary tree, never published as a skin.
 await copyFile(path.join(d,'front',path.basename(front.skel)),path.join(d,'front',s.stem+'.skel'));
 await copyFile(path.join(d,'front',path.basename(front.atlas)),path.join(d,'front',s.stem+'.atlas'));
 let m=await buildSkinAssets({root,catalogue:[s]});
 assert.equal(m.stats.available,1);
 const sp=m.chars[s.charId].skins[s.id].spine.front;
 assert.ok(sp.animations.Idle>=0); assert.ok(roleAnimationNames(sp.anims).every(k=>Object.hasOwn(sp.animations,k)));
 await writeFile(path.join(d,'front',path.basename(front.textures[0])),'<html>bad download</html>');
 m=await buildSkinAssets({root,catalogue:[s]}); assert.equal(m.stats.available,0); assert.equal(m.stats.unavailable,1); assert.equal(m.chars[s.charId],undefined);
});
test('offline generator rejects absent or incomplete skin assets without downloaded game files',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(), 'skin-missing-test-')); t.after(()=>rm(root,{recursive:true,force:true}));
 const skin=SKIN_CATALOGUE[0];
 const dir=path.join(root,'public/assets/skins',skin.stem,'front'); await mkdir(dir,{recursive:true});
 await writeFile(path.join(dir,skin.stem+'.skel'),'<html>not a model</html>');
 const manifest=await buildSkinAssets({root,catalogue:[skin]});
 assert.equal(manifest.stats.available,0); assert.equal(manifest.stats.unavailable,1);
 assert.equal(manifest.chars[skin.charId],undefined);
});
test('generator rejects catalogue path traversal and duplicate stems',async()=>{
 await assert.rejects(()=>buildSkinAssets({root:'/scratch',catalogue:[{...SKIN_CATALOGUE[0],stem:'../escape'}]}),/unsafe/);
 await assert.rejects(()=>buildSkinAssets({root:'/scratch',catalogue:[SKIN_CATALOGUE[0],{...SKIN_CATALOGUE[1],stem:SKIN_CATALOGUE[0].stem}]}),/duplicate/);
});
