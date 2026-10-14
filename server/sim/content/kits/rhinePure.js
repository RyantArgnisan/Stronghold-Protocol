// Pure Rhine roster only; sources documented in docs/rhine-sources (GPL-3.0-or-later).
import {mayer,RHINE_SUPPORT_TOKEN_KITS} from './mayer.fragment.js';
import {ifrit} from './ifrit.fragment.js';
import {RHINE_NEW_KITS,RHINE_NEW_TOKEN_KITS} from './rhineNew.js';
const newKits=Object.fromEntries(Object.entries(RHINE_NEW_KITS).filter(([id])=>id.startsWith('chess_rhine_')));
import aphris,{APHRIS_TOKEN_KITS} from './aphris.js';
export const kits = Object.freeze({'chess_rhine_mayer_a':mayer,'chess_rhine_ifrit_a':ifrit,...newKits,...aphris});
export const tokens = Object.freeze({...RHINE_SUPPORT_TOKEN_KITS,...RHINE_NEW_TOKEN_KITS,...APHRIS_TOKEN_KITS});
