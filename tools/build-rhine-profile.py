"""Generate only the reviewed Rhine overlay on current local 0.2.3.
Sources: Lele a728f3a / Rhine 1d20c21 / SrC2O4 c76a81f, GPL-3.0-or-later.
Base data and base asset manifests are never rewritten.
"""
from pathlib import Path
import json, copy, shutil, sys, hashlib
root=Path(__file__).resolve().parents[1]
extract=Path(sys.argv[1])
read=lambda p:json.loads(p.read_text())
base={p.stem:read(p) for p in (root/'data').glob('*.json')}
out=copy.deepcopy(base)
for name in ['chess','tokens','garrisons','bonds','items','effects']:
    for op in read(extract/'delta'/f'{name}.json'):
        keys=op['path'].strip('/').split('/')
        obj=out[name]
        for key in keys[:-1]:obj=obj.setdefault(key,{})
        if op['op']=='remove':obj.pop(keys[-1],None)
        else:obj[keys[-1]]=copy.deepcopy(op['value'])
    selected=read(extract/'data'/f'{name}.json')
    if name=='chess':
        for id, rec in selected.items():out[name][id]['visible']=rec.get('visible',True)
# Recompute all membership tables on the final roster, not the old mixed table.
for id,bond in out['bonds'].items():
    bond['members']=[idc for idc,c in out['chess'].items() if not c.get('isGolden') and id in c.get('bonds',[])]
    bond['visibleMembers']=[idc for idc in bond['members'] if out['chess'][idc].get('visible',True)]
for mode in out['config'].get('modes',{}).values():
    mode['activeBondIds']=list(dict.fromkeys([*mode.get('activeBondIds',[]),'rhineShip']))
for name,ops in read(extract/'delta/shared-basepatch.json').items():
    if name=='config':continue
    for op in ops:
        id,field=op['path'].strip('/').split('/')
        # append the reviewed pairing note, preserving any current-023 wording
        out[name][id][field]=out[name][id].get(field,'')+'\n与“莱茵实验终端”同时携带时，额外获得【莱茵生命】盟约。'
# Asset overlay has its own immutable URL prefix. No hardlinks or base-manifest mutations.
assetroot=root/'public/rhine-assets'
shutil.copytree(extract/'assets/public',assetroot,dirs_exist_ok=True)
def rewrite(v):
    if isinstance(v,dict):return {k:rewrite(x) for k,x in v.items()}
    if isinstance(v,list):return [rewrite(x) for x in v]
    if isinstance(v,str) and v.startswith(('/assets/','/art/','/fonts/')):return '/rhine-assets'+v
    return v
assets=read(extract/'assets/assets-selected.json')
def merge(a,b):
    for k,v in b.items():
        if isinstance(v,dict) and isinstance(a.get(k),dict):merge(a[k],v)
        else:a[k]=v
merge(out['assets'],rewrite(assets))
for name in ['chess','tokens','items','effects','bonds','garrisons']:out[name]=rewrite(out[name]) if False else out[name]
# Only extracted inline assets change; existing official URLs and skins remain as-is.
for name in ['chess','tokens','items','effects','bonds','garrisons']:
    for id in read(extract/'data'/f'{name}.json'):
        if 'assets' in out[name][id]:out[name][id]['assets']=rewrite(out[name][id]['assets'])
profile=root/'data/rhine';profile.mkdir(parents=True,exist_ok=True)
for name,v in out.items():
    if True: # unchanged files are current-023 copies, never the old Mod baseline
        (profile/f'{name}.json').write_text(json.dumps(v,ensure_ascii=False,separators=(',',':'))+'\n')
shutil.copytree(extract/'licenses',root/'docs/rhine-sources',dirs_exist_ok=True)
(root/'docs/rhine-sources/SOURCE.json').write_text(json.dumps({k:v for k,v in read(extract/'provenance.json').items() if k!='file_provenance'},indent=2))
print('Generated Rhine overlay; base untouched; copied assets',sum(p.is_file() for p in assetroot.rglob('*')))
