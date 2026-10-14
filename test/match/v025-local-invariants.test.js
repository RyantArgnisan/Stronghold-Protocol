import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
const seats = () => Array.from({length:8},(_,i)=>({seat:i,playerId:`p_${i}`,name:`P${i}`,isBot:false,connected:true}));
test('v025 construction retains eight-seat operator inventory before reroll', t=>{
 const h=makeMatch({seats:seats(),seed:123}).start();t.after(()=>h.m.dispose());
 for(const [id,e] of h.m.pool.entries) assert.equal(e.cap,2*h.m.gd.poolCopies(id),'expanded initial stock '+id);
});
test('v025 item-aware draft retains ten legal independently indexed slots for eight seats', t=>{
 const h=makeMatch({seats:seats(),seed:123}).start();t.after(()=>h.m.dispose());
 h.m.round=3;h.m.enterSpDraft();
 assert.equal(h.m.sp.cards.length,10);
 assert.deepEqual(h.m.sp.cards.map(c=>c.idx),Array.from({length:10},(_,i)=>i));
 assert.equal(h.m.sp.order.length,8);
 for(const c of h.m.sp.cards) if(c.kind==='item') assert.ok(h.m.itemPool.canGain(c.id));
});
