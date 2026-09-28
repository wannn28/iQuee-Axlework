import sys
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4174'
OUT = '/workspace/demo-dashboard/'

def settle(pg):
    pg.evaluate('document.fonts.ready.then(()=>1)'); pg.wait_for_timeout(600)

with sync_playwright() as p:
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = br.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
    pg.goto(BASE + '/login'); settle(pg); pg.screenshot(path=OUT + 'shot-login.png')
    pg.click('text=Enter demo'); pg.wait_for_url(BASE + '/'); settle(pg)
    pg.screenshot(path=OUT + 'shot-overview.png', full_page=True)
    pg.click('[aria-label="Toggle dark mode"]'); settle(pg)
    pg.screenshot(path=OUT + 'shot-overview-dark.png', full_page=True)
    pg.click('[aria-label="Toggle dark mode"]')
    pg.goto(BASE + '/vehicles'); settle(pg)
    boxes = pg.locator('tbody input[type=checkbox]')
    for i in (1, 2, 4): boxes.nth(i).check()
    pg.wait_for_timeout(200); pg.screenshot(path=OUT + 'shot-table.png', full_page=True)
    # detail: prefer a moving vehicle with a fuel drop
    vid = sys.argv[2] if len(sys.argv) > 2 else None
    if not vid:
        pg.goto(BASE + '/vehicles?status=moving'); settle(pg)
        ids = pg.eval_on_selector_all('tbody tr td:nth-child(2) a', 'els=>els.map(e=>e.textContent)')
        vid = ids[0]
        for i in ids:
            pg.goto(BASE + '/vehicles/' + i); pg.wait_for_timeout(250)
            if pg.locator('text=/Drop of/').count(): vid = i; break
    pg.goto(BASE + '/vehicles/' + vid); settle(pg); print('detail', vid)
    pg.screenshot(path=OUT + 'shot-detail.png', full_page=True)
    pg.set_viewport_size({'width': 1440, 'height': 1480})
    pg.goto(BASE + '/vehicles/new'); settle(pg)
    pg.fill('#id', 'HP-1043'); pg.fill('#plate', 'WA C77120'); pg.fill('#vin', '1XKYD49X0NJ12345'); pg.fill('#make', 'Kenworth'); pg.fill('#model', 'T680')
    pg.fill('#year', '2024'); pg.fill('#imei', '86123456789')
    pg.click('button:has-text("Add vehicle")'); pg.wait_for_timeout(700)
    pg.evaluate('window.scrollTo(0,0)'); pg.wait_for_timeout(300)
    pg.screenshot(path=OUT + 'shot-form.png')
    pg.set_viewport_size({'width': 1440, 'height': 900})
    pg.goto(BASE + '/settings'); settle(pg); pg.screenshot(path=OUT + 'shot-settings.png', full_page=True)
    m = br.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    m.add_init_script("localStorage.setItem('axw.authed','true')")
    mp = m.new_page(); mp.on('pageerror', lambda e: errs.append(str(e)))
    mp.goto(BASE + '/'); settle(mp); mp.screenshot(path=OUT + 'shot-mobile.png', full_page=True)
    print('mobile scrollWidth', mp.evaluate('document.documentElement.scrollWidth'))
    mp.click('[aria-label="Open menu"]'); mp.wait_for_timeout(300); mp.screenshot(path=OUT + 'shot-mobile-menu.png')
    print('errors', errs)
    br.close()
