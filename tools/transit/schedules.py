"""Offline Muni/BART schedule index and bounded connection-scan journey planner.
Reads JSON on stdin; no external Python packages or network requests.
"""
import csv, io, json, math, os, sqlite3, sys, zipfile
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

TZ = ZoneInfo('America/Los_Angeles')
def distance(a,b):
    return math.hypot((a['lat']-b['lat'])*111195,(a['lon']-b['lon'])*111195*math.cos(math.radians((a['lat']+b['lat'])/2)))
def seconds(s):
    h,m,s=map(int,s.split(':')); return h*3600+m*60+s
def rows(z,name):
    try: return csv.DictReader(io.TextIOWrapper(z.open(name),encoding='utf-8-sig'))
    except KeyError: return []
def build(folder):
    path=folder+'/schedule.sqlite'; tmp=path+'.building'
    if os.path.exists(tmp): os.unlink(tmp)
    db=sqlite3.connect(tmp)
    db.executescript('''PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
    CREATE TABLE connections (trip TEXT, src TEXT, dst TEXT, dep INT, arr INT, pickup INT, dropoff INT, service TEXT, route TEXT, headsign TEXT);
    CREATE TABLE calendar (service TEXT, days TEXT, start TEXT, end TEXT);
    CREATE TABLE exceptions (service TEXT, date TEXT, type INT);''')
    catalog={'routes':[],'stops':[],'shapes':[]}; count=0
    for agency in ['SF','BA']:
        z=zipfile.ZipFile(folder+'/'+agency+'.zip'); prefix=agency+':'
        for r in rows(z,'routes.txt'):
            mode=('BART bus' if r['route_type']=='3' else 'BART') if agency=='BA' else ('Muni streetcar' if r['route_id'] in ['E','F'] else {'0':'Muni Metro','1':'Muni Metro','3':'Muni bus','5':'Muni cable car'}.get(r['route_type'],'Muni'))
            catalog['routes'].append({'id':prefix+r['route_id'],'route':r['route_id'],'name':r['route_long_name'].title() if agency=='SF' else r['route_long_name'],'agency':agency,'mode':mode,'color':r.get('route_color')})
        for s in rows(z,'stops.txt'):
            catalog['stops'].append({'id':prefix+s['stop_id'],'rawId':s['stop_id'],'agency':agency,'name':s['stop_name'],'lat':float(s['stop_lat']),'lon':float(s['stop_lon']),'parent':prefix+s['parent_station'] if s.get('parent_station') else None,'station':s.get('location_type')=='1'})
        trips={t['trip_id']:t for t in rows(z,'trips.txt')}
        if agency=='BA':
            shapes={}
            for s in rows(z,'shapes.txt'): shapes.setdefault(s['shape_id'],[]).append((int(s['shape_pt_sequence']),float(s['shape_pt_lon']),float(s['shape_pt_lat'])))
            seen=set()
            for t in trips.values():
                key=(t['route_id'],t.get('shape_id'))
                if key in seen or key[1] not in shapes: continue
                seen.add(key);catalog['shapes'].append({'route':prefix+key[0],'paths':[[[lon,lat] for _,lon,lat in sorted(shapes[key[1]])]]})
        for c in rows(z,'calendar.txt'): db.execute('INSERT INTO calendar VALUES (?,?,?,?)',(prefix+c['service_id'],''.join(c[d] for d in ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']),c['start_date'],c['end_date']))
        for c in rows(z,'calendar_dates.txt'): db.execute('INSERT INTO exceptions VALUES (?,?,?)',(prefix+c['service_id'],c['date'],int(c['exception_type'])))
        batch=[]; previous=None
        for s in rows(z,'stop_times.txt'):
            if previous and previous['trip_id']==s['trip_id']:
                t=trips[s['trip_id']]
                try:
                    dep,arr=seconds(previous['departure_time']),seconds(s['arrival_time'])
                    if arr>=dep and int(s['stop_sequence'])>int(previous['stop_sequence']):
                        batch.append((prefix+s['trip_id'],prefix+previous['stop_id'],prefix+s['stop_id'],dep,arr,int(previous.get('pickup_type') or 0),int(s.get('drop_off_type') or 0),prefix+t['service_id'],prefix+t['route_id'],t['trip_headsign']))
                except (ValueError,KeyError): pass
            previous=s
            if len(batch)>=10000: db.executemany('INSERT INTO connections VALUES (?,?,?,?,?,?,?,?,?,?)',batch);count+=len(batch);batch=[]
        db.executemany('INSERT INTO connections VALUES (?,?,?,?,?,?,?,?,?,?)',batch);count+=len(batch)
    db.executescript('CREATE INDEX departure ON connections(dep); CREATE INDEX service_departure ON connections(service,dep);');db.commit();db.close()
    with open(folder+'/catalog.json.tmp','w') as f: json.dump(catalog,f)
    os.replace(tmp,path);os.replace(folder+'/catalog.json.tmp',folder+'/catalog.json')
    return {'connections':count,'routes':len(catalog['routes']),'stops':len(catalog['stops'])}

def plan(folder,q):
    with open(folder+'/catalog.json') as f: catalog=json.load(f)
    db=sqlite3.connect('file:'+folder+'/schedule.sqlite?mode=ro',uri=True)
    stops={s['id']:s for s in catalog['stops']}; routes={r['id']:r for r in catalog['routes']}
    now=q['now']/1000; horizon=now+6*3600; date=datetime.fromtimestamp(now,TZ).date(); connections=[]
    for delta in [-1,0,1]:
        d=date+timedelta(days=delta); day=d.strftime('%Y%m%d')
        # GTFS service-day origin is local noon minus twelve elapsed hours (DST).
        midnight=datetime(d.year,d.month,d.day,12,tzinfo=TZ).timestamp()-43200
        active={s for s,days,start,end in db.execute('SELECT * FROM calendar') if start<=day<=end and days[d.weekday()]=='1'}
        for service,kind in db.execute('SELECT service,type FROM exceptions WHERE date=?',(day,)):
            if kind==1: active.add(service)
            else: active.discard(service)
        if not active: continue
        sql='SELECT * FROM connections WHERE service IN ('+','.join('?' for _ in active)+') AND dep>=? AND dep<=?'
        for trip,src,dst,dep,arr,pickup,dropoff,service,route,headsign in db.execute(sql,(*active,max(0,now-midnight),horizon-midnight)):
            if service in active: connections.append((dep+midnight,arr+midnight,trip+day,src,dst,pickup,dropoff,route,headsign))
    db.close();connections.sort(key=lambda c:c[0])
    # Three boardings maximum, foot transfers <=220 m; station access is estimated.
    labels=[{} for _ in range(4)]; boarded={}; grid={}; foot={}
    for s in stops.values(): grid.setdefault((int(s['lat']/.003),int(s['lon']/.003)),[]).append(s)
    def near(s):
        if s['id'] in foot: return foot[s['id']]
        x,y=int(s['lat']/.003),int(s['lon']/.003); out=[]
        for dx in [-1,0,1]:
            for dy in [-1,0,1]:
                for t in grid.get((x+dx,y+dy),[]):
                    dist=distance(s,t)
                    if s['id']!=t['id'] and dist<=220: out.append((t,dist))
        foot[s['id']]=out; return out
    def walk(a,b,dist,start):
        duration=math.ceil(dist*1.3/1.25)
        return {'type':'walk','from':a.get('name','The Garden'),'to':b.get('name','Destination'),'meters':round(dist*1.3),'fromPoint':{'lat':a['lat'],'lon':a['lon']},'toPoint':{'lat':b['lat'],'lon':b['lon']},'start':round(start*1000),'end':round((start+duration)*1000),'estimated':True}
    for s in stops.values():
        dist=distance(q['origin'],s)
        if dist<=1000:
            leg=walk(q['origin'],s,dist,now);labels[0][s['id']]=(leg['end']/1000,[leg])
    for dep,arr,trip,src,dst,pickup,dropoff,route,headsign in connections:
        if src not in stops or dst not in stops: continue
        for n in range(1,4):
            key=(trip,n)
            start=labels[n-1].get(src)
            if key not in boarded and pickup==0 and start and start[0]+60<=dep:
                boarded[key]=(start[1],src,dep)
            if key not in boarded or dropoff!=0: continue
            before,board,depart=boarded[key]
            if arr>=labels[n].get(dst,(float('inf'),))[0]: continue
            r=routes[route];leg={'type':'ride','routeId':route,'route':r['route'],'agency':r['agency'],'mode':r['mode'],'name':r['name'],'headsign':headsign,'from':stops[board]['name'],'to':stops[dst]['name'],'fromId':board,'toId':dst,'fromPoint':{'lat':stops[board]['lat'],'lon':stops[board]['lon']},'toPoint':{'lat':stops[dst]['lat'],'lon':stops[dst]['lon']},'start':round(depart*1000),'end':round(arr*1000),'scheduled':True}
            path=before+[leg];labels[n][dst]=(arr,path)
            for t,dist in near(stops[dst]):
                w=walk(stops[dst],t,dist,arr);end=w['end']/1000
                if end<labels[n].get(t['id'],(float('inf'),))[0]: labels[n][t['id']]=(end,path+[w])
    choices=[]
    for n in range(1,4):
        for sid,(end,path) in labels[n].items():
            dist=distance(stops[sid],q['destination'])
            if dist>1000: continue
            last=walk(stops[sid],q['destination'],dist,end);legs=path+[last]
            choices.append({'arrival':last['end'],'minutes':math.ceil((last['end']/1000-now)/60),'transfers':n-1,'walkingMinutes':math.ceil(sum((l['end']-l['start'])/60000 for l in legs if l['type']=='walk')),'legs':legs})
    choices.sort(key=lambda x:(x['arrival'],x['transfers'],x['walkingMinutes']))
    unique=[];seen=set()
    for c in choices:
        key=tuple((l['routeId'],l['start']) for l in c['legs'] if l['type']=='ride')
        if key in seen: continue
        seen.add(key);unique.append(c)
        if len(unique)==3: break
    return {'journeys':unique,'at':q['now'],'scheduleAt':int(os.path.getmtime(folder+'/schedule.sqlite')*1000),'method':'Scheduled Muni + BART, up to two transfers, next six hours. Walks are distance estimates, not street directions. No live delay or accessibility guarantee.'}

if __name__=='__main__':
    print(json.dumps(build(sys.argv[2]) if sys.argv[1]=='build' else plan(sys.argv[2],json.load(sys.stdin))))
