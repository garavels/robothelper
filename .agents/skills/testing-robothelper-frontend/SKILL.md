---
name: testing-robothelper-frontend
description: Test the RobotHelper dashboard frontend end-to-end. Use when verifying UI styling, layout, or functional changes to the Next.js dashboard.
---

# Testing RobotHelper Frontend

## Local Dev Setup

```bash
cd robothelper
npm install
npx next dev --port 3000
```

The app runs at `http://localhost:3000`. No backend is required for frontend-only visual testing — the dashboard renders all components (map, video feed, agent status, stats) in their offline/placeholder state.

## Key UI Components to Test

The dashboard is a single-page app with these main areas:

1. **Header** — glass-morphism nav bar with brand title, connection status pill, camera toggle, reset button
2. **Map panel** (left, 60%) — Leaflet map with search zone perimeter, robot marker, trail paths, injury pins
3. **Video feed** (right top) — camera feed card with CV detection status
4. **Agent Status** (right middle) — AI rescue agent panel with feeling/status indicators
5. **Stats row** (right bottom) — four stat cards (Cleared, Scanned, Injured, Pins)
6. **Keyboard hint** — subtle hint bar at the very bottom

## Testing Tips

- **Keyboard navigation**: Click outside the Leaflet map before using WASD keys. If you click on the map, arrow keys get captured by Leaflet's pan handler instead of the app's keyboard handler. Use WASD keys for reliable testing.
- **Camera toggle**: Click "Cam On"/"Cam Off" button in header. When off, video area shows "Camera Disabled" placeholder.
- **Reset button**: Resets grid, robot position, injuries, and voice state back to initial values.
- **Stats verification**: After moving with WASD, Cleared % and Scanned count should increase. After Reset, they should return to initial values (~9.6% / 10/104 with demo cleared cells).
- **No backend needed**: Visual styling can be fully tested without the Python backend. Backend-dependent features (CV detections, voice, real robot connection) show offline/placeholder states.

## Build & Lint

```bash
cd robothelper
npx next build        # TypeScript + build check
npm run lint          # ESLint check
```

Known warnings (not errors):
- `@next/next/no-img-element` on VideoFeed.tsx — expected, uses base64 frame data
- `react-hooks/exhaustive-deps` on page.tsx — intentional dependency omission

## Color Palette (Interhuman.ai style)

- Background: `#09090b` (deep black)
- Surface/panels: `#141416`
- Accent: `#8b5cf6` (purple/violet)
- Accent light: `#a78bfa`
- Borders: `rgba(255, 255, 255, 0.08)`
- Text: `#fafafa` (foreground), zinc-400/500 (muted)

## Devin Secrets Needed

None required for frontend-only testing. Backend features (CV, voice, robot connection) would need:
- `OPENAI_API_KEY` — for AI rescue agent planner
- Robot SDK credentials — for real robot connection via MQTT
