"""Project persistence: autosave/reload, named snapshots and safe storage failure."""
import os
import unittest
from playwright.sync_api import sync_playwright
from test_regressions import fixture

class SavedProjects(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html=fixture()
        cls.playwright=sync_playwright().start()
        config={'headless':True,'args':['--no-sandbox']}
        if os.getenv('AEROPLAN_CHROMIUM'):
            config['executable_path']=os.environ['AEROPLAN_CHROMIUM']
        cls.browser=cls.playwright.chromium.launch(**config)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def make_page(self,seed=None,blocked=False):
        page=self.context.new_page()
        page.on('pageerror',lambda e:self.errors.append(str(e)))
        # Navigation to HTTP and file:// is restricted in this test environment.
        # Storage API shim exercises persistence across fresh page instances.
        if blocked:
            page.evaluate('''()=>Object.defineProperty(window,'localStorage',{
               configurable:true,get(){throw new DOMException('storage forbidden','SecurityError')}})''')
        else:
            page.evaluate('''entries=>{
                const memory=new Map(Object.entries(entries||{}));
                Object.defineProperty(window,'localStorage',{configurable:true,value:{
                    getItem:key=>memory.has(String(key))?memory.get(String(key)):null,
                    setItem:(key,value)=>memory.set(String(key),String(value)),
                    removeItem:key=>memory.delete(String(key)),
                    _dump:()=>Object.fromEntries(memory)
                }});
            }''',seed)
        page.set_content(self.html,wait_until='load')
        return page

    def reload(self):
        snapshot=self.page.evaluate('window.localStorage._dump()')
        self.page.close()
        self.page=self.make_page(snapshot)

    def setUp(self):
        self.context=self.browser.new_context(viewport={'width':1440,'height':900})
        self.errors=[]
        self.page=self.make_page()
        self.assertTrue(self.page.evaluate('Boolean(window.__test.grid)'))

    def tearDown(self):
        self.assertEqual(self.errors,[],f'Browser errors: {self.errors}')
        self.context.close()

    def draft(self):
        return self.page.evaluate("JSON.parse(localStorage.getItem('aeroplan.draft.v1'))")

    def projects(self):
        return self.page.evaluate("JSON.parse(localStorage.getItem('aeroplan.projects.v1')||'[]')")

    def change(self,selector,value):
        if selector.startswith('#rooms') or selector.startswith('#doors'): self.page.evaluate("window.AeroPlanUI.showPanel('plan')")
        elif selector.startswith('#vents'): self.page.evaluate("window.AeroPlanUI.showPanel('air')")
        elif selector.startswith('#cadr') or selector.startswith('#purifierDiameter'): self.page.evaluate("window.AeroPlanUI.showPanel('purifier')")
        locator=self.page.locator(selector)
        locator.fill(str(value))
        locator.press('Tab')

    def accept_next_dialog(self):
        self.page.once('dialog',lambda dlg:dlg.accept())

    def test_auto_restores_rooms_and_purifier_parameters_after_reload(self):
        self.change('#rooms .room:first-child input[data-key="name"]','Mój salon testowy')
        self.change('#cadr','425')
        self.change('#purifierDiameter','0.52')
        self.page.wait_for_function("JSON.parse(localStorage.getItem('aeroplan.draft.v1')||'null')?.doc?.parameters?.cadr===425")
        self.reload()
        result=self.page.evaluate('''()=>({name:window.__test.rooms[0].name,
          cadr:window.__test.parameters.cadr,diameter:window.__test.parameters.purifierDiameter,
          info:document.getElementById('localSaveInfo').textContent})''')
        self.assertEqual(result['name'],'Mój salon testowy')
        self.assertEqual(result['cadr'],425)
        self.assertEqual(result['diameter'],.52)
        self.assertIn('Przywrócono ostatni',result['info'])

    def test_saved_named_versions_can_be_reloaded_separately(self):
        self.change('#projectName','Mój dom – model A')
        self.page.locator('#saveLocal').click()
        self.assertEqual(len(self.projects()),1)
        self.change('#cadr','480')
        self.change('#projectName','Mój dom – model B')
        self.page.locator('#saveLocal').click()
        self.assertEqual(len(self.projects()),2)
        ids=self.projects()
        a=next(v for v in ids if v['name'].endswith('A'))
        b=next(v for v in ids if v['name'].endswith('B'))
        self.assertEqual(a['doc']['parameters']['cadr'],330)
        self.assertEqual(b['doc']['parameters']['cadr'],480)
        self.page.locator('#savedProjects').select_option(a['id'])
        self.accept_next_dialog()
        self.page.locator('#loadLocal').click()
        self.assertEqual(self.page.locator('#cadr').input_value(),'330')
        self.assertEqual(self.page.locator('#projectName').input_value(),a['name'])
        self.reload()
        self.assertEqual(self.page.locator('#cadr').input_value(),'330')
        self.page.locator('#savedProjects').select_option(b['id'])
        self.accept_next_dialog()
        self.page.locator('#loadLocal').click()
        self.assertEqual(self.page.locator('#cadr').input_value(),'480')

    def test_saved_project_preserves_room_geometry_and_purifier_coordinates(self):
        self.accept_next_dialog()
        self.page.locator('#newplan').click()
        self.page.locator('#addRoom').click()
        self.change('#rooms .room:first-child input[data-key="w"]','3.3')
        self.page.locator('[data-tool="purifier"]').click()
        self.page.locator('#field').scroll_into_view_if_needed()
        coords=self.page.evaluate('''()=>{const c=document.getElementById('field'),b=c.getBoundingClientRect(),t=window.__test.viewTransform;
          const x=1.3,y=1.2;
          return {x:b.x+(t.offX+x*t.scale)*b.width/c.width,
            y:b.y+(t.offY+y*t.scale)*b.height/c.height};}''')
        self.page.mouse.click(coords['x'],coords['y'])
        self.change('#projectName','Geometry and purifier')
        self.page.locator('#saveLocal').click()
        expected=self.projects()[0]['doc']
        self.assertEqual(expected['rooms'][0]['w'],3.3)
        self.assertGreater(abs(expected['purifier']['x']-2.5),.2)
        self.reload()
        self.assertAlmostEqual(self.page.evaluate('window.__test.rooms[0].w'),3.3)
        self.assertAlmostEqual(self.draft()['doc']['purifier']['x'],expected['purifier']['x'])

    def test_overwrite_requires_confirmation_and_delete_keeps_live_plan(self):
        self.change('#projectName','Zapis 1')
        self.page.locator('#saveLocal').click()
        original=self.projects()[0]['doc']['parameters']['cadr']
        self.change('#cadr','590')
        self.page.locator('#saveLocal').click() # auto dismissed
        self.assertEqual(self.projects()[0]['doc']['parameters']['cadr'],original)
        self.accept_next_dialog()
        self.page.locator('#saveLocal').click()
        self.assertEqual(self.projects()[0]['doc']['parameters']['cadr'],590)
        self.accept_next_dialog()
        self.page.evaluate("window.AeroPlanUI.showPanel('projects')")
        self.page.locator('#deleteLocal').click()
        self.assertEqual(len(self.projects()),0)
        self.assertEqual(self.page.locator('#cadr').input_value(),'590')

    def test_invalid_saved_project_does_not_damage_session(self):
        self.page.evaluate('''()=>localStorage.setItem('aeroplan.projects.v1',JSON.stringify([
          {id:'broken',name:'Popsuty',updatedAt:1,doc:{rooms:[{id:'r',name:'Zły',x:0,y:0,w:-1,h:2}],doors:[]}}]))''')
        self.reload()
        original=self.page.evaluate('window.__test.rooms.map(r=>r.name)')
        self.page.locator('#savedProjects').select_option('broken')
        self.accept_next_dialog()
        self.page.locator('#loadLocal').click()
        self.assertEqual(self.page.evaluate('window.__test.rooms.map(r=>r.name)'),original)
        self.assertIn('Nie udało się wczytać',self.page.locator('#localSaveInfo').inner_text())

    def test_names_are_plain_text_in_saved_project_selector(self):
        self.change('#projectName','<img src=x onerror=alert(1)>')
        self.page.locator('#saveLocal').click()
        self.assertEqual(self.page.locator('#savedProjects img').count(),0)
        self.assertIn('<img',self.page.locator('#savedProjects option').last.inner_text())

    def test_door_and_ventilation_configuration_survive_reload(self):
        self.page.locator('#doors [data-role="open"]').first.uncheck()
        self.change('#vents [data-v="rate"]','45')
        self.page.wait_for_function("JSON.parse(localStorage.getItem('aeroplan.draft.v1')||'null')?.doc?.vents?.[0]?.rate===45")
        self.reload()
        self.assertFalse(self.page.locator('#doors [data-role="open"]').first.is_checked())
        self.assertEqual(self.page.locator('#vents [data-v="rate"]').first.input_value(),'45')

    def test_auto_saves_empty_plan_instead_of_restoring_sample(self):
        self.accept_next_dialog()
        self.page.locator('#newplan').click()
        self.page.wait_for_function("JSON.parse(localStorage.getItem('aeroplan.draft.v1')||'null')?.doc?.rooms?.length===0")
        self.reload()
        self.assertEqual(self.page.evaluate('window.__test.rooms.length'),0)
        self.assertEqual(self.page.locator('#rooms .room').count(),0)

    def test_quota_error_does_not_crash_app_and_json_still_available(self):
        self.page.evaluate('''()=>{
          const old=window.localStorage.setItem;
          window.localStorage.setItem=(key,value)=>{
            if(key==='aeroplan.projects.v1')throw new DOMException('Storage full','QuotaExceededError');
            return old(key,value);
          };
        }''')
        self.change('#projectName','Brak miejsca')
        self.page.locator('#saveLocal').click()
        self.assertIn('Storage full',self.page.locator('#localSaveInfo').inner_text())
        self.assertEqual(len(self.projects()),0)
        self.assertFalse(self.page.locator('#saveJson').is_disabled())

    def test_blocked_local_storage_falls_back_to_json(self):
        page=self.make_page(blocked=True)
        self.assertTrue(page.locator('#saveLocal').is_disabled())
        self.assertFalse(page.locator('#saveJson').is_disabled())
        self.assertIn('Pamięć przeglądarki jest niedostępna',page.locator('#localSaveInfo').inner_text())
        page.close()

if __name__=='__main__':unittest.main()
