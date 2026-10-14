import {makeBattle as base} from './battleHarness.js';
import {getDataProfile} from '../../server/data.js';
import {DataSource} from '../../server/sim/simdata.js';
import {setGameData} from '../../server/sim/content/support/index.js';
setGameData(getDataProfile(true));
export {chessRec,enemyRec,checkInvariants} from './battleHarness.js';
export const getRhineSource=()=>new DataSource(getDataProfile(true),null);
export function makeBattle(opts={}){const raw={...getDataProfile(true)};for(const [k,v] of Object.entries(opts.defs||{}))raw[k]={...raw[k],...v};return base({...opts,data:opts.data??new DataSource(raw,null)});}
