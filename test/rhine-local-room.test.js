import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startServer} from '../server/index.js';
import {StubMatch} from '../server/match/StubMatch.js';
import {TestClient} from './helpers/wsClient.js';
import {validateC2S} from '../shared/protocol.js';
class CaptureMatch extends StubMatch { constructor(opts) { super(opts); this.opts = opts; } }
test('default vanilla and host-only Rhine selection are room-scoped, reset all readiness and lock at start',async t=>{
 const srv=await startServer({port:0,host:'127.0.0.1',MatchClass:CaptureMatch,log:{info(){},warn(){},error(){},debug(){}}});
 const cs=[];t.after(async()=>{await Promise.all(cs.map(c=>c.terminate()));await srv.close();});
 async function client(name){const c=await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);cs.push(c);await c.hello(name);return c;}
 const a=await client('Host'),b=await client('Guest'),other=await client('Solo');
 async function ok(c,msg){const r=await c.request(msg);assert.equal(r.t,'ok',JSON.stringify(r));}
 await ok(a,{t:'room.create',mode:'coop',difficulty:'FUNNY',capacity:8});
 const state=await a.waitFor('room.state');const room=srv.lobby.getRoom(state.code);
 assert.equal(state.rhineEnabled,false);
 await ok(b,{t:'room.join',code:state.code});
 await ok(other,{t:'room.create',mode:'solo',difficulty:'FUNNY',capacity:1});
 const solo=await other.waitFor('room.state');
 await ok(a,{t:'room.ready',ready:true});await ok(b,{t:'room.ready',ready:true});
 assert.equal((await b.request({t:'room.setRhine',on:true})).code,'NOT_HOST');
 await ok(a,{t:'room.setRhine',on:true});
 assert.equal(room.rhineEnabled,true);assert.ok(room.seats.filter(Boolean).every(s=>!s.ready));
 await ok(a,{t:'room.loadout',entries:{chess_rhine_astgenne_a:{skill:1}}});
 assert.equal(room.seats.find(s=>s?.playerId===room.hostId).loadout.chess_rhine_astgenne_a?.skill,1,'Rhine skill choice lost during room loadout validation');
 assert.equal(srv.lobby.getRoom(solo.code).rhineEnabled,false);
 assert.equal((await a.request({t:'room.create',mode:'coop',difficulty:'FUNNY',rhineEnabled:'yes'})).code,'BAD_MSG');
 assert.ok(srv.lobby.getRoom(state.code));
 await ok(b,{t:'room.ready',ready:true});await ok(a,{t:'room.start'});
 assert.equal(room.match.opts.rhineEnabled,true);assert.ok(room.match.opts.data.chess.chess_rhine_mayer_a);
 assert.equal((await a.request({t:'room.setRhine',on:false})).code,'ROOM_STARTED');
 await ok(other,{t:'room.start'});assert.ok(!srv.lobby.getRoom(solo.code).match.opts.data.chess.chess_rhine_mayer_a);
 assert.equal(validateC2S({t:'room.setRhine',on:1}), 'bad field on');
});
