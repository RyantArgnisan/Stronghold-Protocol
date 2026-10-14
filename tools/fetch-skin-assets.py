#!/usr/bin/env python3
"""Offline skin acquisition. Bounded upstream retries; no manifest mutation.
Usage: python3 tools/fetch-skin-assets.py PINNED_RESEARCH [--workers 4]
Actual readiness is determined afterwards by build-skin-assets.mjs.
"""
import argparse, concurrent.futures, hashlib, json, pathlib, subprocess, threading, urllib.parse
ROOT = pathlib.Path(__file__).resolve().parents[1]

def sources(raw):
    parsed = urllib.parse.urlsplit(raw)
    if parsed.netloc != 'raw.githubusercontent.com':
        raise ValueError('untrusted upstream')
    repo, branch, rel = '/'.join(parsed.path.split('/')[1:3]), parsed.path.split('/')[3], '/'.join(parsed.path.split('/')[4:])
    urls = [f'https://cdn.jsdelivr.net/gh/{repo}@{branch}/{rel}', raw]
    # Some battle models (e.g. Skadi the Corrupting Heart) have one Spine,
    # not Front/Back. Never label such a model as an available Back.
    if repo == 'fexli/ArknightsResource' and '/Front/' in rel:
        urls += [u.replace('/Front/', '/Spine/') for u in urls]
    return urls

def valid(p):
    if not p.is_file(): return False
    b=p.read_bytes()
    if p.suffix=='.png': return len(b)>24 and b[:8]==b'\x89PNG\r\n\x1a\n' and b[-8:-4]==b'IEND'
    if p.suffix=='.atlas': return b'.png' in b and not b.lstrip().startswith(b'<')
    return len(b)>32 and not b.startswith((b'<',b'404'))

def fetch(task):
    dest, raw = task
    dest.parent.mkdir(parents=True,exist_ok=True)
    if valid(dest): return {'file':str(dest.relative_to(ROOT)), 'status':'cached','sha256':hashlib.sha256(dest.read_bytes()).hexdigest()}
    attempts=[]
    for url in sources(raw):
        temp=dest.with_suffix(dest.suffix+'.part')
        res=subprocess.run(['curl','--fail','--location','--silent','--show-error','--connect-timeout','8','--max-time','25','--output',str(temp),url],capture_output=True,text=True)
        # Validate according to final extension (temporary file has another suffix).
        if res.returncode==0:
            temp.replace(dest)
            if valid(dest): return {'file':str(dest.relative_to(ROOT)),'status':'downloaded','source':url,'bytes':dest.stat().st_size,'sha256':hashlib.sha256(dest.read_bytes()).hexdigest()}
            dest.unlink(missing_ok=True)
        temp.unlink(missing_ok=True)
        attempts.append({'source':url,'error':res.stderr.strip() or 'invalid response'})
    return {'file':str(dest.relative_to(ROOT)),'status':'unavailable','attempts':attempts}

def main():
    p=argparse.ArgumentParser(); p.add_argument('research'); p.add_argument('--workers',type=int,default=4); p.add_argument('--only',default=''); args=p.parse_args()
    research=json.loads(pathlib.Path(args.research).read_text()); tasks=[]
    for char, skins in research['skins'].items():
        for s in skins:
            stem=s['stem']
            if args.only and args.only not in stem: continue
            if not stem.replace('_','').replace('-','').isalnum(): raise ValueError('unsafe stem')
            d=ROOT/'public/assets/skins'/stem
            tasks.append((d/'avatar.png',s['avatar']['url']))
            for side in ['Front','Back']:
                for ext in ['skel','atlas','png']:
                    raw=f'https://raw.githubusercontent.com/fexli/ArknightsResource/main/spine/{char}/{stem}/{side}/{stem}.{ext}'
                    tasks.append((d/side.lower()/f'{stem}.{ext}',raw))
    log=ROOT/'data/skins-downloads.jsonl'; count={}
    with log.open('a') as f, concurrent.futures.ThreadPoolExecutor(max_workers=max(1,min(args.workers,4))) as ex:
        for i,result in enumerate(ex.map(fetch,tasks)):
            count[result['status']]=count.get(result['status'],0)+1
            f.write(json.dumps(result,ensure_ascii=False)+'\n'); f.flush()
            if i%40==0: print(json.dumps({'processed':i+1,'total':len(tasks),'counts':count}),flush=True)
    print(json.dumps({'processed':len(tasks),'counts':count,'log':str(log)}),flush=True)
if __name__=='__main__': main()
