"""Experimental UI shell: navigation, visible project actions, responsive layout.

These tests intentionally exercise real hidden panels, unlike a purely DOM-level smoke check.
"""
import os
import unittest
from playwright.sync_api import sync_playwright
from test_regressions import fixture


class UILabTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright=sync_playwright().start()
        options={'headless':True,'args':['--no-sandbox']}
        if os.environ.get('AEROPLAN_CHROMIUM'):options['executable_path']=os.environ['AEROPLAN_CHROMIUM']
        cls.browser=cls.playwright.chromium.launch(**options)
        cls.fixture=fixture()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.page=self.browser.new_page(viewport={'width':1440,'height':900})
        self.errors=[]
        self.page.on('pageerror',lambda error:self.errors.append(str(error)))
        self.page.set_content(self.fixture)

    def tearDown(self):
        self.assertEqual(self.errors,[])
        self.page.close()

    def test_project_save_and_load_are_immediately_visible(self):
        for selector in ['#projectName','#savedProjects','#saveLocal','#loadLocal']:
            with self.subTest(selector=selector):
                element=self.page.locator(selector)
                self.assertTrue(element.is_visible())
                rect=element.bounding_box()
                self.assertLess(rect['y'],self.page.viewport_size['height'])
        self.assertFalse(self.page.locator('#pane-projects').is_visible())
        self.assertTrue(self.page.locator('#field').is_visible())

    def test_tabs_are_accessible_and_change_visibility(self):
        self.assertEqual(self.page.locator('[data-config-tab="plan"]').get_attribute('aria-selected'),'true')
        self.assertTrue(self.page.locator('#rooms').is_visible())
        self.assertFalse(self.page.locator('#vents').is_visible())
        for name,shown,hidden in [('air','#vents','#rooms'),('purifier','#cadr','#vents'),('projects','#saveJson','#cadr'),('plan','#rooms','#saveJson')]:
            self.page.locator(f'[data-config-tab="{name}"]').click()
            self.assertTrue(self.page.locator(shown).is_visible())
            self.assertFalse(self.page.locator(hidden).is_visible())
            self.assertEqual(self.page.locator(f'[data-config-tab="{name}"]').get_attribute('aria-selected'),'true')

    def test_tab_keyboard_navigation(self):
        self.page.locator('[data-config-tab="plan"]').focus()
        self.page.keyboard.press('ArrowRight')
        self.assertEqual(self.page.locator('[data-config-tab="air"]').get_attribute('aria-selected'),'true')
        self.page.keyboard.press('End')
        self.assertEqual(self.page.locator('[data-config-tab="projects"]').get_attribute('aria-selected'),'true')
        self.page.keyboard.press('Home')
        self.assertEqual(self.page.locator('[data-config-tab="plan"]').get_attribute('aria-selected'),'true')

    def test_navigation_does_not_reset_live_simulation(self):
        before=self.page.evaluate('''()=>{
            const m=window.__test;m.advance(10);
            return {elapsed:m.elapsed,concentrations:Array.from(m.concentration)};
        }''')
        for name in ['air','purifier','projects','plan']:
            self.page.locator(f'[data-config-tab="{name}"]').click()
        after=self.page.evaluate('''()=>({elapsed:window.__test.elapsed,concentrations:Array.from(window.__test.concentration)})''')
        self.assertEqual(before,after)

    def test_map_buttons_open_relevant_panels(self):
        self.page.locator('[data-tool="purifier"]').click()
        self.assertTrue(self.page.locator('#pane-purifier').is_visible())
        self.page.locator('.editbar-more summary').click()
        self.page.locator('[data-tool="exhaust"]').click()
        self.assertTrue(self.page.locator('#pane-air').is_visible())
        self.page.locator('[data-tool="room"]').click()
        self.assertTrue(self.page.locator('#pane-plan').is_visible())

    def test_shortcut_to_purifier(self):
        self.page.locator('[data-switch-panel="purifier"]').click()
        self.assertTrue(self.page.locator('#cadr').is_visible())
        self.page.locator('[data-switch-panel="plan"]').click()
        self.assertTrue(self.page.locator('#rooms').is_visible())

    def test_mobile_has_no_horizontal_overflow_and_reachable_project_bar(self):
        self.page.set_viewport_size({'width':390,'height':844})
        r=self.page.evaluate('''()=>({scrollWidth:document.documentElement.scrollWidth,width:window.innerWidth,
             save:document.getElementById('saveLocal').getBoundingClientRect().toJSON(),
             field:document.getElementById('field').getBoundingClientRect().toJSON(),
             sidebar:document.querySelector('.sidebar').getBoundingClientRect().toJSON(),
             panel:document.getElementById('pane-plan').getBoundingClientRect().toJSON()})''')
        self.assertLessEqual(r['scrollWidth'],r['width']+1)
        self.assertLess(r['save']['bottom'],844)
        self.assertGreater(r['field']['width'],250)
        self.assertLessEqual(r['panel']['height'],300)

    def test_mobile_jump_to_map_button(self):
        self.page.set_viewport_size({'width':390,'height':844})
        self.assertTrue(self.page.locator('#jumpToMap').is_visible())
        self.page.locator('#jumpToMap').click()
        self.page.wait_for_timeout(500)
        rect=self.page.locator('#field').bounding_box()
        self.assertGreater(rect['y'],0)
        self.assertLess(rect['y'],844)

    def test_adv_metrics_and_technical_notice_stay_optional(self):
        self.assertFalse(self.page.locator('#pressureMetric').is_visible())
        self.page.locator('.extra-metrics summary').click()
        self.assertTrue(self.page.locator('#pressureMetric').is_visible())
        self.assertFalse(self.page.locator('.physics-disclosure .warning').is_visible())
        self.page.locator('.physics-disclosure summary').click()
        self.assertTrue(self.page.locator('.physics-disclosure .warning').is_visible())

    def test_all_original_dom_controls_remain_unique(self):
        result=self.page.evaluate('''()=>{const ids=Array.from(document.querySelectorAll('[id]')).map(x=>x.id);
            return {ids:ids.length,unique:new Set(ids).size,required:['field','saveJson','loadJson','deleteLocal','savedProjects','rooms','windows','doors','vents','compare','cadr','windSpeed'].every(x=>document.getElementById(x))};}''')
        self.assertEqual(result['ids'],result['unique'])
        self.assertTrue(result['required'])

if __name__=='__main__':unittest.main()
