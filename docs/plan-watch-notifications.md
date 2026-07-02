# Plan Watch Notifications

Nearcast keeps plan notifications platform-neutral: the app syncs a watched-plan
intent plus a delivery channel, and the server can later evaluate weather changes
without caring whether the client is a PWA or a native app.

## Current Foundation

- `POST /api/watch/notifications/register` stores a web push subscription and the
  enabled watched plans for that browser.
- `POST /api/watch/notifications/unregister` removes the stored subscription.
- `GET /api/watch/notifications/config` advertises whether Web Push is configured
  with a VAPID public key.
- The service worker handles `push` events and displays a notification that opens
  Nearcast.
- The browser syncs enabled watched plans when notification permission is granted,
  when a plan changes, when a plan is forgotten, and when watched forecasts refresh.

## Intentionally Not Built Yet

- Scheduled server-side plan evaluation.
- VAPID private-key signing and outbound Web Push delivery.
- Native APNs token registration.
- User accounts or cross-device plan sync.

## Target Flow

1. User enables notifications for a watched plan.
2. Client registers a delivery channel and watched-plan intent.
3. A scheduled worker refreshes forecasts for stored plan places.
4. The worker compares new weather truth to the stored last-known plan state.
5. A push is sent only when a plan meaningfully changes.
6. Tapping the notification opens Nearcast to the watched plan.
