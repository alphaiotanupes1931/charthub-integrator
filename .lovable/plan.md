# Cleaner mobile dashboard and Auto Trading control

## What will change

- Move **Scan Models** from the Coaching navigation group into **Insights**.
- Keep the phone experience focused on chart, scan, chat, journal, analytics, coaches, alerts, risk, and settings; desktop-only controls such as Auto Trading will stay out of the phone layout.
- Tighten the dashboard’s phone toolbar and action rows so the chart gets more room and secondary controls do not crowd the screen.
- Replace the separate Auto Trading toggle and grade selector with one desktop dropdown.
  - Closed state shows whether Auto Trading is on or off and, when active, its selected minimum grade.
  - Opening it shows **Off**, **A+ only**, **A and better**, and **B and better**.
  - Choosing a grade turns Auto Trading on with that grade in one action.
  - Choosing Off turns it off.
  - Existing broker-connection and live-trading acknowledgement protections remain unchanged.

## Verification

- Check desktop and phone dashboard layouts at their real viewport sizes.
- Verify Scan Models appears under Insights and no longer appears under Coaching.
- Test Auto Trading selection, off state, broker warning, consent warning, saved grade, and loading/error states.
- Run the relevant automated tests and the full test suite.
