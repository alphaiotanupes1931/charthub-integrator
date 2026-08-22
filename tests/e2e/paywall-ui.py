"""Visual + DOM regression harness for the paywall and locked-state UI.

Runs the real app in a browser as a specific persona and, for each gated route,
checks the locked state the user actually sees:

  * DOM: the lock overlay / preview container is present, tagged with the
    capability it gates, carries the expected messaging, and exposes exactly one
    primary call to action that leads to /pricing.
  * Absence: paid values are not in the DOM for a denied persona.
  * Visual: a screenshot of the lock region is diffed against a stored baseline
    under tests/e2e/screenshots/paywall/<persona>/, so overlay layout, copy and
    button changes have to be reviewed deliberately.

Usage:
    python3 tests/e2e/paywall-ui.py free /tmp/browser/analytics/free.json
    python3 tests/e2e/paywall-ui.py paid /tmp/browser/analytics/paid.json --update

`--update` rewrites the baselines instead of failing on a diff.
Exit code is non-zero on the first DOM or visual regression.
"""

import asyncio
import json
import os
import sys
from pathlib import Path

from PIL import Image, ImageChops
from playwright.async_api import async_playwright

URL = "http://localhost:8080"
ROOT = Path(__file__).resolve().parent
BASELINES = ROOT / "screenshots" / "paywall"
OUT = Path("/tmp/browser/paywall")

# Tolerance: anti-aliasing and font hinting move a few pixels; a copy or layout
# change moves far more than 0.5% of them.
MAX_DIFF_RATIO = 0.005

# route -> what the locked state must look like. `locked_for` lists the personas
# expected to be denied; everyone else must see the real page.
ROUTES = [
    {
        "path": "/signals",
        "kind": "page-lock",
        "capability": "signal_engine",
        "must_contain": ["signal engine", "See plans"],
        "locked_for": ["free"],
    },
    {
        "path": "/autopilot",
        "kind": "page-lock",
        "capability": "autopilot",
        "must_contain": ["Autopilot", "See plans"],
        "locked_for": ["free", "paid"],  # Elite only; the paid QA account is Pro
    },
    {
        "path": "/analytics",
        "kind": "preview",
        "capability": "analytics",
        "must_contain": ["part of the paid plan", "See plans", "Go to Journal"],
        "locked_for": ["free"],
    },
    {
        "path": "/coaches",
        "kind": "item-lock",
        "testid": "unlock-coach",
        "must_contain": ["Unlock coach"],
        "locked_for": ["free"],
    },
    {
        "path": "/academy",
        "kind": "item-lock",
        "testid": "unlock-module",
        "must_contain": ["Unlock module"],
        "locked_for": ["free"],
    },
]

# Values that must never reach a denied account's DOM.
PAID_VALUE_PATTERNS = ["Profit Factor:", "Expectancy:"]

failures: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)
    print(f"FAIL {msg}")


def ok(msg: str) -> None:
    print(f"ok   {msg}")


def compare(shot: Path, baseline: Path, update: bool, label: str) -> None:
    if update or not baseline.exists():
        baseline.parent.mkdir(parents=True, exist_ok=True)
        Image.open(shot).save(baseline)
        notes.append(f"baseline written: {baseline.relative_to(ROOT)}")
        print(f"base {label} -> {baseline.name}")
        return
    a, b = Image.open(baseline).convert("RGB"), Image.open(shot).convert("RGB")
    if a.size != b.size:
        fail(f"{label}: overlay size changed {a.size} -> {b.size}")
        return
    diff = ImageChops.difference(a, b)
    changed = sum(1 for px in diff.getdata() if px != (0, 0, 0))
    ratio = changed / (a.size[0] * a.size[1])
    if ratio > MAX_DIFF_RATIO:
        fail(f"{label}: visual diff {ratio:.3%} exceeds {MAX_DIFF_RATIO:.1%}")
    else:
        ok(f"{label}: visual match ({ratio:.3%})")


async def run(persona: str, session_path: str, update: bool) -> None:
    session = json.load(open(session_path))
    key = session.get("storage_key")
    payload = json.dumps(session.get("session") or session)
    OUT.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        await page.goto(URL, wait_until="domcontentloaded")
        await page.evaluate(f"localStorage.setItem({json.dumps(key)}, {json.dumps(payload)})")
        # Dismiss the one-time compliance notice and onboarding tour up front:
        # both are full-screen overlays that would swallow the CTA clicks.
        await page.evaluate(
            "() => { localStorage.setItem('trademind.compliance.ack.v1', new Date().toISOString());"
            " localStorage.setItem('trademind.tour.v1', 'done');"
            " localStorage.setItem('trademind.tour.completed', '1'); }"
        )

        for route in ROUTES:
            label = f"{persona} {route['path']}"
            await page.goto(URL + route["path"], wait_until="domcontentloaded")
            await page.wait_for_timeout(5000)
            body = await page.inner_text("body")
            locked = persona in route["locked_for"]

            if route["kind"] == "page-lock":
                gate = page.locator('[data-testid="capability-lock"]')
                count = await gate.count()
                if locked:
                    if count != 1:
                        fail(f"{label}: expected 1 lock overlay, found {count}")
                        continue
                    cap = await gate.get_attribute("data-capability")
                    if cap != route["capability"]:
                        fail(f"{label}: overlay gates '{cap}', expected '{route['capability']}'")
                    ctas = await page.locator('[data-testid="lock-cta"]').count()
                    if ctas != 1:
                        fail(f"{label}: expected 1 primary CTA, found {ctas}")
                    for txt in route["must_contain"]:
                        if txt.lower() not in body.lower():
                            fail(f"{label}: missing copy '{txt}'")
                    for leak in PAID_VALUE_PATTERNS:
                        if leak in body:
                            fail(f"{label}: paid value '{leak}' leaked behind the lock")
                    # CTA opens the upgrade modal in place, no navigation.
                    before = page.url
                    await page.locator('[data-testid="lock-cta"]').click()
                    await page.wait_for_timeout(700)
                    modal = page.locator('[data-testid="upgrade-modal"]')
                    if await modal.count() != 1:
                        fail(f"{label}: CTA did not open the upgrade modal")
                    elif page.url != before:
                        fail(f"{label}: CTA navigated away ({before} -> {page.url})")
                    else:
                        href = await modal.locator('[data-testid="upgrade-primary-cta"]').get_attribute("href")
                        if href != "/pricing":
                            fail(f"{label}: modal CTA points at {href}, expected /pricing")
                        else:
                            ok(f"{label}: lock overlay + modal CTA -> /pricing")
                        shot = OUT / f"{persona}{route['path'].replace('/', '_')}_modal.png"
                        await modal.screenshot(path=str(shot))
                        compare(shot, BASELINES / persona / f"{route['path'].strip('/')}_modal.png", update, f"{label} modal")
                        await modal.get_by_label("Close").click()
                        await page.wait_for_timeout(300)
                    shot = OUT / f"{persona}{route['path'].replace('/', '_')}.png"
                    await gate.screenshot(path=str(shot))
                    compare(shot, BASELINES / persona / f"{route['path'].strip('/')}.png", update, f"{label} overlay")
                else:
                    if count != 0:
                        fail(f"{label}: entitled account was shown a lock overlay")
                    else:
                        ok(f"{label}: full page, no overlay")

            elif route["kind"] == "preview":
                preview = page.locator('[data-testid="analytics-preview"]')
                if locked:
                    if await preview.count() != 1:
                        fail(f"{label}: expected the blurred preview container")
                        continue
                    blur = page.locator('[data-testid="analytics-preview-blur"]')
                    if await blur.count() != 1:
                        fail(f"{label}: blurred KPI region missing")
                    else:
                        css = await blur.evaluate("el => getComputedStyle(el).filter")
                        if "blur" not in css:
                            fail(f"{label}: KPI region is not blurred (filter: {css})")
                        aria = await blur.get_attribute("aria-hidden")
                        if aria != "true":
                            fail(f"{label}: blurred region is not aria-hidden")
                    cta = page.locator('[data-testid="analytics-preview-cta"]')
                    if await cta.get_attribute("href") != "/pricing":
                        fail(f"{label}: preview CTA does not point at /pricing")
                    for txt in route["must_contain"]:
                        if txt.lower() not in body.lower():
                            fail(f"{label}: missing copy '{txt}'")
                    masked = await blur.inner_text()
                    if "--" not in masked:
                        fail(f"{label}: KPI values are not masked with '--'")
                    else:
                        ok(f"{label}: masked + blurred preview with /pricing CTA")
                    shot = OUT / f"{persona}_analytics.png"
                    await preview.screenshot(path=str(shot))
                    compare(shot, BASELINES / persona / "analytics.png", update, f"{label} preview")
                else:
                    if await preview.count() != 0:
                        fail(f"{label}: paid account was shown the preview state")
                    elif "--" in body and "Win Rate" not in body:
                        fail(f"{label}: paid account sees masked values")
                    else:
                        ok(f"{label}: full metrics")

            else:  # item-lock
                items = page.locator(f'[data-testid="{route["testid"]}"]')
                count = await items.count()
                if locked:
                    if count == 0:
                        fail(f"{label}: expected per-item '{route['must_contain'][0]}' buttons")
                        continue
                    ok(f"{label}: {count} locked items")
                    shot = OUT / f"{persona}{route['path'].replace('/', '_')}_item.png"
                    await items.first.screenshot(path=str(shot))
                    compare(shot, BASELINES / persona / f"{route['path'].strip('/')}_item.png", update, f"{label} item lock")
                    # Pressing a locked item opens the modal for that surface.
                    await items.first.click()
                    await page.wait_for_timeout(700)
                    modal = page.locator('[data-testid="upgrade-modal"]')
                    if await modal.count() != 1:
                        fail(f"{label}: locked item did not open the upgrade modal")
                    else:
                        ok(f"{label}: locked item opens upgrade modal")
                else:
                    if count != 0:
                        fail(f"{label}: entitled account sees {count} locked items")
                    else:
                        ok(f"{label}: nothing locked")

        await browser.close()

    print("\n" + json.dumps({"persona": persona, "failures": failures, "notes": notes}, indent=2))
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--update"]
    asyncio.run(run(args[0], args[1], "--update" in sys.argv or os.environ.get("UPDATE_BASELINES") == "1"))
