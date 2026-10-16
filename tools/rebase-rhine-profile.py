"""Rebase generated additive Rhine tables on current official data.
Use the previous installation's data directory as argv[1]; never mutate it.
Local profile-only keys win; unchanged keys follow the new official base.
"""
from pathlib import Path
import json,sys
root=Path(__file__).resolve().parents[1]
old=Path(sys.argv[1]);missing=object()
def merge(base,local,new):
    if local == base:return new
    if isinstance(base,dict) and isinstance(local,dict) and isinstance(new,dict):
        out=dict(new)
        for k in set(base)|set(local):
            if k not in local:
                out.pop(k,None)
            elif k not in base:out[k]=local[k]
            else:out[k]=merge(base[k],local[k],new.get(k,missing))
        return {k:v for k,v in out.items() if v is not missing}
    return local
for f in sorted((root/'data/rhine').glob('*.json')):
    b=old/f.name;n=root/'data'/f.name
    if not b.is_file() or not n.is_file():continue
    result=merge(json.loads(b.read_text()),json.loads(f.read_text()),json.loads(n.read_text()))
    f.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
print('Generated current additive Rhine profile')
