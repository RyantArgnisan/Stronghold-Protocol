import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../public/js/store.js';
import {installLoadoutSync} from '../public/js/ui/loadoutSync.js';
test('stored settings are resanitized and resent when roster profile changes',async()=>{
 const handlers=new Map(),sent=[];let id=0;const tasks=new Map();
 const target=createStore({entries:{},ops:{},sync:'idle'});
 const sync=installLoadoutSync({target,net:{status:'online',on(t,fn){handlers.set(t,fn);return()=>handlers.delete(t);},async request(t,p){sent.push([t,p]);}},timers:{setTimeout(fn){tasks.set(++id,fn);return id;},clearTimeout(id){tasks.delete(id);}}});
 await sync.flush();assert.equal(sent.length,1);
 handlers.get('room.state')({rhineEnabled:true,inMatch:false});
 assert.ok(tasks.size>0,'profile change did not schedule resync');
 await sync.flush();assert.equal(sent.length,2);
 sync.dispose();
});
