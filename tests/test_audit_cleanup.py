"""Audit cleanup: transactional JSON, controller behavior and ranking integrity."""
import os
import unittest
from playwright.sync_api import sync_playwright
from test_regressions import fixture

ONE_ROOM={'id':'r1','name':'Test','x':0,'y':0,'w':3,'h':3,'emission':0,'extraAch':0}
TWO_ROOMS=[ONE_ROOM,{'id':'r2','name':'Drugi','x':3,'y':0,'w':3,'h':3,'emission':0,'extraAch':0}]

class AuditCleanup(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.playwright=sync_playwright().start()
  kw={'headless':True,'args':['--no-sandbox']}
  if os.getenv('AEROPLAN_CHROMIUM'):kw['executable_path']=os.getenv('AEROPLAN_CHROMIUM')
  cls.browser=cls.playwright.chromium.launch(**kw)
  cls.html=fixture()
 @classmethod
 def tearDownClass(cls):
  cls.browser.close();cls.playwright.stop()
 def setUp(self):
  self.page=self.browser.new_page(viewport={'width':1360,'height':900})
  self.errors=[]
  self.page.on('pageerror',lambda e:self.errors.append(str(e)))
  self.page.set_content(self.html)
 def tearDown(self):
  self.assertEqual(self.errors,[],self.errors)
  self.page.close()
 def evaluate(self,js,arg=None):
  return self.page.evaluate(js,arg)
 def import_result(self,config):
  return self.evaluate('''doc=>{
   const m=window.__test;
   m.advance(3);
   const before={t:m.elapsed,rooms:m.rooms.length,values:Array.from(m.concentration),grid:m.grid};
   let error='';try{m.applyImportedDocument(doc);}catch(e){error=e.message;}
   return {error,afterRooms:m.rooms.length,afterTime:m.elapsed,originalTime:before.t,
    preserved:m.grid===before.grid&&Array.from(m.concentration).every((v,i)=>v===before.values[i]),
    vents:m.vents.map(v=>({type:v.type,rate:v.rate,roomId:v.roomId}))};
  }''',config)

 def test_import_valid_legacy_project_without_vents(self):
  doc={'version':3,'rooms':[{**ONE_ROOM,'supplyM3h':42}], 'doors':[], 'windows':[]}
  result=self.import_result(doc)
  self.assertFalse(result['error'])
  self.assertEqual(result['afterRooms'],1)
  self.assertEqual(result['vents'],[{'type':'supply','rate':42,'roomId':'r1'}])

 def test_import_rejects_unknown_room_references_without_dropping_objects(self):
  doc={'rooms':[ONE_ROOM],'doors':[{'a':'r1','b':'missing'}]}
  got=self.import_result(doc)
  self.assertIn('nieistniejącego pokoju',got['error'])
  self.assertTrue(got['preserved'])
  self.assertEqual(got['afterTime'],got['originalTime'])

 def test_import_invalid_numeric_parameters_is_atomic(self):
  for val in [150, -1, '2.1', None]:
   with self.subTest(value=val):
    got=self.import_result({'rooms':[ONE_ROOM],'parameters':{'height':val}})
    self.assertIn('Parametr height',got['error'])
    self.assertTrue(got['preserved'])

 def test_import_rejects_overlapping_passages(self):
  door={'a':'r1','b':'r2','width':1.2,'pos':.5,'open':True}
  got=self.import_result({'rooms':TWO_ROOMS,'doors':[door,door]})
  self.assertIn('nakładają',got['error'])
  self.assertTrue(got['preserved'])

 def test_import_rejects_purifier_too_large(self):
  got=self.import_result({'rooms':[{**ONE_ROOM,'w':.5,'h':.5}],
   'parameters':{'purifierDiameter':1.2}})
  self.assertIn('nie mieści oczyszczacza',got['error'])
  self.assertTrue(got['preserved'])

 def test_import_rejects_invalid_state_and_invalid_door_width(self):
  for doors in [[{'a':'r1','b':'r2','open':'false'}],
                [{'a':'r1','b':'r2','width':4}]]:
   with self.subTest(doors=doors):
    got=self.import_result({'rooms':TWO_ROOMS,'doors':doors})
    self.assertTrue(got['error'])
    self.assertTrue(got['preserved'])

 def test_comparison_error_reenables_button(self):
  self.evaluate('''()=>{const m=window.__test;
   for(const [id,v] of Object.entries({windSpeed:0,ach:0,cadr:0,jet:0}))
    document.getElementById(id).value=v;
   m.importModel([{id:'r1',name:'R',x:0,y:0,w:3,h:3,emission:0,extraAch:0}]);
   m.vents.push(m.makeVent(m.rooms[0],'exhaust',1,1,250));m.reconfigureConnections();
  }''')
  self.page.locator('#compare').click()
  self.page.wait_for_function("document.querySelector('#status').textContent.includes('Nie można porównać')",timeout=20000)
  self.assertFalse(self.page.locator('#compare').is_disabled())
  self.assertIn('bilansu ciśnień',self.page.locator('#status').inner_text())

 def test_ranking_click_keeps_time(self):
  got=self.evaluate('''()=>{
   const m=window.__test;m.advance(6);const before=m.elapsed;
   m.makeFakeRanking([{label:'Bez oczyszczacza',pos:null,dose:45,final:45},
     {label:'Test · środek',pos:{x:2,y:2},dose:20,final:20}]);
   return {before};
  }''')
  self.page.locator('#ranking .rankitem button').first.click()
  self.assertAlmostEqual(got['before'],self.evaluate('window.__test.elapsed'))

 def test_add_door_button_does_not_duplicate_existing_door(self):
  self.evaluate('''()=>{
   const m=window.__test;
   m.importModel([{id:'r1',name:'A',x:0,y:0,w:3,h:3,emission:0,extraAch:0},
    {id:'r2',name:'B',x:3,y:0,w:3,h:3,emission:0,extraAch:0}],
    [{id:'d',a:'r1',b:'r2',width:1.2,pos:.5,open:true,kind:'door'}]);
  }''')
  self.page.locator('#addDoor').click()
  result=self.evaluate('''()=>{const m=window.__test;return {
   total:m.doors.length,overlap:m.doors.some(d=>m.doors.some(other=>other!==d&&
     Math.abs(d.pos-other.pos)<(d.width+other.width)/6-.01))};}''')
  self.assertEqual(result['total'],2)
  self.assertFalse(result['overlap'])

 def test_door_editor_rejects_unconnected_rooms_without_reset(self):
  self.evaluate('''()=>{
   const m=window.__test; m.importModel([
    {id:'r1',name:'A',x:0,y:0,w:3,h:3,emission:0,extraAch:0},
    {id:'r2',name:'B',x:3,y:0,w:3,h:3,emission:0,extraAch:0},
    {id:'r3',name:'C',x:6,y:0,w:3,h:3,emission:0,extraAch:0}],
    [{id:'d',a:'r1',b:'r2',width:1.2,pos:.5,open:true,kind:'door'}]);
   m.advance(3);
  }''')
  original=self.evaluate('window.__test.elapsed')
  self.page.locator('#doors [data-role="b"]').select_option('r3')
  self.assertEqual(self.evaluate('window.__test.doors[0].b'),'r2')
  self.assertAlmostEqual(self.evaluate('window.__test.elapsed'),original)
  self.assertIn('Zmiana odrzucona',self.page.locator('#status').inner_text())

 def test_remove_door_does_not_reset_clock(self):
  self.evaluate('''()=>{
   const m=window.__test;m.importModel([
    {id:'r1',name:'A',x:0,y:0,w:3,h:3,emission:0,extraAch:0},
    {id:'r2',name:'B',x:3,y:0,w:3,h:3,emission:0,extraAch:0}],
    [{id:'d',a:'r1',b:'r2',width:1.2,pos:.5,open:true,kind:'door'}]);m.advance(8);
  }''')
  original=self.evaluate('window.__test.elapsed')
  self.page.locator('#doors [data-remove]').first.click()
  self.assertAlmostEqual(self.evaluate('window.__test.elapsed'),original)
  self.assertEqual(len(self.evaluate('window.__test.doors')),0)

 def test_ranking_integrates_concentration_without_sampling_bias(self):
  self.evaluate('''()=>{
    const m=window.__test;
    document.getElementById('windSpeed').value=0;
    document.getElementById('ach').value=0;
    document.getElementById('gustPercent').value=0;
    document.getElementById('jet').value=0;
    document.getElementById('cadr').value=200;
    m.importModel([{id:'r1',name:'A',x:0,y:0,w:2,h:2,emission:300,extraAch:0}]);
    m.parameters.timeLimitEnabled=true;m.parameters.maxMinutes=1;
  }''')
  self.page.locator('#compare').click()
  self.page.wait_for_function("document.querySelector('#compare').disabled===false && document.querySelector('#ranking').children.length>0",timeout=90000)
  result=self.evaluate('''()=>{
    const m=window.__test,g=m.grid,settings=m.parameters,filter={efficiency:0,weights:new Float64Array(g.n)};
    const loc={x:1,y:1},v=m.solveFlow(g,loc,{...settings,cadr:0,jet:0});
    const ref=(ratio)=>{let c=m.initConcentration(g),b=new Float64Array(g.n),t=0,sum=0;
     let mean=()=>{let x=0;for(let k=0;k<g.n;k++)if(g.ids[k]>=0)x+=c[k]*g.cellVolumes[k];return x/g.roomVolumes[0];};
     let previous=mean();while(t<60-1e-8){let dt=Math.min(v.scalarDt*ratio,60-t);
       m.stepPM(g,c,b,v,filter,{...settings,cadr:0,jet:0},dt,null);[c,b]=[b,c];let next=mean();sum+=(previous+next)*dt/2;previous=next;t+=dt;}
     return sum/60;};
    return {computed:m.rankingResults[0].dose,ref:ref(1),refHalf:ref(.5),finite:m.rankingResults.every(x=>Number.isFinite(x.dose))};
  }''')
  self.assertTrue(result['finite'])
  self.assertAlmostEqual(result['computed'],result['ref'],delta=.01)
  self.assertAlmostEqual(result['refHalf'],result['ref'],delta=.05)

 def test_powerlaw_matches_analytical_flow_at_relevant_pressures(self):
  results=self.evaluate('''()=>{
   const p=window.AeroPressure.powerFlow,values=[];
   for(const exponent of [.5,.65,.67])for(const dp of [.1,2,4,20]){
    const v=p(dp,100,exponent),analytic=100*Math.pow(dp,exponent);
    values.push({exponent,dp,error:Math.abs(v/analytic-1),sign:p(-dp,100,exponent)});
   }
   return values;
  }''')
  for item in results:
   self.assertLess(item['error'],.01)
   self.assertLess(item['sign'],0)

 def test_one_pointermove_listener_in_production(self):
  from pathlib import Path
  text=(Path(__file__).resolve().parents[1]/'app.js').read_text()
  self.assertEqual(text.count("canvas.addEventListener('pointermove'"),1)

if __name__=='__main__': unittest.main()
