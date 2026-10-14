// Offline production overlay. Never modifies the base asset manifests.
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { SKIN_CATALOGUE } from '../shared/skin-catalogue.js';
import { parseSkel } from './assets/skel.mjs';
import { atlasInfo, normalizeAtlas } from './assets/atlas.mjs';
import { isCompletePng, pngSize } from './assets/formats.mjs';
import { resolveRoles, roleAnimationNames } from './assets/anim-roles.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const SKIN_SOURCE={repo:'Paper-Yuan/Stronghold-Protocol',commit:'06cd3d0aafee6d9b1a3c542414fb847e16871a4d'};
const safeName=s=>typeof s==='string' && /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9]+)?$/.test(s);
async function png(file) { const b=await readFile(file); if(!isCompletePng(b)) throw Error('invalid/truncated PNG '+file); return pngSize(b); }
async function model(root,s,side) {
 const dir=`/assets/skins/${s.stem}/${side}/`, local=path.join(root,'public',dir);
 const atlas=await readFile(path.join(local,s.stem+'.atlas'),'utf8'), ai=atlasInfo(atlas);
 if(!ai.pages.length || !ai.regions.size || !ai.pages.every(p=>safeName(p)&&p.endsWith('.png'))) throw Error('unsafe/empty atlas');
 const sizes=new Map(); for(const p of ai.pages) sizes.set(p,await png(path.join(local,p)));
 const sk=parseSkel(await readFile(path.join(local,s.stem+'.skel')),ai.regions);
 if(!sk.version.startsWith('3.8') || sk.missingRegions.length || !sk.animations.length) throw Error('incompatible or mismatched skeleton: '+sk.missingRegions.join(','));
 const anims=resolveRoles(sk.animations,{skillIndices:[0,1,2],durations:sk.durations});
 if(!anims.idle || !roleAnimationNames(anims).every(n=>Object.hasOwn(sk.durations,n))) throw Error('unresolved animation roles');
 const norm=normalizeAtlas(atlas,{pageSize:n=>sizes.get(n)}); if(norm.changed) await writeFile(path.join(local,s.stem+'.atlas'),norm.text);
 return {skel:dir+s.stem+'.skel',atlas:dir+s.stem+'.atlas',textures:ai.pages.map(p=>dir+p),pma:ai.hasPma,
   anims,animations:sk.durations,events:sk.events,hits:sk.hits,bounds:sk.bounds};
}
export async function buildSkinAssets({root=ROOT,catalogue=SKIN_CATALOGUE}={}) {
 const stems=new Set(),ids=new Set();
 for(const s of catalogue) { if(!safeName(s.stem)||!/^char_[A-Za-z0-9_]+$/.test(s.charId)||!s.id?.startsWith(s.charId+'@')) throw Error('unsafe descriptor');
  if(stems.has(s.stem)||ids.has(s.id)) throw Error('duplicate descriptor'); stems.add(s.stem);ids.add(s.id); }
 const out={version:1,source:SKIN_SOURCE,chars:{},stats:{catalogue:catalogue.length,available:0,unavailable:0,withBack:0},unavailable:[]};
 for(const s of catalogue) {
  try {
   const avatar=`/assets/skins/${s.stem}/avatar.png`; await png(path.join(root,'public',avatar));
   const front=await model(root,s,'front'); let back;
   try { back=await model(root,s,'back'); } catch(e) { /* Front is usable; a missing Back never invents a model. */ }
   const skin={name:s.name,group:s.group,avatar,spine:{front,...(back?{back}: {})}};
   (out.chars[s.charId]||={skins:{}}).skins[s.id]=skin;out.stats.available++;if(back)out.stats.withBack++;
  } catch(e) {out.stats.unavailable++;out.unavailable.push({id:s.id,charId:s.charId,reason:e.message.replaceAll(root,'')});}
 }
 out.stats.chars=Object.keys(out.chars).length;
 return out;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 const manifest=await buildSkinAssets(); const dest=path.join(ROOT,'data/skins-assets.json');
 await writeFile(dest+'.part',JSON.stringify(manifest,null,2)+'\n');
 const {rename}=await import('node:fs/promises'); await rename(dest+'.part',dest);
 console.log(JSON.stringify({manifest:dest,...manifest.stats}));
}
