"""Closed internal doors leak through undercuts. Test UI, physics and JSON migration."""
import json
import unittest
from playwright.sync_api import sync_playwright
from test_regressions import fixture, ROOM_A, ROOM_B


class DoorLeakageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.runtime=sync_playwright().start()
        cfg={'headless':True,'args':['--no-sandbox']}
        if executable:=__import__('os').environ.get('AEROPLAN_CHROMIUM'):
            cfg['executable_path']=executable
        cls.browser=cls.runtime.chromium.launch(**cfg)
        cls.content=fixture()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.runtime.stop()

    def setUp(self):
        self.page=self.browser.new_page(viewport={'width':1400,'height':900})
        self.errors=[]
        self.page.on('pageerror',lambda err:self.errors.append(str(err)))
        self.page.set_content(self.content)
        self.assertTrue(self.page.evaluate('Boolean(window.__test.grid)'))

    def tearDown(self):
        self.assertEqual(self.errors,[],f'Browser exceptions: {self.errors}')
        self.page.close()

    def eval(self,script):
        return self.page.evaluate(script)

    def test_default_and_custom_equivalent_area(self):
        result = self.eval('''()=>{const m=window.__test;
          m.importModel([{id:'A',name:'A',x:0,y:0,w:3,h:3,emission:0,extraAch:0},
                         {id:'B',name:'B',x:3,y:0,w:3,h:3,emission:0,extraAch:0}],
                        [{id:'D',a:'A',b:'B',width:.8,pos:.5,open:false,kind:'door'}]);
          const door=m.doors[0];const initial=m.doorLeakArea(door);
          door.gapMm=20;door.frameLeakCm2=0;
          return {initial,custom:m.doorLeakArea(door),
                  q2:m.doorFlowAtPa(door,2),
                  half:m.doorFlowAtPa(door,0.5)};}''')
        self.assertAlmostEqual(result['initial'], .0084, places=6)
        self.assertAlmostEqual(result['custom'], .016, places=6)
        self.assertGreater(result['q2'], result['half'])

    def test_grid_partially_permeable_only_when_closed(self):
        result = self.eval('''()=>{const m=window.__test;
          m.importModel([{id:'A',name:'A',x:0,y:0,w:3,h:3,emission:0,extraAch:0},
                         {id:'B',name:'B',x:3,y:0,w:3,h:3,emission:0,extraAch:0}],
                        [{id:'D',a:'A',b:'B',width:1.2,pos:.5,open:false,kind:'door'}]);
          const d=m.doors[0];const at=m.passageFraction(0,1,'x',1.4,1.6);
          d.gapMm=0;d.frameLeakCm2=0;const sealed=m.passageFraction(0,1,'x',1.4,1.6);
          d.open=true;const opened=m.passageFraction(0,1,'x',1.4,1.6);
          return {at,sealed,opened};}''')
        self.assertGreater(result['at'], 0)
        self.assertLess(result['at'], .02)
        self.assertEqual(result['sealed'], 0)
        self.assertAlmostEqual(result['opened'], 1)

    def test_updating_gap_does_not_reset_clock(self):
        self.eval('''()=>window.__test.importModel(
          [{id:'A',name:'A',x:0,y:0,w:3,h:3,emission:0,extraAch:0},
           {id:'B',name:'B',x:3,y:0,w:3,h:3,emission:0,extraAch:0}],
          [{id:'D',a:'A',b:'B',width:1.2,pos:.5,open:false,kind:'door'}])''')
        self.eval('window.__test.advance(10)')
        start = self.eval('window.__test.elapsed')
        field = self.page.locator('#doors [data-role=gapMm]').first
        field.fill('15')
        field.dispatch_event('change')
        result = self.eval('''()=>({now:window.__test.elapsed,gap:window.__test.doors[0].gapMm,
                            area:window.__test.doorLeakArea(window.__test.doors[0])})''')
        self.assertAlmostEqual(result['now'], start, places=6)
        self.assertEqual(result['gap'], 15)
        self.assertGreater(result['area'], 0)

    def test_old_json_gets_default_gap_and_new_json_retains_edited_gap(self):
        base = {'rooms':[dict(ROOM_A),dict(ROOM_B)],'windows':[], 'vents':[]}
        old = {**base,'version':6,'doors':[{'a':'A','b':'B','width':.8,'pos':.5,'open':False,'kind':'door'}]}
        self.page.locator('#jsonFile').set_input_files({'name':'old.json','mimeType':'application/json','buffer':json.dumps(old).encode()})
        self.assertAlmostEqual(self.eval('window.__test.doorLeakArea(window.__test.doors[0])'), .0084, places=6)
        newer = {**base,'version':7,'doors':[{'a':'A','b':'B','width':.8,'pos':.5,'open':False,'kind':'door','gapMm':22,'frameLeakCm2':18}]}
        self.page.locator('#jsonFile').set_input_files({'name':'new.json','mimeType':'application/json','buffer':json.dumps(newer).encode()})
        self.assertEqual(self.eval('''()=>[window.__test.doors[0].gapMm,window.__test.doors[0].frameLeakCm2]'''), [22,18])

    def test_closed_door_gap_allows_pressure_driven_cross_room_flux(self):
        result=self.eval('''()=>{
          const m=window.__test;
          for(const [key,value] of Object.entries({windSpeed:4,windDirection:0,gustPercent:0,
             ach:0,jet:0,cadr:0,mixing:.01,deposition:0}))document.getElementById(key).value=value;
          const A={id:'A',name:'A',x:0,y:0,w:3,h:3,emission:0,extraAch:0};
          const B={id:'B',name:'B',x:3,y:0,w:3,h:3,emission:0,extraAch:0};
          const w={id:'W1',roomId:'A',side:'left',pos:.5,width:1.2,height:1.4,
            state:'open',q100:3,gapMm:5,openPercent:10};
          const check=gap=>{
            m.importModel([A,B],[{id:'D',a:'A',b:'B',width:.9,pos:.5,open:false,
               kind:'door',gapMm:gap,frameLeakCm2:0}],[w,{...w,id:'W2',roomId:'B',side:'right'}]);
            const g=m.grid,v=m.velocity;
            let faceFlux=0;
            for(let j=0;j<g.ny;j++)for(let i=1;i<g.nx;i++){
              let f=j*(g.nx+1)+i,l=g.ids[j*g.nx+i-1],r=g.ids[j*g.nx+i];
              if(l===0&&r===1)faceFlux+=v.u[f]*g.uOpen[f]*g.step*m.parameters.height*3600;
            }
            return {faceFlux,doorFlow:g.pressureResult.doorFlows.D||0};
          };return {sealed:check(0),leaky:check(10)};
        }''')
        self.assertAlmostEqual(result['sealed']['faceFlux'],0,places=5)
        self.assertAlmostEqual(result['sealed']['doorFlow'],0,places=5)
        self.assertGreater(result['leaky']['faceFlux'],1)
        self.assertGreater(result['leaky']['doorFlow'],1)

    def test_pressure_reverses_with_wind(self):
        result=self.eval('''()=>{const m=window.__test;
          const model={rooms:[{w:3,h:3},{w:3,h:3}],windows:[
          {id:'L',roomIndex:0,area:1.4,openArea:.22,state:'open',side:'left'},
          {id:'R',roomIndex:1,area:1.4,openArea:.22,state:'open',side:'right'}],
          doors:[{id:'D',a:0,b:1,area:.0104}],backgroundAch:0,windSpeed:3};
          const positive=window.AeroPressure.solve({...model,windDirection:0});
          const negative=window.AeroPressure.solve({...model,windDirection:180});
          return {positive:positive.doorFlows.D,negative:negative.doorFlows.D,
                  a:positive.maxResidual,b:negative.maxResidual};}''')
        self.assertGreater(result['positive'], 0)
        self.assertLess(result['negative'], 0)
        self.assertLess(result['a'], .05)
        self.assertLess(result['b'], .05)

if __name__ == '__main__':
    unittest.main()
