"""Responsive layout checks for the dashboard chat composer.

Run with: python3 tests/e2e/dashboard-chat-responsive.py
The script reuses an injected or locally minted test session when available.
"""

import asyncio
import json
import os
from pathlib import Path

from playwright.async_api import async_playwright


BASE_URL = "http://localhost:8080"
VIEWPORTS = (
    {"name": "desktop-short", "width": 1280, "height": 720},
    {"name": "tablet-narrow", "width": 820, "height": 900},
    {"name": "mobile-short", "width": 390, "height": 667},
)


async def restore_session(context, page) -> None:
    cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")

    session_file = Path.home() / ".cache/lovable-auth/session.json"
    if not session_json and session_file.exists():
        minted = json.loads(session_file.read_text())
        storage_key = minted.get("storage_key")
        session_json = json.dumps(minted.get("session"))
        cookies_json = json.dumps(minted.get("cookies", []))

    if cookies_json:
        cookies = json.loads(cookies_json)
        for cookie in cookies:
            cookie["url"] = BASE_URL
        await context.add_cookies(cookies)

    await page.goto(BASE_URL, wait_until="domcontentloaded")
    if storage_key and session_json:
        await page.evaluate(
            "([key, value]) => window.localStorage.setItem(key, value)",
            [storage_key, session_json],
        )


async def assert_composer_visible(page, viewport) -> None:
    await page.set_viewport_size({"width": viewport["width"], "height": viewport["height"]})
    await page.goto(f"{BASE_URL}/dashboard", wait_until="domcontentloaded")

    chat_tabs = page.get_by_role("button", name="Chat", exact=True)
    for index in range(await chat_tabs.count()):
        tab = chat_tabs.nth(index)
        if await tab.is_visible():
            await tab.click()
            break

    async def visible_locator(test_id):
        matches = page.get_by_test_id(test_id)
        for index in range(await matches.count()):
            match = matches.nth(index)
            if await match.is_visible():
                return match
        return matches.first

    composer = await visible_locator("dashboard-chat-composer")
    messages = await visible_locator("dashboard-chat-messages")
    textareas = page.get_by_role("textbox", name="Message your AI coach")
    textarea = textareas.first
    for index in range(await textareas.count()):
        candidate = textareas.nth(index)
        if await candidate.is_visible():
            textarea = candidate
            break
    await composer.wait_for(state="visible")

    await messages.evaluate(
        """element => {
          const content = element.firstElementChild;
          if (!content) return;
          for (let i = 0; i < 40; i += 1) {
            const row = document.createElement('div');
            row.textContent = `Responsive test message ${i + 1}`;
            row.style.minHeight = '40px';
            content.appendChild(row);
          }
          element.scrollTop = element.scrollHeight;
        }"""
    )

    metrics = await page.evaluate(
        """([composer, textarea, messages]) => {
          const c = composer.getBoundingClientRect();
          const t = textarea.getBoundingClientRect();
          const m = messages.getBoundingClientRect();
          return {
            composerTop: c.top,
            composerBottom: c.bottom,
            textareaTop: t.top,
            textareaBottom: t.bottom,
            messagesBottom: m.bottom,
            viewportHeight: window.innerHeight,
            messageOverflow: getComputedStyle(messages).overflowY,
          };
        }""",
        [composer, textarea, messages],
    )

    assert metrics["composerTop"] >= 0, metrics
    assert metrics["composerBottom"] <= metrics["viewportHeight"] + 1, metrics
    assert metrics["textareaTop"] >= 0, metrics
    assert metrics["textareaBottom"] <= metrics["viewportHeight"] + 1, metrics
    assert metrics["messagesBottom"] <= metrics["composerTop"] + 1, metrics
    assert metrics["messageOverflow"] in ("auto", "scroll"), metrics

    placeholder = await textarea.get_attribute("placeholder")
    assert placeholder == "Ask your coach or paste a chart screenshot"
    print(f"{viewport['name']}: composer visible")


async def main() -> None:
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()
        await restore_session(context, page)
        for viewport in VIEWPORTS:
            await assert_composer_visible(page, viewport)
        await browser.close()


asyncio.run(main())