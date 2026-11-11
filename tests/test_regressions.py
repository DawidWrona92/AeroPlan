"""AeroPlan regression tests: UI and conservative numerical calculations.

Run: python -m unittest discover -s tests -v
Requires Playwright for Python and a Chromium binary.
AEROPLAN_CHROMIUM=/usr/bin/chromium overrides the bundled Playwright browser.
"""
import os
import unittest
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = Path(__file__).resolve().parent.parent
HOOK = '''
window.__test = {
 get rooms(){return rooms;},get doors(){return doors;},get windows(){return windows;},
 get grid(){return grid;},get concentration(){return concentration;},get velocity(){return velocity;},get elapsed(){return elapsed;},
 get parameters(){return userParameters;},
 windowGeometry,validWindow,validateRooms,buildGrid,passageFraction,reconfigureConnections,configureWindowAirflow,stepPM,solveFlow,windowQ,roomAverages,roomPercentiles,rebuild,
 importModel:(rr,dd=[],ww=[])=>{
  rooms=rr;doors=dd;windows=ww;
  purifier={x:(rr[0]?.x||0)+(rr[0]?.w||3)/2,y:(rr[0]?.y||0)+(rr[0]?.h||3)/2};
  renderEditors();rebuild();
 },
 advance:(steps=25)=>{
  for(let i=0;i<steps;i++){
   const dt=Math.min(velocity.scalarDt,.8);
   stepPM(grid,concentration,buffer,velocity,intake,userParameters,dt,null);
   [concentration,buffer]=[buffer,concentration];elapsed+=dt;
  }
  updateMetrics();
 }
};
'''

def fixture():
    html = (BASE/'index.html').read_text(encoding='utf-8')
    js = (BASE/'app.js').read_text(encoding='utf-8')
    assert js.rstrip().endswith('})();'), 'App entry point changed; update diagnostic fixture'
    js = js[:js.rfind('})();')] + HOOK + '})();'
    css = (BASE/'styles.css').read_text(encoding='utf-8')
    pressure = (BASE/'airflow-network.js').read_text(encoding='utf-8')
    return html.replace('<script src="airflow-network.js"></script>', '<script>'+pressure+'</script>') \
        .replace('<link rel="stylesheet" href="styles.css">', '<style>'+css+'</style>') \
        .replace('<script src="app.js"></script>', '<script>'+js+'</script>')

ROOM_A = {'id':'A','name':'A','x':0,'y':0,'w':3,'h':3,'emission':0,'extraAch':0}
ROOM_B = {'id':'B','name':'B','x':3,'y':0,'w':3,'h':3,'emission':0,'extraAch':0}
DOOR = {'id':'D','a':'A','b':'B','width':1.2,'pos':0.5,'open':True,'kind':'door'}
WIN_LEFT = {'id':'W1','roomId':'A','side':'left','pos':0.5,'width':1.2,'height':1.4,
            'state':'open','q100':3,'gapMm':5,'openPercent':10}
WIN_RIGHT = {**WIN_LEFT,'id':'W2','roomId':'B','side':'right'}

class AeroPlanTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.runtime = sync_playwright().start()
        kwargs = {'headless':True, 'args':['--no-sandbox']}
        executable = os.environ.get('AEROPLAN_CHROMIUM')
        if executable:kwargs['executable_path'] = executable
        cls.browser = cls.runtime.chromium.launch(**kwargs)
        cls.content = fixture()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.runtime.stop()

    def setUp(self):
        self.page = self.browser.new_page(viewport={'width':1400,'height':900})
        self.errors = []
        self.page.on('pageerror', lambda e:self.errors.append(str(e)))
        self.page.set_content(self.content)
        self.assertTrue(self.page.evaluate('Boolean(window.__test.grid)'))

    def tearDown(self):
        self.assertEqual(self.errors,[],f'Uncaught JS exceptions: {self.errors}')
        self.page.close()

    def eval(self,script):
        return self.page.evaluate(script)

    def test_duplicate_window_is_rejected(self):
        self.assertEqual(self.eval('''()=>{let m=window.__test,w=m.windows[0];return [m.validWindow(w),m.validWindow({...w,id:'NEW'})];}'''),[True,False])

    def test_window_at_wall_corner_keeps_full_width(self):
        self.assertAlmostEqual(self.eval('''()=>{let m=window.__test,w={...m.windows[0],pos:0,width:1.2};let g=m.windowGeometry(w);return g.to-g.from;}'''),1.2)

    def test_exact_room_overlap_validation_and_atomic_form(self):
        self.eval('''()=>window.__test.importModel([{id:'A',name:'A',x:0,y:0,w:3,h:3,emission:0,extraAch:0},{id:'B',name:'B',x:3,y:0,w:3,h:3,emission:0,extraAch:0}])''')
        self.assertIn('nakładają', self.eval('''()=>{try{window.__test.validateRooms([{id:'x',name:'X',x:0,y:0,w:3,h:3},{id:'y',name:'Y',x:2.95,y:0,w:3,h:3}]);return 'accepted';}catch(e){return e.message;}}'''))
        w=self.page.locator('#rooms .room').first.locator('[data-key="w"]')
        w.fill('3.4');w.dispatch_event('change')
        self.assertEqual(self.page.locator('#rooms .room').first.locator('[data-key="w"]').input_value(),'3')
        self.assertIn('odrzucona',self.page.locator('#status').inner_text())

    def test_narrow_door_has_fractional_open_faces(self):
        self.eval('''()=>{let m=window.__test,a={id:'A',name:'A',x:0,y:0,w:3,h:35,emission:0,extraAch:0},b={id:'B',name:'B',x:3,y:0,w:3,h:35,emission:0,extraAch:0};m.importModel([a,b],[{id:'d',a:'A',b:'B',width:.3,pos:.01,open:true,kind:'door'}]);}''')
        result=self.eval('''()=>{let g=window.__test.grid;return [...g.uOpen].filter(x=>x>0&&x<1).length;}''')
        self.assertGreater(result,0)

    def test_door_change_in_sidebar_keeps_clock(self):
        self.eval('''()=>window.__test.importModel([{id:'A',name:'A',x:0,y:0,w:3,h:3,emission:0,extraAch:0},{id:'B',name:'B',x:3,y:0,w:3,h:3,emission:0,extraAch:0}],[{id:'D',a:'A',b:'B',width:1.2,pos:.5,open:true,kind:'door'}])''')
        self.eval('window.__test.advance(40)')
        before=self.eval('window.__test.elapsed')
        self.page.locator('[data-role="open"]').first.uncheck()
        self.assertAlmostEqual(before,self.eval('window.__test.elapsed'))

    def test_tiny_room_volume_independent_of_grid_offset(self):
        results=self.eval('''()=>{let m=window.__test,values=[];for(const offset of [0,.15]){m.importModel([{id:'A',name:'A',x:offset,y:offset,w:.5,h:.5,emission:0,extraAch:0}]);let g=m.grid;values.push({area:g.areaByRoom[0],volume:g.cellVolumes.reduce((a,b)=>a+b,0),cells:g.cellByRoom[0]});}return values;}''')
        for result in results:
            self.assertAlmostEqual(result['area'],0.25)
            self.assertAlmostEqual(result['volume'],0.25*2.6)

    def test_diffusion_conserves_mass_across_unequal_rooms(self):
        result=self.eval('''()=>{let m=window.__test,a={id:'A',name:'A',x:0,y:0,w:3,h:2,emission:0,extraAch:0},b={id:'B',name:'B',x:3,y:0,w:.6,h:2,emission:0,extraAch:0};m.importModel([a,b],[{id:'D',a:'A',b:'B',width:1,pos:.5,open:true,kind:'door'}]);let g=m.grid,c=new Float64Array(g.n),out=new Float64Array(g.n);for(let k=0;k<g.n;k++)if(g.ids[k]>=0)c[k]=g.ids[k]===0?100:0;let mass=()=>c.reduce((a,v,k)=>a+v*g.cellVolumes[k],0),before=mass();const vel={u:new Float32Array(g.uOpen.length),v:new Float32Array(g.vOpen.length)},filter={efficiency:0,weights:new Float64Array(g.n)},p={...m.parameters,ach:0,deposition:0,mixing:.035,cadr:0};for(let i=0;i<80;i++){m.stepPM(g,c,out,vel,filter,p,.05,null);c.set(out);}return [before,mass(),Math.min(...c.filter(v=>v!==0))];}''')
        self.assertAlmostEqual(result[0],result[1],places=6)
        self.assertGreaterEqual(result[2],0)

    def test_wind_window_flow_has_balanced_divergence(self):
        self.eval('''()=>{let m=window.__test;m.importModel([{id:'A',name:'A',x:0,y:0,w:3,h:3,emission:0,extraAch:0},{id:'B',name:'B',x:3,y:0,w:3,h:3,emission:0,extraAch:0}],[{id:'D',a:'A',b:'B',width:1.8,pos:.5,open:true,kind:'door'}],[{id:'W1',roomId:'A',side:'left',pos:.5,width:1.2,height:1.4,state:'open',q100:3,gapMm:5,openPercent:10},{id:'W2',roomId:'B',side:'right',pos:.5,width:1.2,height:1.4,state:'open',q100:3,gapMm:5,openPercent:10}]);for(const k of ['cadr','jet','ach','deposition'])document.getElementById(k).value=0;document.getElementById('outside').value=48;document.getElementById('initial').value=48;m.rebuild();}''')
        result=self.eval('''()=>{let m=window.__test,g=m.grid,v=m.velocity,p=m.parameters;let residual=0;for(let k=0;k<g.n;k++){if(g.ids[k]<0)continue;let i=k%g.nx,j=(k/g.nx)|0;let flux=(v.u[j*(g.nx+1)+i+1]*g.uOpen[j*(g.nx+1)+i+1]-v.u[j*(g.nx+1)+i]*g.uOpen[j*(g.nx+1)+i]+v.v[(j+1)*g.nx+i]*g.vOpen[(j+1)*g.nx+i]-v.v[j*g.nx+i]*g.vOpen[j*g.nx+i])*g.step*p.height;residual=Math.max(residual,Math.abs(flux-g.netWindowFlow[k]*v.windowFlowScale));}let maxV=Math.max(...v.u.map(Math.abs),...v.v.map(Math.abs));let c=new Float64Array(g.n),out=new Float64Array(g.n);for(let k=0;k<g.n;k++)if(g.ids[k]>=0)c[k]=48;let f={efficiency:0,weights:new Float64Array(g.n)};for(let i=0;i<100;i++){m.stepPM(g,c,out,v,f,p,Math.min(.15,v.scalarDt),null);c.set(out);}return {residual,maxV,min:Math.min(...c.filter((x,k)=>g.ids[k]>=0)),max:Math.max(...c),net:g.windowSources.map(w=>w.netQ)};}''')
        self.assertGreater(result['maxV'],0.001)
        self.assertAlmostEqual(sum(result['net']),0,places=7)
        self.assertLess(result['residual'],.002)
        self.assertAlmostEqual(result['min'],48,places=2)
        self.assertAlmostEqual(result['max'],48,places=2)

    def test_closed_doors_do_not_create_fictitious_cross_window_flow(self):
        result=self.eval('''()=>{document.getElementById('ach').value=0;const m=window.__test;const A={id:'A',name:'A',x:0,y:0,w:3,h:3,emission:0,extraAch:0},B={id:'B',name:'B',x:3,y:0,w:3,h:3,emission:0,extraAch:0};const d={id:'D',a:'A',b:'B',width:1.2,pos:.5,open:false,kind:'door'},w={id:'W1',roomId:'A',side:'left',pos:.5,width:1.2,height:1.4,state:'open',q100:3,gapMm:5,openPercent:10};m.importModel([A,B],[d],[w,{...w,id:'W2',roomId:'B',side:'right'}]);return m.grid.windowSources.map(x=>x.netQ);}''')
        self.assertTrue(all(abs(v)<1e-6 for v in result))

    def test_invalid_import_preserves_previous_plan(self):
        before=self.eval('window.__test.rooms.length')
        invalid='''{"rooms":[{"id":"A","name":"A","x":0,"y":0,"w":3,"h":3},{"id":"B","name":"B","x":2.95,"y":0,"w":3,"h":3}]}'''
        self.page.locator('#jsonFile').set_input_files({'name':'invalid.json','mimeType':'application/json','buffer':invalid.encode('utf-8')})
        self.page.wait_for_function("document.getElementById('status').textContent.includes('Nie udało się zaimportować')")
        self.assertEqual(before,self.eval('window.__test.rooms.length'))

    def test_pressure_network_two_windows_and_door_balances_mass(self):
        result = self.eval('''()=>{const p=window.__test.parameters;return window.AeroPressure.solve({rooms:[{w:3,h:3},{w:3,h:3}],windows:[{id:'left',roomIndex:0,area:1.4,openArea:.24,state:'open',side:'left',maxQ:600},{id:'right',roomIndex:1,area:1.4,openArea:.24,state:'open',side:'right',maxQ:600}],doors:[{id:'d',a:0,b:1,area:2}],windSpeed:4,windDirection:0,backgroundAch:0,height:2.6});}''')
        self.assertTrue(result['converged'])
        self.assertLess(result['maxResidual'],.005)
        self.assertGreater(result['windowFlows']['left'],0)
        self.assertLess(result['windowFlows']['right'],0)
        self.assertGreater(result['doorFlows']['d'],0)
        self.assertAlmostEqual(result['totalSupply'],result['totalExhaust'],places=3)

    def test_wind_direction_changes_window_flow(self):
        result=self.eval('''()=>{const args={rooms:[{w:3,h:3},{w:3,h:3}],windows:[{id:'left',roomIndex:0,area:1.4,openArea:.2,state:'open',side:'left'},{id:'right',roomIndex:1,area:1.4,openArea:.2,state:'open',side:'right'}],doors:[{id:'door',a:0,b:1,area:1.5}],windSpeed:3,backgroundAch:0,height:2.6};const a=window.AeroPressure.solve({...args,windDirection:0}),b=window.AeroPressure.solve({...args,windDirection:180});return [a.windowFlows.left,b.windowFlows.left,a.maxResidual,b.maxResidual];}''')
        self.assertGreater(result[0],0)
        self.assertLess(result[1],0)
        self.assertLess(result[2],.01)
        self.assertLess(result[3],.01)

    def test_exhaust_fan_draws_replacement_air(self):
        result=self.eval('''()=>window.AeroPressure.solve({rooms:[{w:3,h:3}],windows:[{id:'w',roomIndex:0,area:1.5,openArea:.2,state:'open',side:'left'}],vents:[{id:'fan',roomIndex:0,type:'exhaust',rate:100}],windSpeed:0,backgroundAch:0,height:2.6})''')
        self.assertTrue(result['converged'])
        self.assertAlmostEqual(result['windowFlows']['w'],100,places=3)
        self.assertAlmostEqual(result['ventFlows']['fan'],-100,places=3)

    def test_airtight_exhaust_is_not_invented_as_flow(self):
        result=self.eval('''()=>{document.getElementById('ach').value=0;const m=window.__test;m.importModel([{id:'A',name:'A',x:0,y:0,w:3,h:3,emission:0,extraAch:0,exhaustM3h:100,supplyM3h:0}]);return {ok:m.grid.pressureResult.converged,source:[...m.grid.netWindowFlow].reduce((a,b)=>a+Math.abs(b),0),msg:document.getElementById('status').innerText}}''')
        self.assertFalse(result['ok'])
        self.assertEqual(result['source'],0)
        self.assertIn('UWAGA',result['msg'])

    def test_grid_resolution_controls_cell_count(self):
        result=self.eval('''()=>{const m=window.__test;const e=document.getElementById('gridStep');e.value='0.3';m.rebuild();const coarse=[m.grid.step,m.grid.n];e.value='0.15';m.rebuild();const fine=[m.grid.step,m.grid.n];return {coarse,fine};}''')
        self.assertAlmostEqual(result['coarse'][0],.3)
        self.assertAlmostEqual(result['fine'][0],.15)
        self.assertGreater(result['fine'][1],result['coarse'][1])

    def test_gust_changes_window_network_boundary(self):
        result=self.eval('''()=>{const m=window.__test;document.getElementById('ach').value=0;document.getElementById('windSpeed').value=3;document.getElementById('gustPercent').value=40;document.getElementById('gustPeriod').value=180;const rooms=[{id:'A',name:'A',x:0,y:0,w:3,h:3,emission:0,extraAch:0},{id:'B',name:'B',x:3,y:0,w:3,h:3,emission:0,extraAch:0}],door=[{id:'d',a:'A',b:'B',width:1.3,pos:.5,kind:'door',open:true}],w={id:'w1',roomId:'A',side:'left',pos:.5,width:1.2,height:1.35,state:'open',q100:3,gapMm:5,openPercent:15};m.importModel(rooms,door,[w,{...w,id:'w2',roomId:'B',side:'right'}]);const g=m.grid,p=m.parameters;const before=g.windowSources[0].netQ;m.configureWindowAirflow(g,p,45);return [before,g.windowSources[0].netQ,g.windSpeedActual];}''')
        self.assertGreater(result[0],0)
        self.assertGreater(result[1],result[0])
        self.assertGreater(result[2],3)

    def test_local_pm_percentile_exposes_unaveraged_hotspot(self):
        result=self.eval('''()=>{const m=window.__test,g=m.grid,c=m.concentration;const indices=[];for(let k=0;k<g.n;k++)if(g.ids[k]===0)indices.push(k);for(let k of indices)c[k]=20;for(let i=0;i<Math.ceil(indices.length*.2);i++)c[indices[i]]=100;const values=m.roomPercentiles();return {p90:values[0],avg:m.roomAverages()[0],cells:indices.length};}''')
        self.assertGreater(result['cells'],20)
        self.assertGreater(result['p90'],result['avg'])
        self.assertAlmostEqual(result['p90'],100)

    def test_balanced_supply_exhaust_preserves_uniform_pm(self):
        result=self.eval('''()=>{const m=window.__test;for(const [key,val] of Object.entries({ach:0,deposition:0,mixing:.025,cadr:0,jet:0,outside:48,initial:48,windSpeed:0})){document.getElementById(key).value=val;}m.importModel([{id:'R',name:'R',x:0,y:0,w:4,h:4,emission:0,extraAch:0,supplyM3h:200,exhaustM3h:200,supplyX:.4,supplyY:.4,exhaustX:3.6,exhaustY:3.6}]);const g=m.grid,v=m.velocity,cur=new Float64Array(g.n),out=new Float64Array(g.n);for(let k=0;k<g.n;k++)if(g.ids[k]>=0)cur[k]=48;const uptake={weights:new Float64Array(g.n),efficiency:0},settings={...m.parameters};for(let i=0;i<75;i++){m.stepPM(g,cur,out,v,uptake,settings,.06,null);cur.set(out);}let low=Infinity,hi=-Infinity;for(let k=0;k<g.n;k++)if(g.ids[k]>=0){low=Math.min(low,cur[k]);hi=Math.max(hi,cur[k]);}return {low,hi,pressure:g.pressureResult.maxResidual};}''')
        self.assertLess(result['pressure'],.001)
        self.assertAlmostEqual(result['low'],48,places=1)
        self.assertAlmostEqual(result['hi'],48,places=1)

    def test_windward_room_becomes_more_polluted_with_smoky_outdoor_air(self):
        result=self.eval('''()=>{const m=window.__test;for(const [key,value] of Object.entries({windDirection:0,windSpeed:4,ach:0,cadr:0,jet:0,initial:20,outside:180,mixing:.015,deposition:0,gustPercent:0}))document.getElementById(key).value=value;const a={id:'A',name:'A',x:0,y:0,w:3,h:3,emission:0,extraAch:0},b={id:'B',name:'B',x:3,y:0,w:3,h:3,emission:0,extraAch:0},d={id:'D',a:'A',b:'B',width:1.6,pos:.5,open:true,kind:'door'},w={id:'W1',roomId:'A',side:'left',pos:.5,width:1.2,height:1.4,state:'open',q100:3,gapMm:5,openPercent:20};m.importModel([a,b],[d],[w,{...w,id:'W2',roomId:'B',side:'right'}]);const g=m.grid,c=m.concentration,out=new Float64Array(g.n),vf=m.velocity,up={efficiency:0,weights:new Float64Array(g.n)};for(let i=0;i<350;i++){m.stepPM(g,c,out,vf,up,m.parameters,Math.min(vf.scalarDt,.12),null);c.set(out);}return {avgs:m.roomAverages(),inflow:g.pressureResult.windowFlows.W1,outflow:g.pressureResult.windowFlows.W2};}''')
        self.assertGreater(result['inflow'],0)
        self.assertLess(result['outflow'],0)
        self.assertGreater(result['avgs'][0],result['avgs'][1]+4)
        self.assertGreater(result['avgs'][1],20)

if __name__ == '__main__':
    unittest.main()