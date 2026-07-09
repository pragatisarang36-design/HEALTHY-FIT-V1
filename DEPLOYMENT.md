# HealthyFit Deployment Checklist

Use this checklist when testing HealthyFit outside local development. Do not deploy with `localhost` API URLs for web or mobile builds.

## Backend

- Deploy `healthy-fit-backend` to a public HTTPS host.
- Update the actual runtime environment on the host, such as the Render dashboard environment variables. `.env.example` files are documentation only.
- Set `FRONTEND_URL` in the backend host environment to the deployed frontend browser origin.
- Confirm the deployed backend `/health` endpoint returns `{ "status": "ok" }`. The current backend source defines this route in `healthy-fit-backend/src/index.js`.
- If using Render free tier, expect the first request after idle to take up to a minute. Retry once before treating the deploy as broken.
- Discover the real Capacitor app origin before adding it to CORS:
  - Temporarily log `req.get('origin')` or `req.headers.origin` in the backend CORS path or a lightweight request logger.
  - Hit the deployed backend once from the installed Android build.
  - Check the deployed backend host logs for the reported origin.
  - Add that exact value to `FRONTEND_URL` or the backend CORS allowlist; do not guess it from localhost.

## Frontend

- Set `VITE_BACKEND_API_URL` in the actual frontend build environment, such as `.env.local` for local builds or the host/build system environment for deployed builds.
- Rebuild the web app after changing `VITE_BACKEND_API_URL`.
- Rebuild the Capacitor Android bundle after changing `VITE_BACKEND_API_URL`.

## Device Verification

- Install or open the rebuilt app on a device that is not using a dev tunnel.
- Sign in with a real test account.
- Confirm AI chat requests reach the deployed backend.
- Confirm nutrition estimate requests reach the deployed backend.
- Confirm an authenticated request with a valid Supabase Bearer token gets past `healthy-fit-backend/src/middleware/auth.js`; CORS passing and auth passing are separate checks.
- Confirm the app does not attempt to call `http://localhost:4000` on the device.
