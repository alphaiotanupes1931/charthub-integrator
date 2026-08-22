import asyncio, json, sys
from playwright.async_api import async_playwright
URL="http://localhost:8080"
TRADES=[
 {"id":"t1","date":"2026-08-10","timeframe":"1H","symbol":"XAU/USD","side":"Long","entry":2400,"exit":2420,"stop":2390,"size":1,"notes":"","createdAt":1},
 {"id":"t2","date":"2026-08-12","timeframe":"1H","symbol":"NAS100","side":"Short","entry":19000,"exit":19050,"stop":19080,"size":1,"notes":"","createdAt":2},
 {"id":"t3","date":"2026-08-14","timeframe":"4H","symbol":"XAU/USD","side":"Long","entry":2410,"exit":2450,"stop":2400,"size":1,"notes":"","createdAt":3},
]
async def run(label, path):
    s=json.load(open(path)); key=s.get("storage_key"); payload=json.dumps(s.get("session") or s)
    async with async_playwright() as p:
        b=await p.chromium.launch(headless=True); ctx=await b.new_context(viewport={"width":1280,"height":1800}); page=await ctx.new_page()
        await page.goto(URL, wait_until="domcontentloaded")
        await page.evaluate(f"localStorage.setItem({json.dumps(key)}, {json.dumps(payload)})")
        await page.evaluate("t => localStorage.setItem('trademind.journal.trades.v1', JSON.stringify(t))", TRADES)
        await page.goto(URL+"/analytics", wait_until="domcontentloaded")
        await page.wait_for_timeout(6000)
        body=await page.inner_text("body")
        blur=await page.evaluate("document.querySelectorAll('[class*=blur-]').length")
        # real KPI values (unblurred cards)
        vals=await page.evaluate("""() => Array.from(document.querySelectorAll('div')).filter(d=>/^(Win Rate|Profit Factor|Expectancy)$/.test(d.textContent.trim())).map(d=>d.parentElement.textContent.trim()).slice(0,6)""")
        out={"label":label,"paywall":"part of the paid plan" in body,"unlock_badge":"Unlocks with any paid plan" in body,
             "blurred_nodes":blur,"kpi_labels_present":all(k in body for k in ["Win Rate","Profit Factor","Expectancy","Max Drawdown"]),
             "kpi_samples":vals,"trade_count_msg":"3 trades" in body}
        await page.screenshot(path=f"/tmp/browser/analytics/{label}2.png")
        print(json.dumps(out,indent=2)); await b.close()
asyncio.run(run(sys.argv[1],sys.argv[2]))
