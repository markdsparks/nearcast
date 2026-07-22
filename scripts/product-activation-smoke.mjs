import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, planner, html, styles, serviceWorker, operonRuntime, daygraph] = await Promise.all([
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "planner.js"), "utf8"),
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "styles.css"), "utf8"),
  readFile(path.join(root, "sw.js"), "utf8"),
  readFile(path.join(root, "operon-runtime.js"), "utf8"),
  readFile(path.join(root, "daygraph.js"), "utf8")
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
assert.match(planner, /function loadNearcastAgentSession\([\s\S]*nearcastAgentArtifactsForTurn/, "Operon loads bounded typed session artifacts before planning");
assert.match(planner, /function prepareRegisteredNearcastSkill\([\s\S]*definition\.prepare/, "every Operon skill call passes through host preparation");
assert.match(planner, /query: question,[\s\S]*sessionId: context\.sessionId,[\s\S]*prepareSkill:/, "Operon receives the raw latest request plus a separate typed session");
assert.match(planner, /function resetAsk\([\s\S]*rotateNearcastAgentSession\(\)[\s\S]*askThread = \[\]/, "New chat clears both transcript and ephemeral referents");
assert.match(planner, /window_ref = "last_result"/, "deterministic hourly fallback uses the same semantic session reference");
assert.match(planner, /type: "agent-skill"[\s\S]*pendingSkill:[\s\S]*question: context\.rootQuestion \|\| context\.question/, "typed Operon clarification retains a resumable host action");
assert.match(planner, /pending\.type === "agent-skill"[\s\S]*prepareRegisteredNearcastSkill\(context,[\s\S]*invokeRegisteredNearcastSkill\(context,/, "a short clarification answer resumes the pending skill without another model guess");
assert.match(planner, /captureArtifacts: agent\.skillCalls === 0 && !agent\.clarification/, "agent skill results rely only on host-issued typed artifacts");
assert.match(planner, /finishAskResponse\(row, directNavigation,[\s\S]*captureArtifacts: false/, "failed deterministic skills cannot fabricate focus artifacts from stale global state");
assert.match(planner, /directCommandSatisfied[\s\S]*receipt\.outputs\.some\(\(item\) => item\.skillId === directCommand\.skillId\)/, "a direct request is satisfied only by the matching skill type");
assert.match(planner, /context\.requiredSkillId && definition\.id !== context\.requiredSkillId/, "single-action commands reject a mismatched skill before it can mutate app state");
assert.match(planner, /rawSkillId[\s\S]*type: "agent-skill"[\s\S]*sessionId: context\.sessionId/, "raw Operon skill clarifications become resumable host continuations");
assert.match(planner, /preparedSkillState[\s\S]*preparedState\?\.windowArtifact/, "hourly execution retains the exact artifact selected during preparation");
assert.match(daygraph, /const focusedEvent = options\.eventWindow \|\| memoryEvent[\s\S]*if \(focusedEvent\) scrollFocusedSheetHour\(\)/, "hourly navigation focuses the referenced forecast window");
assert.match(operonRuntime, /loadSession: async \(\{ session_id, limit \}\)[\s\S]*loadSession\(session_id, limit\)/, "the browser adapter translates Operon 0.2 session loading");
assert.match(operonRuntime, /prepareSkill: async \(\{ skill_id, partial_arguments, artifacts \}\)[\s\S]*skillId: skill_id[\s\S]*partialArguments: partial_arguments/, "the browser adapter translates Operon 0.2 skill preparation");
assert.match(planner, /matches\[0\] === 0 \? \(matches\[1\] \?\? null\) : \(matches\[0\] \?\? null\)/, "next-weekday requests use the upcoming occurrence unless today has that weekday");
assert.match(planner, /useConversationPlace[\s\S]*context\.lastPlace \|\| state\.activePlace[\s\S]*function executeNearcastAnswerSkill[\s\S]*ensureNearcastSkillPlace\(requestedPlace, context\)/, "weather answers load an explicit grounded place or the conversation's captured place");
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
const datedForecast = wednesdayForecast.map((day, index) => ({ ...day, date: `2026-07-${String(22 + index).padStart(2, "0")}` }));
assert.equal(daySandbox.resolveDayIndexTest("on 2026-07-23", { daily: datedForecast }), 1, "typed artifacts resolve an absolute forecast date without relative-day drift");

const preparationSandbox = {
  NEARCAST_AGENT_ARTIFACT_KINDS: {
    place: "nearcast.place",
    window: "nearcast.forecast-window",
    view: "nearcast.view",
    plan: "nearcast.plan-draft"
  },
  placeLabel: (place) => [place?.name, place?.admin1].filter(Boolean).join(", "),
  normalizeQualifierKey: (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
  extractPlanLocationQuery: (value) => String(value || "").match(
    /\bin\s+(.+?)(?=\s+(?:next|this|coming|following|today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|and then)\b|[.!?]|$)/i
  )?.[1]?.trim() || "",
  parseNearcastDirectNavigation: (value) => /\b(?:open|show)\b[\s\S]*\bhourly\b/i.test(String(value || ""))
    ? { skillId: "nearcast.forecast_open_hourly" }
    : null,
  detectAskActivity: () => null,
  detectPlanActivity: () => null,
  NEARCAST_AGENT_PERIODS: new Set(["morning", "afternoon", "evening", "night", "day"]),
  buildAIContext: () => ({ daily: [{ date: "2026-07-22" }, { date: "2026-07-23" }] }),
  resolveDayIndex: (text) => /\b(?:tomorrow|2026-07-23)\b/i.test(String(text || "")) ? 1 : null
};
vm.createContext(preparationSandbox);
vm.runInContext(`
  ${extractFunction(planner, "nearcastSemanticReference")}
  ${extractFunction(planner, "nearcastReferencesWindow")}
  ${extractFunction(planner, "nearcastReferencesConversation")}
  ${extractFunction(planner, "nearcastExplicitDayText")}
  ${extractFunction(planner, "nearcastExplicitPeriodText")}
  ${extractFunction(planner, "nearcastExplicitDurationHours")}
  ${extractFunction(planner, "nearcastGroundedCandidate")}
  ${extractFunction(planner, "nearcastSkillRequestClauses")}
  ${extractFunction(planner, "nearcastClauseMatchesSkill")}
  ${extractFunction(planner, "nearcastScopedSkillRequest")}
  ${extractFunction(planner, "nearcastClarificationPlaceText")}
  ${extractFunction(planner, "nearcastArtifactForPreparation")}
  ${extractFunction(planner, "nearcastPlaceArtifactForPreparation")}
  ${extractFunction(planner, "nearcastPreparationNeedsInput")}
  ${extractFunction(planner, "nearcastPreparedPlace")}
  ${extractFunction(planner, "prepareNearcastHourlySkill")}
  ${extractFunction(planner, "prepareNearcastAnswerSkill")}
  ${extractFunction(planner, "prepareNearcastPlanSkill")}
  ${extractFunction(planner, "nearcastRequestMaxReplans")}
  globalThis.prepareHourlyTest = prepareNearcastHourlySkill;
  globalThis.prepareAnswerTest = prepareNearcastAnswerSkill;
  globalThis.preparePlanTest = prepareNearcastPlanSkill;
  globalThis.referencesConversationTest = nearcastReferencesConversation;
  globalThis.scopedRequestTest = nearcastScopedSkillRequest;
  globalThis.clarificationPlaceTest = nearcastClarificationPlaceText;
  globalThis.maxReplansTest = nearcastRequestMaxReplans;
`, preparationSandbox);
assert.equal(preparationSandbox.referencesConversationTest("Is it going to rain tomorrow?"), false, "weather grammar does not mistake existential 'it' for conversation memory");
assert.equal(preparationSandbox.referencesConversationTest("Is there any rain tomorrow?"), false, "existential 'there' does not become a place reference");
assert.equal(preparationSandbox.referencesConversationTest("Show hourly this Tuesday."), false, "temporal 'this' does not become a prior-result reference");
assert.equal(preparationSandbox.referencesConversationTest("What about the morning?"), true, "elliptical follow-ups retain the typed forecast day");
assert.equal(
  preparationSandbox.scopedRequestTest(
    "tomorrow weather",
    "Check tomorrow evening in Maryville and then open hourly",
    "nearcast.weather_answer"
  ),
  "Check tomorrow evening in Maryville",
  "a host-selected source clause preserves place and time even when the model paraphrases or under-scopes it"
);
assert.equal(preparationSandbox.clarificationPlaceTest("Maryville next Tuesday"), "Maryville", "combined clarification replies independently supply place and day");
assert.equal(
  preparationSandbox.maxReplansTest("Open the map, show the forecast, and open hourly"),
  2,
  "three requested actions receive two bounded replans"
);
const forecastTarget = {
  id: "window-1",
  kind: "nearcast.forecast-window",
  summary: "Tomorrow evening in Maryville",
  value: {
    place: { name: "Maryville", admin1: "Illinois" },
    place_label: "Maryville, Illinois",
    target_date: "2026-07-23"
  }
};
const preparedFollowupContext = {
  question: "Show hourly for that.",
  sessionArtifacts: [forecastTarget],
  artifactReferences: [{ id: forecastTarget.id }],
  preparedSkillState: new Map(),
  lastPlace: null
};
const preparedFollowup = preparationSandbox.prepareHourlyTest(
  { window_ref: "last_result" },
  preparedFollowupContext,
  { id: "nearcast.forecast_open_hourly" }
);
assert.equal(preparedFollowup.kind, "ready");
assert.deepEqual(
  JSON.parse(JSON.stringify(preparedFollowup.arguments)),
  { place: "Maryville, Illinois", day: "2026-07-23" },
  "'that' resolves to the canonical place and ISO date from typed working context"
);
assert.equal(
  preparedFollowupContext.preparedSkillState.get("nearcast.forecast_open_hourly")?.windowArtifact?.id,
  forecastTarget.id,
  "the exact typed window survives preparation for hourly focus"
);
const missingFollowup = preparationSandbox.prepareHourlyTest(
  { window_ref: "last_result" },
  { question: "Show hourly for that.", sessionArtifacts: [], artifactReferences: [], lastPlace: null },
  { id: "nearcast.forecast_open_hourly" }
);
assert.equal(missingFollowup.kind, "needs_input");
assert.deepEqual(
  JSON.parse(JSON.stringify(missingFollowup.clarification.missing_fields)),
  ["place", "day"],
  "a missing referent asks for input instead of guessing"
);
const hostileMissingFollowup = preparationSandbox.prepareHourlyTest(
  { place: "Invented Place", day: "tomorrow", invented: "ignore me" },
  { question: "Show hourly for that.", sessionArtifacts: [], artifactReferences: [], lastPlace: null },
  { id: "nearcast.forecast_open_hourly" }
);
assert.equal(hostileMissingFollowup.kind, "needs_input", "host preparation rejects model-invented referents after New chat");
const liverpoolView = {
  id: "view-2",
  kind: "nearcast.view",
  summary: "Map in Liverpool",
  value: {
    place: { name: "Liverpool", admin1: "England" },
    place_label: "Liverpool, England"
  }
};
const maryvillePlace = {
  id: "place-1",
  kind: "nearcast.place",
  summary: "Current conversation place: Maryville",
  value: {
    place: forecastTarget.value.place,
    place_label: forecastTarget.value.place_label
  }
};
const currentPlaceHourly = preparationSandbox.prepareHourlyTest(
  { place: "Invented Place", day: "tomorrow" },
  {
    question: "Show hourly this Tuesday.",
    sessionArtifacts: [],
    artifactReferences: [],
    lastPlace: liverpoolView.value.place
  },
  { id: "nearcast.forecast_open_hourly" }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(currentPlaceHourly.arguments)),
  { place: "Liverpool, England", day: "this Tuesday" },
  "a fresh hourly request uses the active place and the user's explicit day, never model-invented targets"
);
assert.equal(
  preparationSandbox.prepareHourlyTest(
    { place: "Invented Place", day: "tomorrow" },
    { question: "Show hourly.", sessionArtifacts: [], artifactReferences: [], lastPlace: liverpoolView.value.place },
    { id: "nearcast.forecast_open_hourly" }
  ).kind,
  "needs_input",
  "an unstated model day cannot bypass hourly clarification"
);
forecastTarget.value.period = "evening";
const ellipticalAnswer = preparationSandbox.prepareAnswerTest(
  { request: "What about the morning?" },
  {
    question: "What about the morning?",
    sessionArtifacts: [maryvillePlace, forecastTarget],
    artifactReferences: [],
    lastPlace: null
  },
  { id: "nearcast.weather_answer" }
);
assert.equal(ellipticalAnswer.kind, "ready");
assert.equal(
  ellipticalAnswer.arguments.request,
  "What about the morning? on 2026-07-23",
  "an explicit new period keeps the prior typed day without inheriting the old period"
);
const placeOnlyAnswer = preparationSandbox.prepareAnswerTest(
  { request: "What will the weather there be tomorrow?" },
  {
    question: "What will the weather there be tomorrow?",
    sessionArtifacts: [maryvillePlace, forecastTarget],
    artifactReferences: [],
    lastPlace: null
  },
  { id: "nearcast.weather_answer" }
);
assert.equal(
  placeOnlyAnswer.arguments.request,
  "What will the weather there be tomorrow?",
  "a place-only 'there' follow-up does not inherit an obsolete forecast period"
);
const chainedAnswer = preparationSandbox.prepareAnswerTest(
  { request: "Check tomorrow evening in Maryville and then open hourly" },
  {
    question: "Check tomorrow evening in Maryville and then open hourly",
    sessionArtifacts: [],
    artifactReferences: [],
    lastPlace: liverpoolView.value.place
  },
  { id: "nearcast.weather_answer" }
);
assert.equal(
  chainedAnswer.arguments.request,
  "Check tomorrow evening in Maryville",
  "the weather skill receives only its complete grounded clause from a chained request"
);
const hostilePlan = preparationSandbox.preparePlanTest(
  {
    request: "Find a two-hour walk slot there",
    place: "Invented Place",
    day: "tomorrow",
    period: "evening",
    duration_hours: 7
  },
  {
    question: "Find a two-hour walk slot there",
    sessionArtifacts: [maryvillePlace],
    artifactReferences: [],
    lastPlace: liverpoolView.value.place
  },
  { id: "nearcast.plan_find_and_draft" }
);
assert.equal(hostilePlan.kind, "needs_input");
assert.deepEqual(
  JSON.parse(JSON.stringify(hostilePlan.clarification.missing_fields)),
  ["day"],
  "an SLM-invented plan day cannot bypass host clarification even when the place referent is valid"
);
const groundedPlan = preparationSandbox.preparePlanTest(
  {
    request: "Find a two-hour walk slot in Maryville next Tuesday evening.",
    place: "Invented Place",
    day: "tomorrow",
    period: "morning",
    duration_hours: 7
  },
  {
    question: "Find a two-hour walk slot in Maryville next Tuesday evening.",
    sessionArtifacts: [],
    artifactReferences: [],
    lastPlace: liverpoolView.value.place
  },
  { id: "nearcast.plan_find_and_draft" }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(groundedPlan.arguments)),
  {
    request: "Find a two-hour walk slot in Maryville next Tuesday evening.",
    place: "Maryville",
    day: "next Tuesday",
    period: "evening",
    duration_hours: 2
  },
  "plan preparation derives every factual target from the user text instead of model guesses"
);
const atomicFollowup = preparationSandbox.prepareHourlyTest(
  { window_ref: forecastTarget.id, invented: "ignore me" },
  {
    question: "Show hourly for that.",
    sessionArtifacts: [forecastTarget, liverpoolView],
    artifactReferences: [forecastTarget, liverpoolView].map(({ id, kind, summary }) => ({ id, kind, summary })),
    lastPlace: null
  },
  { id: "nearcast.forecast_open_hourly" }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(atomicFollowup.arguments)),
  { place: "Maryville, Illinois", day: "2026-07-23" },
  "an explicit window keeps its place and date paired and strips unknown model fields"
);
assert.equal(
  preparationSandbox.prepareHourlyTest(
    { window_ref: "missing-artifact-id" },
    {
      question: "Show hourly for that.",
      sessionArtifacts: [forecastTarget],
      artifactReferences: [{ id: forecastTarget.id, kind: forecastTarget.kind, summary: forecastTarget.summary }],
      lastPlace: null
    },
    { id: "nearcast.forecast_open_hourly" }
  ).kind,
  "needs_input",
  "a stale or invented artifact ID never falls through to another target"
);
preparationSandbox.NEARCAST_AGENT_ARTIFACT_LIMIT = 8;
preparationSandbox.nearcastAgentSessionArtifacts = [forecastTarget];
preparationSandbox.samePlanPlace = (left, right) =>
  left?.name === right?.name && left?.admin1 === right?.admin1;
vm.runInContext(`
  ${extractFunction(planner, "rememberNearcastAgentArtifacts")}
  globalThis.rememberArtifactsTest = rememberNearcastAgentArtifacts;
  globalThis.currentArtifactsTest = () => nearcastAgentSessionArtifacts;
`, preparationSandbox);
preparationSandbox.rememberArtifactsTest([{
  id: "place-liverpool",
  kind: "nearcast.place",
  summary: "Current conversation place: Liverpool",
  value: { place: liverpoolView.value.place, place_label: liverpoolView.value.place_label }
}]);
assert.equal(
  preparationSandbox.currentArtifactsTest().some((artifact) => artifact.kind === "nearcast.forecast-window"),
  false,
  "switching places invalidates a forecast window from the prior place"
);

const stopWordsBody = planner.match(/const PLAN_LOCATION_STOP_WORDS = \[([\s\S]*?)\n\];/)?.[1];
assert.ok(stopWordsBody, "location stop words are available for extraction regression tests");
const locationSandbox = {
  normalizeQualifierKey: (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
  plannerParseText: (value) => String(value || "").toLowerCase(),
  plannerCanonicalTerm: (value) => value
};
vm.createContext(locationSandbox);
vm.runInContext(`
  const PLAN_LOCATION_STOP_WORDS = [${stopWordsBody}];
  const PLAN_LOCATION_IGNORE = new Set(["weather", "the weather"]);
  const PLAN_LOCATION_PREPOSITION_RE = /\\b(?:in|near|around|at)\\s+/gi;
  const PLANNER_CANONICAL_TERMS = [];
  ${extractFunction(planner, "findPlanLocationStopIndex")}
  ${extractFunction(planner, "isTemporalLocationPhrase")}
  ${extractFunction(planner, "cleanPlanLocation")}
  ${extractFunction(planner, "extractPlanLocationQuery")}
  globalThis.extractLocationTest = extractPlanLocationQuery;
`, locationSandbox);
assert.equal(
  locationSandbox.extractLocationTest("Show hourly in Maryville next Tuesday."),
  "Maryville",
  "place-before-day wording stops before the relative weekday qualifier"
);
assert.equal(
  locationSandbox.extractLocationTest("Check tomorrow in Maryville and then open hourly."),
  "Maryville",
  "a chained action does not leak into the preceding place query"
);

const version = app.match(/const VERSION = "([^"]+)"/)?.[1];
assert.ok(version, "app version is declared");
assert.equal(serviceWorker.match(/const ASSET_VERSION = "([^"]+)"/)?.[1], version, "service-worker assets match the app version");
assert.equal(serviceWorker.match(/const CACHE = "nearcast-v(\d+)"/)?.[1], version.replaceAll(".", ""), "cache key follows the app version");
assert.ok([...html.matchAll(/\?v=([\d.]+)/g)].every(([, assetVersion]) => assetVersion === version), "all HTML assets use the activation version");

console.log(`Product activation smoke passed for Nearcast ${version}.`);
