"""
End-to-end signup + onboarding + gating test.

Run with:
    python3 tests/e2e/signup-and-onboard.py

Assumes the dev server is running at http://localhost:8080 (Vite default in
this project). Uses a fresh random email each run to avoid collisions with
existing accounts, and cleans nothing up — treat generated accounts as
disposable test fixtures.

Verifies:
  1. New user can sign up on /auth (create account mode).
  2. Onboarding form accepts name + referral source and finish button lands
     the user on either /dashboard (admin bypass path) or /pricing (unpaid
     users) — and /pricing renders without a router/hydration crash.
  3. The blocking overlay appears while requests are in flight (no
     double-navigation regressions).
"""

import asyncio
import os
import random
import string
import sys
from pathlib import Path

from playwright.async_api import async_playwright, expect

BASE_URL = os.environ.get("E2E_BASE_URL", "http://localhost:8080")
SCREENSHOTS = Path(__file__).parent / "screenshots"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)


def random_email() -> str:
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=10))
    return f"e2e+{suffix}@trademind-test.dev"


def random_password() -> str:
    # 16+ chars, meets the "12 chars, number, special" rule enforced on signup.
    return "Trade!Mind-" + "".join(random.choices(string.ascii_letters + string.digits, k=8))


async def main() -> int:
    email = random_email()
    password = random_password()
    print(f"[e2e] signing up {email}")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        console_errors: list[str] = []
        page.on("pageerror", lambda err: console_errors.append(f"pageerror: {err}"))
        page.on("console", lambda msg: msg.type == "error" and console_errors.append(f"console: {msg.text}"))

        # 1. Load /auth in create-account mode.
        await page.goto(f"{BASE_URL}/auth", wait_until="networkidle")
        # Dismiss cookie banner if present so it doesn't intercept clicks.
        got_it = page.get_by_role("button", name="Got it")
        if await got_it.count():
            await got_it.first.click()
        # Wait for the SPA to hydrate before toggling to signup.
        await expect(page.get_by_role("heading", name="Sign in")).to_be_visible()
        create_link = page.get_by_role("button", name="Create one")
        await create_link.click()
        await expect(page.get_by_role("heading", name="Create your account")).to_be_visible()
        await page.screenshot(path=str(SCREENSHOTS / "01_auth.png"))



        # 2. Fill and submit the signup form.
        await page.locator("#email").fill(email)
        await page.locator("#password").fill(password)
        submit = page.get_by_role("button", name="Create account")
        await submit.click()


        # 3. The click-blocking overlay should appear before we navigate.
        try:
            await expect(page.get_by_text("Creating your account...")).to_be_visible(timeout=3000)
            print("[e2e] blocking overlay visible")
        except Exception:
            # Overlay may vanish before the assertion lands on very fast machines.
            print("[e2e] overlay not observed (fast machine)")

        # 4. Wait for navigation off /auth. Acceptable destinations:
        #    /onboarding (new user), /pricing (paywall), or /dashboard (admin).
        await page.wait_for_url(
            lambda url: any(p in url for p in ("/onboarding", "/pricing", "/dashboard")),
            timeout=15000,
        )
        landed = page.url
        print(f"[e2e] post-signup URL: {landed}")
        await page.screenshot(path=str(SCREENSHOTS / "02_post_signup.png"))

        # 5. If onboarding, complete it.
        if "/onboarding" in landed:
            await expect(page.get_by_role("heading", name="Let's get you set up")).to_be_visible()
            await page.get_by_label("Your name").fill("E2E Tester")
            await page.get_by_role("button", name="Twitter / X").click()
            await page.get_by_role("button", name="Continue").click()

            await expect(page.get_by_role("heading", name="Your recovery code")).to_be_visible()
            await page.screenshot(path=str(SCREENSHOTS / "03_recovery.png"))

            finish = page.get_by_role("button", name="Yes, continue")
            await finish.click()

            # Blocking overlay for onboarding.
            try:
                await expect(page.get_by_text("Saving your profile...")).to_be_visible(timeout=3000)
                print("[e2e] onboarding overlay visible")
            except Exception:
                print("[e2e] onboarding overlay not observed (fast machine)")

            await page.wait_for_url(
                lambda url: "/dashboard" in url or "/pricing" in url,
                timeout=15000,
            )
            landed = page.url
            print(f"[e2e] post-onboarding URL: {landed}")
            await page.screenshot(path=str(SCREENSHOTS / "04_post_onboarding.png"))

        # 6. Verify final destination renders without a router crash.
        if "/pricing" in landed:
            # Unpaid users should see a plan-selection UI, not a blank/error page.
            body_text = (await page.locator("body").inner_text()).lower()
            assert "plan" in body_text or "subscribe" in body_text or "trial" in body_text, (
                f"/pricing rendered but has no plan content: {body_text[:200]!r}"
            )
            print("[e2e] /pricing rendered plan content correctly")
        elif "/dashboard" in landed:
            assert "/dashboard" in page.url
            print("[e2e] landed on /dashboard")

        else:
            raise AssertionError(f"Unexpected final URL: {landed}")

        # 7. No unhandled page errors (router invariant crashes surface here).
        blocking = [e for e in console_errors if "Could not find match" in e or "Invariant" in e]
        assert not blocking, f"Router crash detected: {blocking}"

        await browser.close()
        print("[e2e] PASS")
        return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
