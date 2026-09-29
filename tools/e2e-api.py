"""End-to-end check of Axlework against the real API.
usage: python tools/e2e-api.py BASE_URL SHOT_PREFIX
Logs in with "Enter demo", walks overview -> vehicles (server-side search) -> create -> edit -> detail -> settings,
fails on any console error / failed /api request, and writes screenshots SHOT_PREFIX-*.png."""
import sys, random, re
from playwright.sync_api import sync_playwright, expect

base = sys.argv[1].rstrip('/')
prefix = sys.argv[2]
errors, api_fail = [], []
uid = f"QA-{random.randint(1000, 9999)}"
vin = ''.join(random.choice('ABCDEFGHJKLMNPRSTUVWXYZ0123456789') for _ in range(17))
imei = '35' + ''.join(random.choice('0123456789') for _ in range(13))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 1440, 'height': 900})
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('response', lambda r: '/api/' in r.url and r.status >= 400 and api_fail.append(f'{r.status} {r.url}'))

    pg.goto(base + '/login')
    pg.get_by_role('button', name=re.compile('Enter demo')).click()
    pg.wait_for_url(base + '/')
    expect(pg.locator('section[aria-label="Key metrics"]')).to_be_visible(timeout=15000)
    pg.wait_for_timeout(800)
    pg.screenshot(path=f'{prefix}-overview.png')
    pg.get_by_role('button', name='7 days').click()
    pg.wait_for_timeout(600)

    pg.goto(base + '/vehicles?q=tacoma&sort=fuelLevel&dir=desc')
    expect(pg.locator('tbody tr').first).to_be_visible(timeout=10000)
    pg.wait_for_timeout(600)
    print('vehicles header:', pg.locator('h1 + p').inner_text())
    pg.screenshot(path=f'{prefix}-vehicles.png')

    # create
    pg.goto(base + '/vehicles/new')
    pg.fill('#id', uid); pg.fill('#plate', 'WA QA1234'); pg.fill('#vin', vin)
    pg.fill('#make', 'Kenworth'); pg.fill('#model', 'T680'); pg.fill('#year', '2024')
    pg.select_option('#type', 'Tractor'); pg.select_option('#depot', 'Tacoma')
    pg.fill('#imei', imei); pg.fill('#tankGal', '250')
    pg.get_by_role('button', name='Add vehicle').last.click()
    pg.wait_for_url(f'{base}/vehicles/{uid}', timeout=10000)
    expect(pg.locator('h1')).to_have_text(uid)
    print('created', uid)

    # edit
    pg.goto(f'{base}/vehicles/{uid}/edit')
    pg.fill('#notes', 'Liftgate. Created by automated E2E check.')
    pg.fill('#plate', 'WA QA5678')
    pg.get_by_role('button', name='Save changes').click()
    pg.wait_for_url(f'{base}/vehicles/{uid}', timeout=10000)
    pg.reload()
    expect(pg.get_by_text('WA QA5678')).to_be_visible(timeout=10000)
    print('edit persisted after reload')

    # server-side search finds it
    pg.goto(f'{base}/vehicles?q={uid}')
    expect(pg.locator('tbody tr')).to_have_count(1, timeout=10000)

    # seeded detail page with fuel drop
    pg.goto(base + '/vehicles/HP-1008')
    expect(pg.get_by_text('Drop of', exact=False)).to_be_visible(timeout=10000)
    pg.wait_for_timeout(800)
    pg.screenshot(path=f'{prefix}-detail.png')

    pg.goto(base + '/settings')
    expect(pg.get_by_role('heading', name='Settings')).to_be_visible()
    pg.screenshot(path=f'{prefix}-settings.png')

    # clean up the QA vehicle through the UI bulk remove
    pg.goto(f'{base}/vehicles?q={uid}')
    expect(pg.locator('tbody tr')).to_have_count(1, timeout=10000)
    pg.get_by_label(f'Select {uid}').check()
    pg.get_by_role('button', name='Remove').click()
    pg.get_by_role('button', name='Confirm remove').click()
    expect(pg.get_by_text('No vehicles match')).to_be_visible(timeout=10000)
    print('removed', uid)

    m = b.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True)
    m.on('console', lambda x: x.type == 'error' and errors.append(x.text))
    m.goto(base + '/login')
    m.get_by_role('button', name=re.compile('Enter demo')).click()
    m.wait_for_url(base + '/')
    m.goto(base + '/vehicles')
    expect(m.locator('tbody tr').first).to_be_visible(timeout=10000)
    m.screenshot(path=f'{prefix}-mobile.png')
    b.close()

print('console errors:', errors)
print('failed api calls:', api_fail)
sys.exit(1 if errors or api_fail else 0)
