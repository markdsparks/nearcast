import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../native/ios/NearcastApp/Models/NearcastWebModel.swift', import.meta.url), 'utf8');
const method = source.slice(source.indexOf('func handoffNativePreview('));
const script = method.slice(method.indexOf('webView.callAsyncJavaScript("""') + 'webView.callAsyncJavaScript("""'.length, method.indexOf('""", arguments:'));

async function run({ delayed = false, busy = false, unavailable = false, rejected = false } = {}) {
  const calls = [];
  let clock = 0;
  let hydrated = false;
  const sandbox = {
    payload: { destination: 'ask', initialQuery: 'Help me plan: Soccer Tuesday at 6 PM', place: { id: 'maryville' } },
    window: {},
    aiState: { phase: busy ? 'generating' : 'idle' },
    Date: { now: () => clock },
    setTimeout(resolve) { clock += 100; if (!unavailable) install(); resolve(); },
    nativeOwnerWeatherLoad: Promise.resolve().then(() => { hydrated = true; })
  };
  function install() {
    sandbox.runAsk = () => {};
    sandbox.window.NearcastNativePreview = {
      version: 1,
      async handoff(payload) {
        assert.ok(hydrated, 'Place hydration finishes before handoff');
        calls.push(payload);
        if (rejected) throw new Error('forecast unavailable');
        return { ok: true };
      }
    };
  }
  if (!delayed && !unavailable) install();
  const task = vm.runInNewContext(`(async () => { ${script} })()`, sandbox);
  if (busy || unavailable || rejected) await assert.rejects(task);
  else assert.equal((await task).ok, true);
  assert.equal(calls.length, busy || unavailable ? 0 : 1, 'Never silently drop or replay a submitted request');
  if (calls.length) assert.equal(calls[0].initialQuery, sandbox.payload.initialQuery);
}
await run();
await run({ delayed: true });
await run({ busy: true });
await run({ unavailable: true });
await run({ rejected: true });
console.log('PASS Native assistant readiness: hydration, late scripts, busy, timeout, exact-once handoff');
