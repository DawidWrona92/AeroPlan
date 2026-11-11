"""AeroPlan 2.10: cross-validated air/mass coupling and grid checks."""
import os
import unittest
from playwright.sync_api import sync_playwright
from test_regressions import fixture

SCENE = """()=>{
 const m=window.__test;
 for(const [key,value] of Object.entries({windSpeed:4,windDirection:0,gustPercent:0,
     ach:0,jet:0,cadr:0,mixing:.012,deposition:0,deltaP:0,
     outside:48,initial:48,maxWindowAch:12}))document.getElementById(key).value=value;
 const A={id:'A',name:'A',x:0,y:0,w:3,h:3,emission:0,extraAch:0};
 const B={id:'B',name:'B',x:3,y:0,w:3,h:3,emission:0,extraAch:0};
 const w={id:'W1',roomId:'A',side:'left',pos:.5,width:1.2,height:1.4,
   state:'open',q100:3,gapMm:5,openPercent:10};
 m.importModel([A,B],[{id:'D',a:'A',b:'B',width:1.2,pos:.5,open:true,kind:'door'}],
  [w,{...w,id:'W2',roomId:'B',side:'right'}]);
 return true;
}"""

class PhysicsFoundations(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.playwright=sync_playwright().start()
  opts={'headless':True,'args':['--no-sandbox']}
  if os.environ.get('AEROPLAN_CHROMIUM'):opts['executable_path']=os.environ['AEROPLAN_CHROMIUM']
  cls.browser=cls.playwright.chromium.launch(**opts)
  cls.html=fixture()
 @classmethod
 def tearDownClass(cls):
  cls.browser.close();cls.playwright.stop()
 def setUp(self):
  self.page=self.browser.new_page(viewport={'width':1480,'height':980})
  self.errors=[];self.page.on('pageerror',lambda e:self.errors.append(str(e)))
  self.page.set_content(self.html)
 def tearDown(self):
  self.assertEqual(self.errors,[],self.errors);self.page.close()
 def evaluate(self,js):return self.page.evaluate(js)
 def scene(self):return self.evaluate(SCENE)

 def test_pressure_door_flow_matches_2d_face_flux_both_directions(self):
  self.scene()
  result=self.evaluate('''()=>{const m=window.__test,stats=[];
  for(const wind of [0,180]){
   document.getElementById('windDirection').value=wind;m.reconfigureConnections();
   const g=m.grid,v=m.velocity,p=m.parameters;let faceFlux=0;
   for(let j=0;j<g.ny;j++)for(let i=1;i<g.nx;i++){
    const f=j*(g.nx+1)+i,l=g.ids[j*g.nx+i-1],r=g.ids[j*g.nx+i];
    if(l===0&&r===1)faceFlux+=v.u[f]*g.uOpen[f]*g.step*p.height*3600;
   }
   stats.push({expected:g.pressureResult.doorFlows.D,actual:faceFlux,
     unmapped:g.unmappedDoorFlow,peak:v.peak});
  }return stats;}''')
  for item in result:
   self.assertGreater(abs(item['expected']),1)
   self.assertAlmostEqual(item['actual'],item['expected'],delta=max(0.1,abs(item['expected'])*.002))
   self.assertEqual(item['unmapped'],0)
  self.assertGreater(result[0]['expected'],-result[1]['expected']*.9)

 def test_uniform_concentration_is_preserved_under_throughflow(self):
  self.scene()
  result=self.evaluate('''()=>{const m=window.__test;m.advance(90);const g=m.grid;
    const values=Array.from(m.concentration).filter((_,k)=>g.ids[k]>=0);
    return {min:Math.min(...values),max:Math.max(...values),peak:m.velocity.peak};}''')
  self.assertAlmostEqual(result['min'],48,delta=.07)
  self.assertAlmostEqual(result['max'],48,delta=.07)

 def test_no_invented_ach_exchange_without_pressure_or_outlets(self):
  self.evaluate('''()=>{
   document.getElementById('windSpeed').value=0;
   document.getElementById('ach').value=.8;
   document.getElementById('initial').value=80;
   document.getElementById('outside').value=0;
   document.getElementById('deposition').value=0;
   document.getElementById('cadr').value=0;
   document.getElementById('jet').value=0;
   window.__test.importModel([{id:'A',name:'A',x:0,y:0,w:3,h:3,extraAch:0,emission:0}]);
  }''')
  result=self.evaluate('''()=>{const m=window.__test,before=m.roomAverages()[0];m.advance(100);
     return {before,after:m.roomAverages()[0],leak:m.grid.pressureResult.leakFlows[0]||0};}''')
  self.assertAlmostEqual(result['leak'],0,delta=1e-4)
  self.assertAlmostEqual(result['after'],result['before'],delta=.01)

 def test_zero_reference_dp_still_allows_wind_driven_window_flow(self):
  self.scene()
  result=self.evaluate('''()=>{const m=window.__test,g=m.grid;
    return {n:g.windowSources.length,door:g.pressureResult.doorFlows.D};}''')
  self.assertEqual(result['n'],2)
  self.assertGreater(result['door'],.1)

 def test_purifier_move_preserves_clock_and_field(self):
  self.scene()
  result=self.evaluate('''()=>{const m=window.__test;m.advance(10);const t=m.elapsed,c=Array.from(m.concentration);
   m.placePurifier(1.6,1.4);return {start:t,after:m.elapsed,loss:c.reduce((sum,x,k)=>sum+Math.abs(x-m.concentration[k]),0)};}''')
  self.assertGreater(result['start'],0)
  self.assertAlmostEqual(result['start'],result['after'],places=8)
  self.assertAlmostEqual(result['loss'],0,places=9)

 def test_grid_refinement_room_average_without_sources(self):
  # A validated convergence baseline: with uniform PM and balanced exterior flows,
  # all supported grids must agree. This is necessary, not sufficient, for ranking stability.
  results=[]
  for step in ['0.3','0.2','0.15']:
   self.evaluate(f"document.getElementById('gridStep').value='{step}'")
   self.scene()
   res=self.evaluate('''()=>{const m=window.__test;m.advance(40);return {
     avg:m.roomAverages(),step:m.grid.step,n:m.grid.n};}''')
   results.append(res)
  for r in results:
   for avg in r['avg']: self.assertAlmostEqual(avg,48,delta=.06)
  self.assertGreater(results[-1]['n'],results[0]['n'])

 def test_grid_refinement_keeps_location_ranking_in_two_room_wind_scenario(self):
  # Quantitative regression on a simple controlled scene. Do not interpret this
  # as proof of grid convergence in every real apartment.
  result=self.evaluate('''()=>{
    const m=window.__test,results=[];
    const A={id:'A',name:'Salon',x:0,y:0,w:3,h:3,emission:600,extraAch:0};
    const B={id:'B',name:'Sypialnia',x:3,y:0,w:3,h:3,emission:0,extraAch:0};
    const D={id:'D',a:'A',b:'B',width:1.2,pos:.5,open:true,kind:'door'};
    const W={id:'W1',roomId:'A',side:'left',pos:.5,width:1.2,height:1.4,
      state:'open',q100:3,gapMm:5,openPercent:10};
    for(const [key,value] of Object.entries({cadr:300,jet:.8,ach:0,outside:48,
      initial:48,mixing:.025,deposition:0,windSpeed:3,windDirection:0,gustPercent:0}))
      document.getElementById(key).value=value;
    for(const cell of [.3,.2,.15]){
      document.getElementById('gridStep').value=cell;
      m.importModel([A,B],[D],[W,{...W,id:'W2',roomId:'B',side:'right'}]);
      const g=m.grid,p=m.parameters,doses=[];
      for(const loc of [{x:1.5,y:1.5},{x:4.5,y:1.5}]){
        let c=m.initConcentration(g),b=new Float64Array(g.n),t=0,dose=0;
        const v=m.solveFlow(g,loc,p),uptake=m.buildIntake(g,loc),dt=Math.min(.25,v.scalarDt);
        while(t<180){const d=Math.min(dt,180-t);
          m.stepPM(g,c,b,v,uptake,p,d,null);[c,b]=[b,c];t+=d;
          let mass=0;for(let i=0;i<g.n;i++)if(g.ids[i]===1)mass+=c[i]*g.cellVolumes[i];
          dose+=mass/g.roomVolumes[1]*d;
        }
        doses.push(dose/180);
      }
      results.push({cell,doses});
    }
    return results;
  }''')
  for item in result:
   self.assertGreater(item['doses'][0],item['doses'][1]*1.05)
  ref=result[1]['doses']
  for item in result:
   for got,want in zip(item['doses'],ref):
    self.assertLess(abs(got-want)/want,.015)

 def test_zero_open_window_cap_does_not_create_unlimited_flow(self):
  self.evaluate("document.getElementById('maxWindowAch').value='0'")
  self.scene() # scene sets maxWindowAch 12; set to zero after import
  result=self.evaluate('''()=>{const m=window.__test;
   document.getElementById('maxWindowAch').value=0;m.reconfigureConnections();
   return {flow:m.grid.pressureResult.doorFlows.D||0,windows:m.grid.pressureResult.windowFlows};
  }''')
  self.assertAlmostEqual(result['flow'],0,delta=1e-4)
  self.assertTrue(all(abs(q)<1e-4 for q in result['windows'].values()))

 def test_clipped_mass_metric_is_defined(self):
  self.assertEqual(self.evaluate("document.getElementById('clippedMetric').textContent"),'0.000 mg')


if __name__ == '__main__':unittest.main()