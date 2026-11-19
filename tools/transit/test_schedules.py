import importlib.util,json,sqlite3,tempfile,unittest
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
spec=importlib.util.spec_from_file_location('schedules',Path(__file__).with_name('schedules.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class JourneyTest(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.folder=self.tmp.name
  self.db=sqlite3.connect(self.folder+'/schedule.sqlite');self.addCleanup(self.db.close)
  self.db.executescript('CREATE TABLE connections(trip,src,dst,dep,arr,pickup,dropoff,service,route,headsign);CREATE TABLE calendar(service,days,start,end);CREATE TABLE exceptions(service,date,type);')
  self.db.execute('INSERT INTO calendar VALUES (?,?,?,?)',('svc','1111111','20260101','20261231'))
  self.stops=[{'id':x,'name':x,'lat':37.7,'lon':-122.5+i*.03} for i,x in enumerate(['a','b','c'])]
  Path(self.folder+'/catalog.json').write_text(json.dumps({'stops':self.stops,'routes':[{'id':'SF:7','route':'7','agency':'SF','mode':'Muni bus','name':'Test bus'},{'id':'BA:Yellow-N','route':'Yellow-N','agency':'BA','mode':'BART','name':'Test rail'}]}))
 def connection(self,trip,a,b,dep,arr,route='SF:7',pickup=0,dropoff=0):
  self.db.execute('INSERT INTO connections VALUES (?,?,?,?,?,?,?,?,?,?)',(trip,a,b,dep,arr,pickup,dropoff,'svc',route,'Outbound'));self.db.commit()
 def plan(self,day='2026-11-05T08:00:00'):
  now=datetime.fromisoformat(day).replace(tzinfo=ZoneInfo('America/Los_Angeles')).timestamp()*1000
  return m.plan(self.folder,{'now':now,'origin':self.stops[0],'destination':self.stops[-1]})['journeys']
 def test_direct_continuity(self):
  self.connection('direct','a','b',29100,29700);self.connection('direct','b','c',29760,30300)
  j=self.plan()[0];rides=[l for l in j['legs'] if l['type']=='ride'];self.assertEqual(len(rides),1);self.assertEqual(rides[0]['fromId'],'a');self.assertEqual(rides[0]['toId'],'c');self.assertEqual(j['transfers'],0)
 def test_transfer_and_no_teleport(self):
  self.connection('bus','a','b',29100,29700);self.connection('rail','b','c',29820,30300,'BA:Yellow-N')
  j=self.plan()[0];self.assertEqual(j['transfers'],1);self.assertEqual([l['agency'] for l in j['legs'] if l['type']=='ride'],['SF','BA'])
  self.db.execute("UPDATE connections SET dep=29600 WHERE trip='rail'");self.db.commit();self.assertEqual(self.plan(),[])
 def test_pickup_and_calendar_exception(self):
  self.connection('direct','a','c',29100,30300,pickup=1);self.assertEqual(self.plan(),[])
  self.db.execute('UPDATE connections SET pickup=0');self.db.execute('INSERT INTO exceptions VALUES (?,?,?)',('svc','20261105',2));self.db.commit();self.assertEqual(self.plan(),[])
 def test_previous_service_day_after_midnight(self):
  self.connection('owl','a','c',25*3600,25*3600+600);self.assertTrue(self.plan('2026-11-06T00:55:00'))
if __name__=='__main__': unittest.main()
