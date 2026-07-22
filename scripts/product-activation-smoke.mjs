import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, planner, html, styles, serviceWorker] = await Promise.all([
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "planner.js"), "utf8"),
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "styles.css"), "utf8"),
  readFile(path.join(root, "sw.js"), "utf8")
]);

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Found ${name}`);
  const signatureEnd = source.indexOf(") {", start);
  assert.notEqual(signatureEnd, -1, `Found ${name} signature`);
  const bodyStart = signatureEnd + 2;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`Could not extract ${name}`);
}

const invitationIndex = html.indexOf('id="planInvitation"');
const alertIndex = html.indexOf('id="alertBar"');
assert.ok(alertIndex >= 0 && invitationIndex > alertIndex, "the earned invitation follows safety alerts");
assert.match(html, /id="planInvitation"[^>]*aria-live="off"[^>]*hidden/, "forecast refreshes do not repeatedly announce the invitation");
assert.match(html, /id="planInvitationDismiss"[^>]*aria-label="Dismiss plan suggestion"/, "the invitation is explicitly dismissible");
assert.equal((html.match(/data-plan-invitation-template=/g) || []).length, 3, "three concrete plan starters are offered");
for (const label of ["Evening walk", "Practice", "Patio dinner"]) {
  assert.ok(html.includes(`>${label}</button>`), `${label} stays concise enough for the phone-width shortcut row`);
}

const placesIndex = html.indexOf('id="placeSwitcher"');
const watchingIndex = html.indexOf('id="watchingSwitcher"');
assert.ok(placesIndex >= 0 && watchingIndex > placesIndex, "Watching is a stable destination directly below Places");
assert.match(html, /id="watchingSwitcher"[^>]*aria-label="Open Watching"/, "the Watching destination has a useful accessible name");

assert.match(app, /const PLAN_INVITATION_DISMISS_MS = 30 \* 24 \* 60 \* 60 \* 1000/, "dismissal is persisted for a calm 30-day interval");
assert.match(app, /const PLAN_INVITATION_MAX_IMPRESSIONS = 3/, "ignored invitations stop after a small number of sessions");
for (const signal of [
  "plan-invite-shown",
  "plan-invite-open",
  "plan-invite-dismiss",
  "plan-check-started",
  "plan-check-confirmed",
  "plan-check-completed",
  "plan-watched",
  "watching-open",
  "notification-opt-in",
  "notification-registration-ready",
  "notification-registration-failed",
  "notification-open",
  "watch-change-reviewed"
]) {
  assert.ok(app.includes(`"${signal}"`), `${signal} is an allowlisted activation signal`);
}
assert.match(app, /Only the allowlisted event name and a coarse count leave the device\.[\s\S]*Plan[\s\S]*wording, location, installation identifiers, and timestamps remain local\./, "the anonymous activation boundary is documented beside collection");
assert.match(extractFunction(app, "recordForYouSignal"), /queueProductEvent\(signal\)/, "local activation signals also queue an anonymous aggregate event");
assert.match(extractFunction(app, "productEventPayload"), /events: events\.map\(\(\{ name, count \}\) => \(\{ name, count \}\)\)/, "the upload contains only allowlisted event names and coarse counts");
assert.match(extractFunction(app, "productEventPayload"), /platform: productEventPlatform\(\)/, "the upload includes a coarse platform dimension");
assert.match(extractFunction(app, "productEventPayload"), /version: VERSION/, "the upload includes the app version for release comparison");
assert.doesNotMatch(extractFunction(app, "productEventPayload"), /latitude|longitude|place|plan|install|timestamp|lastAt|device/i, "the anonymous payload excludes location, plan content, identifiers, and timestamps");
assert.match(extractFunction(app, "productEventCollectionAllowed"), /globalPrivacyControl !== true[\s\S]*doNotTrack !== "1"/, "GPC and Do Not Track keep activation events local-only");
assert.match(extractFunction(app, "queueProductEvent"), /normalizeForYouSignal[\s\S]*productEventCollectionAllowed/, "only allowlisted signals enter a privacy-permitted network batch");
assert.match(extractFunction(app, "flushProductEvents"), /fetch\(PRODUCT_EVENT_ENDPOINT/, "anonymous activation batches use the production event endpoint");
assert.match(extractFunction(app, "flushProductEvents"), /navigator\.sendBeacon[\s\S]*PRODUCT_EVENT_ENDPOINT/, "page exit uses a non-blocking aggregate beacon");
assert.match(extractFunction(app, "flushProductEvents"), /mergeProductEventBatch\(events\)/, "failed activation uploads return to the batch for a later retry");
assert.equal(Number(app.match(/const PRODUCT_EVENT_MAX_BATCH_COUNT = (\d+)/)?.[1]), 20, "event bursts stay within the strict endpoint count cap");
assert.equal(Number(app.match(/const PRODUCT_EVENT_MAX_BATCH_EVENTS = (\d+)/)?.[1]), 20, "aggregate batches stay within the strict event cap");
assert.equal(Number(app.match(/const PRODUCT_EVENT_MAX_TOTAL_COUNT = (\d+)/)?.[1]), 100, "aggregate batches stay within the strict total-count cap");
assert.match(extractFunction(app, "observePlanInvitationImpression"), /IntersectionObserver/, "invitation impressions wait for actual viewport visibility");
assert.match(extractFunction(app, "observePlanInvitationImpression"), /intersectionRatio < 0\.6/, "most of the invitation must be visible before an impression counts");

assert.match(app, /if \(els\.planInvitation\) els\.planInvitation\.hidden = true/, "place changes suppress the old-place invitation while loading");
assert.match(app, /function setForecastLaunchLoading[\s\S]*clearPlanInvitationImpressionObserver\(\)/, "place changes also retire the old visibility observer");
assert.match(app, /function renderForecastLaunch\([\s\S]*renderPlanInvitation\(\)/, "warm and fresh forecast renders share the invitation path");
assert.match(app, /if \(planInvitationIsUnresolved\(\)\) return false/, "the install prompt yields to the defining Plan Check moment");
assert.match(app, /function retirePlanInvitationForPlanCheckEntry\([\s\S]*recordForYouSignal\("plan"\)[\s\S]*renderPlanInvitation\(\)[\s\S]*updateInstallPromptUI\(\)/, "the shared Plan Check entry transition retires the invitation and yields the next earned prompt");
assert.match(app, /function retirePlanInvitationForPlanCheckEntry\([\s\S]*forYouSignalState\("plan"\)\.count === 0/, "a deliberate first Plan Check visit persists even while the invitation is ineligible or snoozed");
assert.match(planner, /function openAISheet\([\s\S]*retirePlanInvitationForPlanCheckEntry\(\)/, "every Plan Check entry path shares the invitation retirement transition");
assert.match(app, /bindTapAction\(els\.watchingSwitcher,[\s\S]*closeAppMenu\(\);[\s\S]*openGlobalMemorySheet\(\)/, "Watching opens the overview and closes the menu");
assert.match(app, /const hasWeatherContext = !welcomeIsActive\(\)/, "Watching stays out of the no-place welcome state");

assert.match(planner, /if \(option\.confirmPlan\) \{[\s\S]*recordForYouSignal\("plan-check-confirmed"\)/, "confirmation is measured at the actual Looks right transition");
assert.match(planner, /normalized\.event[\s\S]*recordForYouSignal\("plan-check-completed"\)/, "only a valid plan result completes the check funnel");
assert.match(planner, /savePlanMemories\(\);[\s\S]*recordForYouSignal\("plan-watched"\)/, "watch creation is measured only after local persistence succeeds");
assert.match(planner, /function openGlobalMemorySheet\([\s\S]*recordForYouSignal\("watching-open"\)/, "all Watching entry points share one local open signal");
assert.match(planner, /Nothing being watched yet[\s\S]*data-memory-new>Create a plan/, "the persistent destination has a useful zero-plan state");

assert.match(styles, /\.plan-invitation-copy strong[\s\S]*font-size: 1\.03rem/, "the invitation headline is readable rather than micro text");
assert.match(styles, /\.plan-invitation-examples[\s\S]*grid-template-columns: repeat\(3/, "example actions share a stable row");
assert.match(styles, /\.plan-invitation-dismiss \{[\s\S]*width: 44px;[\s\S]*height: 44px;/, "dismissal has a reliable touch target");
assert.match(styles, /\.plan-invitation-examples button \{[\s\S]*min-height: 44px;/, "plan starters have reliable touch targets");
assert.match(styles, /\.watching-switcher-count\[hidden\]/, "a zero Watching count does not leave an empty badge");
assert.doesNotMatch(html, /class="ai-trust-note"/, "the AI sheet no longer leads with an explanatory card");
assert.match(html, /class="day-sheet ai-sheet is-entry"[\s\S]*id="askChatLog"[\s\S]*<textarea id="askInput"[\s\S]*aria-label="Ask Nearcast"/, "Nearcast keeps a persistent prompt and conversation shell");
assert.match(planner, /setNearcastAISurfaceMode\("conversation", \{ render: false \}\)[\s\S]*beginAskResponse\(question\)/, "every submitted prompt promotes into the conversation workspace");
assert.match(planner, /coarsePointer[\s\S]*event\.shiftKey/, "desktop Enter submits while phone Return and Shift+Enter remain available for a new line");
assert.match(planner, /askThread\.map\(renderNearcastConversationExchange\)/, "the conversation renders all turns in chronological order");
assert.match(planner, /function resetBriefing\([\s\S]*renderAsk\(\);[\s\S]*renderAILauncher\(\);/, "forecast refreshes preserve the active Nearcast conversation");
assert.doesNotMatch(planner.match(/function resetBriefing\([\s\S]*?\n\}/)?.[0] || "", /resetAsk\(/, "place-changing skills cannot erase their own conversation");
assert.match(planner, /function nearcastAgentConversationQuery\([\s\S]*Latest user request:/, "Operon receives bounded recent conversation context for follow-ups");
assert.match(planner, /matches\[0\] === 0 \? \(matches\[1\] \?\? null\) : \(matches\[0\] \?\? null\)/, "next-weekday requests use the upcoming occurrence unless today has that weekday");
assert.match(planner, /useConversationPlace[\s\S]*context\.lastPlace \|\| state\.activePlace[\s\S]*function executeNearcastAnswerSkill[\s\S]*ensureNearcastSkillPlace\("", context\)/, "implicit-place follow-ups stay grounded in the conversation's submission context");
assert.match(planner, /input\.disabled = false;[\s\S]*syncAskComposerState\(\)/, "users can draft a follow-up while local AI is working");
assert.match(planner, /send\.disabled = input\.disabled \|\| busy \|\| !hasValue/, "follow-up drafts cannot submit until the active local run finishes");
assert.match(planner, /const runIsCurrent = \(\)[\s\S]*if \(!runIsCurrent\(\)\) return;/, "stale agent runs cannot complete or navigate a replacement conversation");
assert.match(planner, /function stopNearcastResponse\([\s\S]*askAbort\.aborted = true[\s\S]*active\.a = "Stopped\."/, "the conversation offers a real stop action without discarding prior turns");
assert.match(planner, /function trapNearcastAIFocus\([\s\S]*event\.key !== "Tab"[\s\S]*last\.focus\(\)/, "the modal conversation keeps keyboard focus inside its visible controls");
assert.match(planner, /function openAISheet\([\s\S]*clearTimeout\(nearcastAICloseTimer\)/, "a quick reopen cancels the stale sheet-close timer");
assert.match(styles, /\.ask-plan-check \{[\s\S]*border-radius: 26px;[\s\S]*backdrop-filter: blur\(24px\)/, "the Nearcast composer uses the intended floating glass treatment");
assert.match(styles, /\.ask-composer-toolbar \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto 46px/, "the composer toolbar reserves a stable submit target");
assert.match(styles, /\.ai-sheet\.is-entry \{[\s\S]*height: 174px/, "first open is a compact floating prompt rather than a full sheet");
assert.match(styles, /\.ai-sheet\[hidden\] \{[\s\S]*display: none !important;/, "closed conversations leave the visual and accessibility trees during app handoffs");
assert.match(styles, /\.ai-sheet\.is-conversation \{[\s\S]*height: min\(92dvh, 840px\)/, "submitted prompts expand into a full conversation workspace");
assert.match(styles, /\.ai-sheet\.is-conversation\.sheet-keyboard-active \{[\s\S]*inset: 0 0 var\(--sheet-keyboard-inset/, "the phone keyboard cannot cover the conversation composer");
assert.match(styles, /@media \(max-width: 390px\)[\s\S]*\.ai-sheet\.is-conversation \.ask-composer-status \{[\s\S]*display: none;/, "the compact phone conversation protects the place and submit controls");

const sandbox = {
  state: {
    activePlace: { id: "here" },
    forecast: { current: { temperature_2m: 72 }, hourly: { time: ["2026-07-19T12:00"] } },
    planMemories: [],
    userContext: { actions: {} }
  },
  els: { planInvitation: {} },
  aiState: { phase: "unsupported" },
  PLAN_INVITATION_DISMISS_MS: 30 * 24 * 60 * 60 * 1000,
  PLAN_INVITATION_MAX_IMPRESSIONS: 3,
  welcomeIsActive: () => false,
  forYouSignalState(value) {
    return sandbox.state.userContext.actions[value] || { count: 0, lastAt: 0 };
  }
};
vm.createContext(sandbox);
vm.runInContext(`
  ${extractFunction(app, "planInvitationHasUsefulForecast")}
  ${extractFunction(app, "planInvitationIsUnresolved")}
  ${extractFunction(app, "planInvitationCanShow")}
  globalThis.invitationTest = { unresolved: planInvitationIsUnresolved, show: planInvitationCanShow };
`, sandbox);

const now = Date.UTC(2026, 6, 19, 18);
assert.equal(sandbox.invitationTest.show(now), true, "an earned first forecast can show the invitation");
sandbox.aiState.phase = "unknown";
assert.equal(sandbox.invitationTest.show(now), false, "the invitation waits until Plan Check is ready to open");
sandbox.aiState.phase = "unsupported";
sandbox.state.userContext.actions.plan = { count: 1, lastAt: now };
assert.equal(sandbox.invitationTest.unresolved(now), false, "prior Plan Check engagement permanently suppresses the nudge");
delete sandbox.state.userContext.actions.plan;
sandbox.state.userContext.actions["plan-invite-dismiss"] = { count: 1, lastAt: now - 1000 };
assert.equal(sandbox.invitationTest.unresolved(now), false, "a recent dismissal is respected");
sandbox.state.userContext.actions["plan-invite-dismiss"].lastAt = now - sandbox.PLAN_INVITATION_DISMISS_MS - 1;
assert.equal(sandbox.invitationTest.unresolved(now), true, "an old dismissal can gently re-earn the prompt");
delete sandbox.state.userContext.actions["plan-invite-dismiss"];
sandbox.state.userContext.actions["plan-invite-shown"] = { count: 3, lastAt: now };
assert.equal(sandbox.invitationTest.unresolved(now), false, "ignored prompts stop at the impression cap");
delete sandbox.state.userContext.actions["plan-invite-shown"];
sandbox.state.planMemories = [{ id: "saved" }];
assert.equal(sandbox.invitationTest.unresolved(now), false, "a watched plan makes the activation prompt unnecessary");

const daySandbox = {
  PLANNER_WEEKDAY_NAMES: ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
  plannerParseText: (value) => String(value || "").toLowerCase()
};
vm.createContext(daySandbox);
vm.runInContext(`
  ${extractFunction(planner, "resolveDayIndex")}
  globalThis.resolveDayIndexTest = resolveDayIndex;
`, daySandbox);
const wednesdayForecast = [3, 4, 5, 6, 0, 1, 2, 3, 4, 5].map((dow) => ({ dow }));
const tuesdayForecast = [2, 3, 4, 5, 6, 0, 1, 2, 3, 4].map((dow) => ({ dow }));
assert.equal(daySandbox.resolveDayIndexTest("next Tuesday", { daily: wednesdayForecast }), 6, "next Tuesday uses the upcoming Tuesday from Wednesday");
assert.equal(daySandbox.resolveDayIndexTest("next Tuesday", { daily: tuesdayForecast }), 7, "next Tuesday skips today when today is Tuesday");

const conversationSandbox = {
  askThread: Array.from({ length: 4 }, (_, index) => ({
    q: `prior question ${index} ${"q".repeat(180)}`,
    a: `prior answer ${index} ${"a".repeat(260)}`
  }))
};
vm.createContext(conversationSandbox);
vm.runInContext(`
  ${extractFunction(planner, "nearcastAgentConversationQuery")}
  globalThis.conversationQueryTest = nearcastAgentConversationQuery;
`, conversationSandbox);
const latestRequest = `latest request ${"z".repeat(480)}`;
const boundedConversation = conversationSandbox.conversationQueryTest(latestRequest, conversationSandbox.askThread.length);
assert.ok(boundedConversation.length <= 1800, "recent Operon conversation context fits the local model query budget");
assert.ok(boundedConversation.endsWith(latestRequest), "the latest user request survives conversation-context bounding intact");

const version = app.match(/const VERSION = "([^"]+)"/)?.[1];
assert.ok(version, "app version is declared");
assert.equal(serviceWorker.match(/const ASSET_VERSION = "([^"]+)"/)?.[1], version, "service-worker assets match the app version");
assert.equal(serviceWorker.match(/const CACHE = "nearcast-v(\d+)"/)?.[1], version.replaceAll(".", ""), "cache key follows the app version");
assert.ok([...html.matchAll(/\?v=([\d.]+)/g)].every(([, assetVersion]) => assetVersion === version), "all HTML assets use the activation version");

console.log(`Product activation smoke passed for Nearcast ${version}.`);
