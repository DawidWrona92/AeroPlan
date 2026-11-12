"""Regression tests for editable ventilation grilles and movable openings."""
import json
import os
import unittest
from playwright.sync_api import sync_playwright
from test_regressions import fixture, ROOM_A


class AeroPlanEditorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.runtime = sync_playwright().start()
        cfg = {'headless': True, 'args': ['--no-sandbox']}
        if os.environ.get('AEROPLAN_CHROMIUM'):
            cfg['executable_path'] = os.environ['AEROPLAN_CHROMIUM']
        cls.browser = cls.runtime.chromium.launch(**cfg)
        cls.html = fixture()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.runtime.stop()

    def setUp(self):
        self.page = self.browser.new_page(viewport={'width': 1600, 'height': 1000})
        self.errors = []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.page.set_content(self.html)
        self.assertTrue(self.page.evaluate('Boolean(window.__test.grid)'))

    def tearDown(self):
        self.assertEqual(self.errors, [], f'Unhandled browser exceptions: {self.errors}')
        self.page.close()

    def world(self, x, y):
        return self.page.evaluate('''([x,y]) => {
          const c=document.getElementById('field'),b=c.getBoundingClientRect(),t=window.__test.viewTransform;
          return {x:b.x+(t.offX+x*t.scale)*b.width/c.width,
                  y:b.y+(t.offY+y*t.scale)*b.height/c.height};
        }''', [x,y])

    def test_kitchen_has_distinct_emission_and_visible_demo_exhaust(self):
        result = self.page.evaluate('''()=>{
          const m=window.__test,r=m.rooms.find(x=>x.name==='Kuchnia');
          return {emission:r.emission,
                  vents:m.vents.filter(v=>v.roomId===r.id).map(x=>({type:x.type,rate:x.rate})),
                  cards:document.querySelectorAll('#vents .vent-item').length};
        }''')
        self.assertEqual(result['emission'], 1350)
        self.assertEqual(result['vents'], [{'type': 'exhaust', 'rate': 30}])
        self.assertEqual(result['cards'], 1)

    def test_legacy_room_airflow_is_migrated_once(self):
        result = self.page.evaluate('''()=>{
          const m=window.__test;
          m.importModel([{id:'A',name:'A',x:0,y:0,w:3,h:3,emission:0,extraAch:0,
            supplyM3h:120,supplyX:1.3,supplyY:2.1}]);
          const a=m.vents.map(v=>({type:v.type,rate:v.rate,x:v.x,y:v.y}));
          const previous=Object.keys(m.grid.pressureResult.ventFlows);
          document.querySelector('#rooms input[data-key=name]').dispatchEvent(new Event('change'));
          return {a,n:m.vents.length,legacy:m.rooms[0].supplyM3h,previous};
        }''')
        self.assertEqual(result['a'], [{'type':'supply','rate':120,'x':1.3,'y':2.1}])
        self.assertEqual(result['n'], 1)
        self.assertEqual(result['legacy'], 0)
        self.assertEqual(len(result['previous']), 1)

    def test_vent_properties_change_pressure_and_source_cell_without_clock_reset(self):
        result = self.page.evaluate('''()=>{
          const m=window.__test;m.advance(20);
          const start=m.elapsed,id=m.vents[0].id,oldCell=m.grid.airSources.find(x=>x.id===id).cells[0];
          let item=document.querySelector('#vents .vent-item');
          item.querySelector('[data-v=rate]').value=65;
          item.querySelector('[data-v=rate]').dispatchEvent(new Event('change',{bubbles:true}));
          item=document.querySelector('#vents .vent-item');
          item.querySelector('[data-v=x]').value=1.1;
          item.querySelector('[data-v=x]').dispatchEvent(new Event('change',{bubbles:true}));
          const next=m.grid.airSources.find(x=>x.id===id);
          return {start,now:m.elapsed,rate:next.netQ,position:m.vents[0].x,
                  oldCell,newCell:next.cells[0]};
        }''')
        self.assertGreater(result['start'], 0)
        self.assertAlmostEqual(result['now'], result['start'], places=6)
        self.assertEqual(result['rate'], -65)
        self.assertEqual(result['position'], 1.1)
        self.assertNotEqual(result['oldCell'], result['newCell'])

    def test_drag_door_along_shared_wall_keeps_clock(self):
        self.page.locator('[data-tool=item]').click()
        self.page.locator('#field').scroll_into_view_if_needed()
        before = self.page.evaluate('''()=>{const m=window.__test;m.advance(15);return {
          pos:m.doors[0].pos,elapsed:m.elapsed};}''')
        src=self.world(4.5,2.08)
        dst=self.world(4.5,2.7)
        self.page.mouse.move(src['x'],src['y'])
        self.page.mouse.down()
        self.page.mouse.move(dst['x'],dst['y'],steps=9)
        self.page.mouse.up()
        after=self.page.evaluate('''()=>{const m=window.__test,d=m.doors[0];return {
          pos:d.pos,elapsed:m.elapsed,geometry:m.passageGeometry(d),
          valid:!m.passageOverlap(d)};}''')
        self.assertGreater(after['pos'], before['pos']+.07)
        self.assertAlmostEqual(after['elapsed'], before['elapsed'], places=6)
        self.assertTrue(after['valid'])
        self.assertGreater(after['geometry']['from'], 0)

    def test_drag_vent_inside_room_and_preserve_clock(self):
        self.page.locator('[data-tool=item]').click()
        self.page.locator('#field').scroll_into_view_if_needed()
        before=self.page.evaluate('''()=>{const m=window.__test;m.advance(15);
          const p=m.ventPosition(m.vents[0]);return {x:p.x,y:p.y,elapsed:m.elapsed};}''')
        src=self.world(before['x'], before['y'])
        dst=self.world(7.5, 1.6)
        self.page.mouse.move(src['x'],src['y'])
        self.page.mouse.down()
        self.page.mouse.move(dst['x'],dst['y'],steps=10)
        self.page.mouse.up()
        after=self.page.evaluate('''()=>{const m=window.__test,v=m.vents[0],r=m.rooms.find(x=>x.id===v.roomId);return {
          x:v.x,y:v.y,w:r.w,h:r.h,elapsed:m.elapsed};}''')
        self.assertLess(after['x'], after['w']-.049)
        self.assertGreater(after['y'], .05)
        self.assertAlmostEqual(after['elapsed'],before['elapsed'],places=6)
        self.assertNotAlmostEqual(after['x'], before['x'], delta=.1)

    def test_delete_vent_removes_pressure_link(self):
        result=self.page.evaluate('''()=>{const m=window.__test,id=m.vents[0].id;
          document.querySelector('#vents [data-remove]').click();
          return {exists:m.vents.some(v=>v.id===id),
                  hasFlow:Object.hasOwn(m.grid.pressureResult.ventFlows,id),
                  count:document.querySelectorAll('#vents .vent-item').length};}''')
        self.assertEqual(result,{'exists':False,'hasFlow':False,'count':0})

    def test_passage_boundary_coverage_matches_geometry(self):
        r=self.page.evaluate('''()=>{const m=window.__test,d=m.doors[0];d.pos=0;
          m.reconfigureConnections();const geo=m.passageGeometry(d),a=m.rooms.find(r=>r.id===d.a),b=m.rooms.find(r=>r.id===d.b);
          let coverage=0;for(let x=geo.from;x<geo.to-1e-7;x+=.005)
            coverage+=m.passageFraction(m.rooms.indexOf(a),m.rooms.indexOf(b),geo.axis,x,Math.min(x+.005,geo.to))*.005;
          return {span:geo.to-geo.from,coverage};}''')
        self.assertAlmostEqual(r['span'],r['coverage'],delta=.02)

    def test_import_json_ventilation_is_editable(self):
        model={'version':6,'rooms':[dict(ROOM_A)],'doors':[],'windows':[],
          'vents':[{'roomId':'A','type':'exhaust','rate':55,'x':1.25,'y':1.75}]}
        self.page.locator('#jsonFile').set_input_files(files=[{'name':'plan.json','mimeType':'application/json','buffer':json.dumps(model).encode()}])
        self.page.wait_for_timeout(100)
        result=self.page.evaluate('''()=>{const m=window.__test;return {
           v:m.vents.map(v=>[v.type,v.rate,v.x,v.y]),
           sources:m.grid.airSources.filter(x=>m.vents.some(v=>v.id===x.id)).length};}''')
        self.assertEqual(result['v'],[['exhaust',55,1.25,1.75]])
        self.assertEqual(result['sources'],1)

    def test_add_vent_with_canvas_click(self):
        self.page.locator('.editbar-more summary').click()
        self.page.locator('[data-tool=supply]').click()
        self.page.locator('#field').scroll_into_view_if_needed()
        at=self.world(2,1.5)
        self.page.mouse.click(at['x'],at['y'])
        result=self.page.evaluate('''()=>{const m=window.__test;return m.vents.filter(v=>v.type==='supply').map(v=>[v.rate,v.x,v.y]);}''')
        self.assertEqual(result,[[30,2,1.5]])

    def test_door_overlap_move_rejected(self):
        result=self.page.evaluate('''()=>{
          const m=window.__test,d=m.doors[0],a=m.rooms.find(r=>r.id===d.a),b=m.rooms.find(r=>r.id===d.b);
          return {overlap:m.passageOverlap({...d,id:'new',pos:d.pos}),
            own:m.passageOverlap(d)};}''')
        self.assertTrue(result['overlap'])
        self.assertFalse(result['own'])
