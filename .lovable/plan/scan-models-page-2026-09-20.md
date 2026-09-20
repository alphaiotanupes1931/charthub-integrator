# Scan Models page

## What will change

- Add a dedicated **Scan Models** page, similar in purpose to the AI Coaches page.
- Show TradeMind Classic, The Trading Channel, and Photon Trading as clean model cards with their short summaries, active state, version, readiness, full explanation, and source material where available.
- Let users select their active scan model directly from this page; the choice will continue to follow their account.
- Keep the dashboard model picker compact, then add **Manage all scan models** beneath its model list.
- Add Scan Models to the desktop navigation beside AI Coaches and Strategies.

## Technical details

- Create the authenticated `/scan-models` route with unique page metadata.
- Reuse the existing model registry and account selection hook, so there is no duplicate model data or change to scanner behavior.
- Use the existing app layout, controls, color tokens, and mobile-safe spacing.
- Add the route, navigation link, and picker link together so navigation remains valid.
- Verify the new page, model switching, type safety, and the relevant automated tests.
