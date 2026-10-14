import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CloudSaveView } from '../../public/js/ui/cloudSavePanel.js';
const nodes = view => { const found=[]; const walk=n=>{if(!n||typeof n!=='object')return; found.push(n); for(const c of [n.props?.children].flat(Infinity))walk(c);};walk(view);return found; };
test('panel exposes password verification independent of auto toggle and displays server activation time', () => {
 const calls=[];
 const view=CloudSaveView({name:'fixture',selection:{stats:true,operators:false},busy:false,locked:false,auto:{enabled:true,enabledAt:1000,status:'ready',authorized:true},onAction:a=>calls.push(a)});
 const verify=nodes(view).find(n=>n.props?.['data-cloud-action']==='authorize');
 assert.ok(verify,'cross-browser verification must not re-enable/reset auto setting');
 verify.props.onClick(); assert.deepEqual(calls,['authorize']);
 const at=nodes(view).find(n=>n.props?.['data-cloud-enabled-at']);assert.ok(at,'show persisted activation time');assert.match(JSON.stringify(at.props.children),/1970/);
});
test('actual panel authorization restores server setting without snapshot/upload or enabling', async () => {
 const source=await readFile(new URL('../../public/js/ui/cloudSavePanel.js',import.meta.url),'utf8');
 const body=source.split('const action = async (which) => {')[1].split('\n  };')[0];
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const events=[],statuses=[],passwordRef={current:{value:'fixture-only'}},running={current:false};
 const action=new AsyncFunction('which','running','setBusy','setStatus','t','store','selection','cloudSavePlayerName','passwordRef','snapshotCloudSave','requestCloudSave','confirmDialog','errors','autoCloudUpload',body);
 await action('authorize',running,()=>{},s=>statuses.push(s),s=>s,{get:()=>({session:{entered:true},me:{name:'fixture'}})},{stats:false,operators:false},s=>s.me.name,passwordRef,()=>events.push('snapshot'),async()=>events.push('request'),async()=>events.push('confirm'),{}, {authorize:async(...args)=>events.push(args),get:()=>({enabled:true})});
 assert.deepEqual(events,[['fixture-only']]); assert.equal(passwordRef.current.value,'');assert.match(statuses.at(-1),/验证/);
});
