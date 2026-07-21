import assert from "node:assert/strict";
import worker, {
  planWatchCandidateInQuietHours,
  planWatchCandidateIsUrgent,
  runScheduledPlanWatchEvaluations
} from "../workers/radar-capability.mjs";

const analyticsPoints = [];
const analyticsEnv = {
  PLAN_WATCH_TEST_TOKEN: "smoke-token",
  PLAN_WATCH_R2: createR2Bucket(),
  PRODUCT_EVENTS_RATE_LIMITER: createRateLimiter(Number.POSITIVE_INFINITY),
  PRODUCT_EVENTS_GLOBAL_RATE_LIMITER: createRateLimiter(Number.POSITIVE_INFINITY),
  PRODUCT_ANALYTICS: {
    writeDataPoint(point) {
      analyticsPoints.push(point);
    }
  }
};
const acceptedTelemetry = await worker.fetch(productEventRequest({
  events: [
    { name: "plan-check-completed", count: 1 },
    { name: "notification-registration-ready", count: 1 }
  ],
  platform: "ios",
  version: "3.0.284"
}), analyticsEnv, {});
assert.equal(acceptedTelemetry.status, 202);
assert.equal((await acceptedTelemetry.json()).acceptedCount, 2);
assert.deepEqual(analyticsPoints.map((point) => point.blobs), [
  ["plan-check-completed", "ios", "3.0.284"],
  ["notification-registration-ready", "ios", "3.0.284"]
]);
assert.deepEqual(analyticsPoints.map((point) => point.doubles), [[1], [1]]);

const telemetryWithLocation = await worker.fetch(productEventRequest({
  events: [{ name: "plan-watched", count: 1, latitude: 38.7 }],
  platform: "web",
  version: "3.0.284"
}), analyticsEnv, {});
assert.equal(telemetryWithLocation.status, 400);
assert.equal((await telemetryWithLocation.json()).error, "invalid-event-shape");
assert.equal(analyticsPoints.length, 2);

const crossOriginTelemetry = await worker.fetch(productEventRequest({
  events: [{ name: "plan-watched", count: 1 }],
  platform: "web",
  version: "3.0.284"
}, "https://example.test"), analyticsEnv, {});
assert.equal(crossOriginTelemetry.status, 403);
const missingOriginTelemetry = await worker.fetch(new Request("https://getnearcast.app/api/product/events", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ events: [{ name: "plan-watched", count: 1 }], platform: "web", version: "3.0.284" })
}), analyticsEnv, {});
assert.equal(missingOriginTelemetry.status, 403);

const telemetryBeforePrivacySignals = analyticsPoints.length;
for (const privacyHeader of ["Sec-GPC", "DNT"]) {
  const privacyResponse = await worker.fetch(new Request("https://getnearcast.app/api/product/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://getnearcast.app",
      [privacyHeader]: "1"
    },
    body: JSON.stringify({
      events: [{ name: "plan-watched", count: 1 }],
      platform: "web",
      version: "3.0.284"
    })
  }), analyticsEnv, {});
  assert.equal(privacyResponse.status, 204);
}
assert.equal(analyticsPoints.length, telemetryBeforePrivacySignals, "GPC and DNT must suppress server-side event writes");

const telemetryRatePoints = [];
const telemetryClientLimiter = createRateLimiter(1);
const telemetryRateEnv = {
  ...analyticsEnv,
  PRODUCT_EVENTS_RATE_LIMITER: telemetryClientLimiter,
  PRODUCT_EVENTS_GLOBAL_RATE_LIMITER: createRateLimiter(10),
  PRODUCT_ANALYTICS: {
    writeDataPoint(point) { telemetryRatePoints.push(point); }
  }
};
const firstRateTelemetry = await worker.fetch(productEventRequest({
  events: [{ name: "plan-watched", count: 1 }],
  platform: "web",
  version: "3.0.284"
}), telemetryRateEnv, {});
const blockedRateTelemetry = await worker.fetch(productEventRequest({
  events: [{ name: "plan-watched", count: 1 }],
  platform: "web",
  version: "3.0.284"
}), telemetryRateEnv, {});
assert.equal(firstRateTelemetry.status, 202);
assert.equal(blockedRateTelemetry.status, 429);
assert.equal((await blockedRateTelemetry.json()).error, "client-rate-limit");
assert.equal(telemetryRatePoints.length, 1, "rate-limited telemetry is never written");

const routineCandidate = { type: "plan-rain", priority: 90 };
const warningCandidate = { type: "plan-alert", priority: 140 };
const highPriorityStormCandidate = { type: "place-storm", priority: 162 };
const lateEvening = new Date("2026-01-15T05:30:00.000Z"); // 11:30 PM in Chicago.
assert.equal(planWatchCandidateInQuietHours(
  { client: { timezone: "America/Chicago" } },
  routineCandidate,
  {},
  lateEvening
), true);
assert.equal(planWatchCandidateInQuietHours(
  { client: { timezone: "America/Chicago" } },
  warningCandidate,
  {},
  lateEvening
), false);
assert.equal(planWatchCandidateInQuietHours(
  { client: { timezone: "America/Chicago" } },
  highPriorityStormCandidate,
  {},
  lateEvening
), true, "high priority alone must not bypass quiet hours without an official warning");
assert.equal(planWatchCandidateIsUrgent(warningCandidate), true);
assert.equal(planWatchCandidateIsUrgent(highPriorityStormCandidate), false);
assert.equal(planWatchCandidateIsUrgent({ type: "plan-alert", priority: 105 }), false);

const vapid = await createVapidCredentials();
const admissionPlan = registrationPlan("registration-admission");
const invalidEndpointBucket = createR2Bucket();
const invalidEndpointEnv = productionPlanWatchEnv(invalidEndpointBucket, vapid);
for (const endpoint of [
  "https://attacker.example/push/arbitrary",
  "https://127.0.0.1/push/private",
  "https://push.local/push/private"
]) {
  const invalidEndpoint = await worker.fetch(registerRequest("invalid-endpoint", [admissionPlan], undefined, { endpoint }), invalidEndpointEnv, {});
  assert.equal(invalidEndpoint.status, 400, `unsupported push endpoint must be rejected: ${endpoint}`);
  assert.equal((await invalidEndpoint.json()).error, "invalid-delivery-channel");
}
assert.equal([...invalidEndpointBucket.objects.keys()].filter((key) => key.includes("/subscriptions/")).length, 0);

const providerAllowlistBucket = createR2Bucket();
const providerAllowlistEnv = productionPlanWatchEnv(providerAllowlistBucket, vapid);
for (const [provider, endpoint] of [
  ["apple", "https://web.push.apple.com/nearcast-smoke"],
  ["mozilla", "https://updates.push.services.mozilla.com/wpush/v2/nearcast-smoke"],
  ["windows", "https://db3.notify.windows.com/?token=nearcast-smoke"]
]) {
  const supportedEndpoint = await worker.fetch(registerRequest(`provider-${provider}`, [registrationPlan(`provider-${provider}`)], undefined, { endpoint }), providerAllowlistEnv, {});
  assert.equal(supportedEndpoint.status, 200, `supported ${provider} Web Push endpoint is accepted`);
}

const zeroTargetResponse = await worker.fetch(registerRequest("zero-target", []), invalidEndpointEnv, {});
assert.equal(zeroTargetResponse.status, 400);
assert.equal((await zeroTargetResponse.json()).error, "missing-watch-target");

const publicOnlyBucket = createR2Bucket();
const publicOnlyEnv = productionPlanWatchEnv(publicOnlyBucket, vapid, {
  PLAN_WATCH_VAPID_PRIVATE_KEY: ""
});
const publicOnlyRegistration = await worker.fetch(registerRequest("public-vapid-only", [admissionPlan]), publicOnlyEnv, {});
assert.equal(publicOnlyRegistration.status, 200);
const publicOnlyBody = await publicOnlyRegistration.json();
assert.equal(publicOnlyBody.ok, false);
assert.equal(publicOnlyBody.reason, "web-push-not-configured", "a public VAPID key alone is not delivery-ready");

const registrationBucket = createR2Bucket();
const registrationClientLimiter = createRateLimiter(1);
const registrationRateEnv = productionPlanWatchEnv(registrationBucket, vapid, {
  PLAN_WATCH_MAX_ACTIVE_SUBSCRIPTIONS: "60",
  PLAN_WATCH_REGISTRATION_RATE_LIMITER: registrationClientLimiter,
  PLAN_WATCH_REGISTRATION_GLOBAL_RATE_LIMITER: createRateLimiter(100)
});
const firstRegistration = await worker.fetch(registerRequest("rate-first", [registrationPlan("rate-first")]), registrationRateEnv, {});
assert.equal(firstRegistration.status, 200);
const blockedRegistration = await worker.fetch(registerRequest("rate-second", [registrationPlan("rate-second")]), registrationRateEnv, {});
assert.equal(blockedRegistration.status, 429);
assert.equal((await blockedRegistration.json()).reason, "client-rate-limit");
const existingUpdate = await worker.fetch(registerRequest("rate-first", [registrationPlan("rate-first-updated")]), registrationRateEnv, {});
assert.equal(existingUpdate.status, 200, "an existing channel can renew/update after new-registration admission is exhausted");
assert.equal(registrationClientLimiter.calls, 2, "existing channel updates do not consume new-channel admission");

const fairBucket = createR2Bucket();
const fairEnv = productionPlanWatchEnv(fairBucket, vapid, {
  PLAN_WATCH_EVALUATOR_LIMIT: "2",
  PLAN_WATCH_MAX_ACTIVE_SUBSCRIPTIONS: "60",
  PLAN_WATCH_REGISTRATION_RATE_LIMITER: createRateLimiter(Number.POSITIVE_INFINITY),
  PLAN_WATCH_REGISTRATION_GLOBAL_RATE_LIMITER: createRateLimiter(Number.POSITIVE_INFINITY)
});
const fairToday = formatDate(new Date());
const fairTomorrow = formatDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
for (let index = 0; index < 12; index += 1) {
  const response = await worker.fetch(registerRequest(`fair-${index}`, [{
    id: `fair-plan-${index}`,
    title: "Fair plan",
    targetDate: fairTomorrow,
    startHour: 9,
    endHour: 10,
    place: { name: "Test", latitude: 38.7, longitude: -89.9 },
    lastKnown: {}
  }]), fairEnv, {});
  assert.equal(response.status, 200);
}
const fairOriginalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "api.open-meteo.com") return Response.json(forecastFixture(fairToday, fairTomorrow));
    if (url.hostname === "api.weather.gov") return Response.json({ features: [] });
    throw new Error(`Unexpected fair-scheduler fetch ${url}`);
  };
  for (let pass = 0; pass < 6; pass += 1) {
    await runScheduledPlanWatchEvaluations(fairEnv, { includeStandard: true });
  }
} finally {
  globalThis.fetch = fairOriginalFetch;
}
const subscriptionRecords = [...fairBucket.objects.entries()]
  .filter(([key]) => key.includes("/subscriptions/"))
  .map(([, value]) => JSON.parse(value.body));
assert.equal(subscriptionRecords.length, 12, "production capacity is intentionally above the legacy ten-device beta gate");
assert.equal(subscriptionRecords.filter((record) => record.evaluatedAt).length, 12, "standard cursor reaches every page");
assert.equal(subscriptionRecords.filter((record) => record.urgentEvaluatedAt).length, 12, "urgent cursor is independently fair");

const unauthorizedHealth = await worker.fetch(new Request("https://getnearcast.app/api/watch/notifications/health"), fairEnv, {});
assert.equal(unauthorizedHealth.status, 401);
const healthResponse = await worker.fetch(new Request("https://getnearcast.app/api/watch/notifications/health", {
  headers: { Authorization: "Bearer smoke-token" }
}), fairEnv, {});
const health = await healthResponse.json();
assert.equal(healthResponse.status, 200, JSON.stringify(health, null, 2));
assert.equal(health.ok, true);
assert.equal(health.mode, "production");
assert.equal(health.evaluator.standard.scope, "standard");
assert.equal(health.evaluator.urgent.scope, "urgent");
assert.equal(health.evaluator.backlogSlaMinutes.standard, 90);
assert.equal(health.evaluator.backlogSlaMinutes.urgent, 45);
const healthJson = JSON.stringify(health);
assert.doesNotMatch(healthJson, /fair-|subscriptionId|endpoint|latitude|longitude|Fair plan/);
const untargetedCanary = await worker.fetch(new Request("https://getnearcast.app/api/watch/notifications/test", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer smoke-token" },
  body: JSON.stringify({ notification: { title: "Do not send" } })
}), fairEnv, {});
assert.equal(untargetedCanary.status, 400, "a canary can never fall back to an arbitrary user channel");

const missingRequiredChannelHealth = await worker.fetch(new Request("https://getnearcast.app/api/watch/notifications/health", {
  headers: { Authorization: "Bearer smoke-token" }
}), {
  ...fairEnv,
  PLAN_WATCH_REQUIRED_DELIVERY_CHANNELS: "web-push,apns"
}, {});
assert.equal(missingRequiredChannelHealth.status, 503, "health requires every configured production delivery channel");
assert.equal((await missingRequiredChannelHealth.json()).checks.delivery, false);

const deliveryBucket = createR2Bucket();
const deliveryEnv = productionPlanWatchEnv(deliveryBucket, vapid, {
  PLAN_WATCH_EVALUATOR_LIMIT: "1",
  PLAN_WATCH_DELIVERY_RETRY_BASE_MS: "0",
  PLAN_WATCH_QUIET_HOURS_START: "0",
  PLAN_WATCH_QUIET_HOURS_END: "0"
});
const today = formatDate(new Date());
const tomorrow = formatDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
const watchedPlan = {
  id: "delivery-plan",
  title: "Outdoor dinner",
  targetDate: tomorrow,
  startHour: 15,
  endHour: 20,
  place: { name: "Maryville", countryCode: "US", latitude: 38.723, longitude: -89.9559 },
  lastKnown: {
    snapshot: {
      title: "Outdoor dinner",
      targetDate: tomorrow,
      startHour: 15,
      endHour: 20,
      rainChance: 5,
      gustMax: 10,
      windUnit: "mph",
      feelsMax: 85,
      tempUnit: "°F",
      score: 90,
      tone: "good",
      alertTone: "",
      alertEvent: "",
      riskKind: "good"
    }
  }
};
const deliveryRegistration = await worker.fetch(registerRequest("delivery", [watchedPlan], {
  timezone: "America/Chicago",
  unit: "fahrenheit"
}), deliveryEnv, {});
assert.equal(deliveryRegistration.status, 200);
const deliveryRecordKey = [...deliveryBucket.objects.keys()].find((key) => key.includes("/subscriptions/"));
const originalDeliveryRecord = JSON.parse(deliveryBucket.objects.get(deliveryRecordKey).body);

const originalFetch = globalThis.fetch;
let pushAttempts = 0;
let cancelledRetryResponses = 0;
try {
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "api.open-meteo.com") return Response.json(forecastFixture(today, tomorrow));
    if (url.hostname === "api.weather.gov") {
      return Response.json({
        features: [{
          properties: {
            event: "Extreme Heat Warning",
            severity: "Severe",
            onset: `${tomorrow}T12:00:00-05:00`,
            ends: `${tomorrow}T22:00:00-05:00`
          }
        }]
      });
    }
    if (url.hostname === "fcm.googleapis.com") {
      pushAttempts += 1;
      if (pushAttempts < 3) {
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("temporary"));
          },
          cancel() {
            cancelledRetryResponses += 1;
          }
        }), { status: 503 });
      }
      return new Response("", { status: 201 });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  const firstEvaluation = await evaluate(deliveryEnv);
  assert.equal(firstEvaluation.results[0].sent, 1);
  assert.equal(firstEvaluation.results[0].retries, 2);
  assert.equal(pushAttempts, 3, "transient Web Push failures retry before succeeding");
  assert.equal(cancelledRetryResponses, 2, "transient provider response streams are cancelled before retry");

  const firstPending = await pendingNotification(deliveryEnv, originalDeliveryRecord.subscription);
  const replayedPending = await pendingNotification(deliveryEnv, originalDeliveryRecord.subscription);
  assert.deepEqual(replayedPending.notification, firstPending.notification, "retry wakes keep the same copy until TTL");

  const deliveredRecord = JSON.parse(deliveryBucket.objects.get(deliveryRecordKey).body);
  deliveredRecord.plans[0].lastKnown = originalDeliveryRecord.plans[0].lastKnown;
  deliveryBucket.objects.set(deliveryRecordKey, {
    ...deliveryBucket.objects.get(deliveryRecordKey),
    body: JSON.stringify(deliveredRecord)
  });
  const duplicateEvaluation = await evaluate(deliveryEnv);
  assert.equal(duplicateEvaluation.results[0].deduplicated, 1, JSON.stringify({
    duplicateEvaluation,
    keys: [...deliveryBucket.objects.keys()]
  }, null, 2));
  assert.match(duplicateEvaluation.results[0].reasons.join(" "), /duplicate-suppressed/);
  assert.equal(pushAttempts, 3, "duplicate marker prevents a second provider send");
} finally {
  globalThis.fetch = originalFetch;
}

const alertFailureBucket = createR2Bucket();
const alertFailureEnv = productionPlanWatchEnv(alertFailureBucket, vapid, {
  PLAN_WATCH_EVALUATOR_LIMIT: "1",
  PLAN_WATCH_URGENT_EVALUATOR_LIMIT: "1"
});
const alertFailurePlan = {
  ...watchedPlan,
  id: "alert-readiness-plan",
  lastKnown: {
    snapshot: {
      ...watchedPlan.lastKnown.snapshot,
      alertTone: "warning",
      alertEvent: "Flood Warning"
    }
  }
};
const alertFailureRegistration = await worker.fetch(registerRequest("alert-readiness", [alertFailurePlan]), alertFailureEnv, {});
assert.equal(alertFailureRegistration.status, 200);
const alertFailureRecordKey = [...alertFailureBucket.objects.keys()].find((key) => key.includes("/subscriptions/"));
let alertRequests = 0;
let forecastRequests = 0;
try {
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "api.weather.gov") {
      alertRequests += 1;
      return new Response("NWS unavailable", { status: 503 });
    }
    if (url.hostname === "api.open-meteo.com") {
      forecastRequests += 1;
      return Response.json(forecastFixture(today, tomorrow));
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  const failedScheduled = await runScheduledPlanWatchEvaluations(alertFailureEnv, { includeStandard: true });
  assert.equal(failedScheduled.length, 2);
  assert.equal(failedScheduled[0].scope, "urgent");
  assert.equal(failedScheduled[0].ok, false);
  assert.equal(failedScheduled[0].alertErrors, 1);
  assert.equal(failedScheduled[0].externalRequests, 1, "urgent evaluation performs only the official-alert request");
  assert.equal(failedScheduled[1].scope, "standard");
  assert.equal(failedScheduled[1].ok, false);
  assert.equal(failedScheduled[1].alertErrors, 1);
  assert.equal(failedScheduled[1].externalRequests, 1, "standard evaluation reuses the urgent alert result and only adds forecast data");
  assert.equal(alertRequests, 1, "urgent and standard passes share one NWS request per place");
  assert.equal(forecastRequests, 1, "the urgent pass never loads a forecast");

  const failedManualResponse = await worker.fetch(new Request("https://getnearcast.app/api/watch/notifications/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer smoke-token" },
    body: JSON.stringify({ dryRun: false, limit: 1 })
  }), alertFailureEnv, {});
  assert.equal(failedManualResponse.status, 500, "manual evaluation fails when official-alert readiness is unknown");
  const failedManual = await failedManualResponse.json();
  assert.equal(failedManual.ok, false);
  assert.equal(failedManual.alertErrors, 1);

  const preservedAlertRecord = JSON.parse(alertFailureBucket.objects.get(alertFailureRecordKey).body);
  assert.equal(preservedAlertRecord.plans[0].lastKnown.snapshot.alertTone, "warning");
  assert.equal(preservedAlertRecord.plans[0].lastKnown.snapshot.alertEvent, "Flood Warning");

  const failedHealthResponse = await worker.fetch(new Request("https://getnearcast.app/api/watch/notifications/health", {
    headers: { Authorization: "Bearer smoke-token" }
  }), alertFailureEnv, {});
  assert.equal(failedHealthResponse.status, 503);
  const failedHealth = await failedHealthResponse.json();
  assert.equal(failedHealth.checks.urgentSchedule, false);
  assert.equal(failedHealth.checks.standardSchedule, false);
  assert.equal(failedHealth.evaluator.urgent.alertErrors, 1);
  assert.equal(failedHealth.evaluator.standard.alertErrors, 1);
} finally {
  globalThis.fetch = originalFetch;
}

const backlogBucket = createR2Bucket();
const backlogEnv = productionPlanWatchEnv(backlogBucket, vapid, {
  PLAN_WATCH_EVALUATOR_LIMIT: "1",
  PLAN_WATCH_URGENT_EVALUATOR_LIMIT: "1"
});
const backlogRegistration = await worker.fetch(registerRequest("backlog", [{
  id: "backlog-plan",
  title: "Backlog plan",
  targetDate: tomorrow,
  startHour: 9,
  endHour: 10,
  place: { name: "Test", countryCode: "US", latitude: 38.7, longitude: -89.9 },
  lastKnown: {}
}]), backlogEnv, {});
assert.equal(backlogRegistration.status, 200);
const backlogRecordKey = [...backlogBucket.objects.keys()].find((key) => key.includes("/subscriptions/"));
const backlogRecordObject = backlogBucket.objects.get(backlogRecordKey);
const backlogRecord = JSON.parse(backlogRecordObject.body);
const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
backlogRecord.registeredAt = twoHoursAgo;
backlogRecord.updatedAt = twoHoursAgo;
backlogBucket.objects.set(backlogRecordKey, { ...backlogRecordObject, body: JSON.stringify(backlogRecord) });

const backlogOriginalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "api.weather.gov") return Response.json({ features: [] });
    if (url.hostname === "api.open-meteo.com") return Response.json(forecastFixture(today, tomorrow));
    throw new Error(`Unexpected backlog-scheduler fetch ${url}`);
  };

  await runScheduledPlanWatchEvaluations(backlogEnv, { includeStandard: true });
  const backlogHealthResponse = await worker.fetch(new Request("https://getnearcast.app/api/watch/notifications/health", {
    headers: { Authorization: "Bearer smoke-token" }
  }), backlogEnv, {});
  assert.equal(backlogHealthResponse.status, 503, "oldest evaluation lag is a production health gate");
  const backlogHealth = await backlogHealthResponse.json();
  assert.equal(backlogHealth.checks.urgentBacklog, false);
  assert.equal(backlogHealth.checks.standardBacklog, false);
  assert.ok(backlogHealth.evaluator.urgent.scan.oldestEvaluationLagMs >= 2 * 60 * 60 * 1000 - 5000);
  assert.ok(backlogHealth.evaluator.standard.scan.oldestEvaluationLagMs >= 2 * 60 * 60 * 1000 - 5000);

  await runScheduledPlanWatchEvaluations(backlogEnv, { includeStandard: true });
  const recoveredBacklogHealth = await worker.fetch(new Request("https://getnearcast.app/api/watch/notifications/health", {
    headers: { Authorization: "Bearer smoke-token" }
  }), backlogEnv, {});
  const recoveredBacklogHealthBody = await recoveredBacklogHealth.json();
  assert.equal(recoveredBacklogHealth.status, 200, JSON.stringify(recoveredBacklogHealthBody, null, 2));
} finally {
  globalThis.fetch = backlogOriginalFetch;
}

console.log(JSON.stringify({
  telemetry: "strict-aggregate-only-with-privacy-and-rate-guards",
  registration: "provider-allowlist-and-edge-admission",
  scheduling: "alert-only-urgent-and-standard-fair-cursors",
  alertReadiness: "errors-preserve-baseline-and-degrade-health",
  backlog: "oldest-lag-gated",
  health: health.state,
  retries: pushAttempts,
  dedupe: "suppressed",
  quietHours: "deferred-with-warning-bypass"
}, null, 2));

function productEventRequest(payload, origin = "https://getnearcast.app") {
  return new Request("https://getnearcast.app/api/product/events", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(payload)
  });
}

function registerRequest(
  id,
  plans,
  client = { timezone: "America/Chicago", unit: "fahrenheit" },
  options = {}
) {
  return new Request("https://getnearcast.app/api/watch/notifications/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subscription: {
        endpoint: options.endpoint || `https://fcm.googleapis.com/fcm/send/${id}`,
        keys: { p256dh: "BBIka7fClMnNLw3O6WmFHA0rpnXFWQ7ug7v1lOAYKlsm4V0M3LFbq-R7QXp-9oIsyxxFOv0qLxdoe8bv0c8uw6E", auth: "AAAAAAAAAAAAAAAAAAAAAA" }
      },
      platform: { kind: "web-push" },
      client,
      plans,
      places: options.places || []
    })
  });
}

function registrationPlan(id) {
  return {
    id,
    title: "Registration check",
    targetDate: formatDate(new Date(Date.now() + 24 * 60 * 60 * 1000)),
    startHour: 9,
    endHour: 10,
    place: { name: "Test", countryCode: "US", latitude: 38.7, longitude: -89.9 },
    lastKnown: {}
  };
}

async function evaluate(env) {
  const response = await worker.fetch(new Request("https://getnearcast.app/api/watch/notifications/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer smoke-token" },
    body: JSON.stringify({ dryRun: false, limit: 1 })
  }), env, {});
  assert.equal(response.status, 200);
  return response.json();
}

async function pendingNotification(env, subscription) {
  const response = await worker.fetch(new Request("https://getnearcast.app/api/watch/notifications/pending", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription })
  }), env, {});
  assert.equal(response.status, 200);
  return response.json();
}

function productionPlanWatchEnv(bucket, vapid, overrides = {}) {
  return {
    PLAN_WATCH_R2: bucket,
    PLAN_WATCH_TEST_TOKEN: "smoke-token",
    PLAN_WATCH_EVALUATOR_MODE: "production",
    PLAN_WATCH_REQUIRED_DELIVERY_CHANNELS: "web-push",
    PLAN_WATCH_VAPID_PUBLIC_KEY: vapid.publicKey,
    PLAN_WATCH_VAPID_PRIVATE_KEY: vapid.privateJwk,
    PLAN_WATCH_REGISTRATION_RATE_LIMITER: createRateLimiter(Number.POSITIVE_INFINITY),
    PLAN_WATCH_REGISTRATION_GLOBAL_RATE_LIMITER: createRateLimiter(Number.POSITIVE_INFINITY),
    ...overrides
  };
}

async function createVapidCredentials() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    publicKey: base64Url(raw),
    privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey)
  };
}

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createR2Bucket() {
  const objects = new Map();
  return {
    objects,
    async get(key) {
      const value = objects.get(key);
      if (!value) return null;
      return {
        async json() { return JSON.parse(value.body); },
        async text() { return value.body; }
      };
    },
    async put(key, body, options = {}) {
      objects.set(key, { body: String(body), options });
    },
    async delete(key) {
      objects.delete(key);
    },
    async list(options = {}) {
      const prefix = String(options.prefix || "");
      const limit = Math.max(1, Number(options.limit) || 1000);
      const offset = Math.max(0, Number(options.cursor) || 0);
      const matching = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
      const keys = matching.slice(offset, offset + limit);
      const next = offset + keys.length;
      return {
        objects: keys.map((key) => ({ key })),
        truncated: next < matching.length,
        cursor: next < matching.length ? String(next) : undefined
      };
    }
  };
}

function createRateLimiter(successfulCalls = Number.POSITIVE_INFINITY) {
  let calls = 0;
  return {
    get calls() { return calls; },
    async limit() {
      calls += 1;
      return { success: calls <= successfulCalls };
    }
  };
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function forecastFixture(today, tomorrow) {
  const hours = [15, 16, 17, 18, 19];
  return {
    utc_offset_seconds: -18000,
    hourly: {
      time: hours.map((hour) => `${tomorrow}T${String(hour).padStart(2, "0")}:00`),
      temperature_2m: [90, 91, 92, 91, 89],
      apparent_temperature: [94, 96, 98, 96, 93],
      precipitation_probability: [5, 5, 5, 5, 5],
      precipitation: [0, 0, 0, 0, 0],
      wind_speed_10m: [5, 5, 5, 5, 5],
      wind_gusts_10m: [10, 10, 10, 10, 10],
      uv_index: [4, 3, 2, 1, 0],
      weather_code: [1, 1, 1, 1, 1]
    },
    daily: {
      time: [today, tomorrow],
      weather_code: [1, 1],
      temperature_2m_max: [90, 92],
      temperature_2m_min: [70, 72],
      apparent_temperature_max: [94, 98],
      apparent_temperature_min: [70, 72],
      precipitation_sum: [0, 0],
      precipitation_probability_max: [5, 5],
      wind_speed_10m_max: [5, 5],
      wind_gusts_10m_max: [10, 10],
      uv_index_max: [5, 5]
    }
  };
}
