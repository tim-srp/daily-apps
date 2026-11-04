import asyncio, sys
from playwright.async_api import async_playwright
U = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8792/d02/"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
        await pg.goto(U); await pg.screenshot(path="shots/00-gate.png")
        await pg.fill("#k", "ADPTEST1"); await pg.click("#b"); await pg.wait_for_selector("#cr-form")
        await pg.wait_for_timeout(800)
        await pg.click("#cr-fill"); await pg.click("#cr-ch .chip[data-c='千川']")
        await pg.click("#cr-go"); await pg.wait_for_timeout(3500); await pg.screenshot(path="shots/01-creative-streaming.png")
        await pg.wait_for_selector("#cr-out .angles", timeout=240000); await pg.wait_for_timeout(500)
        await pg.screenshot(path="shots/02-creative-result.png", full_page=True)
        await pg.click("#cr-save"); await pg.click("#cr-ab"); await pg.wait_for_timeout(300)
        await pg.click("#mx-go"); await pg.wait_for_selector("#mx-out table", timeout=240000); await pg.wait_for_timeout(400)
        await pg.screenshot(path="shots/03-ab-matrix.png", full_page=True)
        await pg.click("#mx-save")
        await pg.click("[data-tab=report]"); await pg.click("[data-sample='sample-qianchuan.csv']")
        await pg.wait_for_selector("#rp-dash .kpis"); await pg.wait_for_selector("#rp-out .sugg", timeout=240000); await pg.wait_for_timeout(500)
        await pg.screenshot(path="shots/04-report-dashboard.png", full_page=True)
        await pg.click("#rp-save")
        await pg.evaluate("document.documentElement.dataset.theme='light'"); await pg.click("[data-tab=projects]"); await pg.wait_for_timeout(300)
        await pg.screenshot(path="shots/05-projects-light.png")
        # 手机宽度
        await pg.set_viewport_size({"width": 390, "height": 844}); await pg.click("[data-tab=report]"); await pg.wait_for_timeout(300)
        await pg.screenshot(path="shots/06-mobile-report.png")
        print("mode:", await pg.inner_text("#modeBadge")); print("errors:", errs)
        await b.close()
asyncio.run(main())
