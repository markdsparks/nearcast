import Foundation
import WebKit

/// Bundled document-start boundary, including for an old/offline web asset.
/// Only seven owned keys are projected; plan/notification data stays untouched.
enum NativePlacesOwnerBridge {
    static func seed(status: String, snapshot: NativePlacesOwnerSnapshot?) -> [String: Any] {
        let object = snapshot.flatMap { try? JSONEncoder().encode($0) }
            .flatMap { try? JSONSerialization.jsonObject(with: $0) }
        return ["status": status, "snapshot": object ?? NSNull()]
    }

    static func script(status: String, snapshot: NativePlacesOwnerSnapshot?, origin: URL) -> WKUserScript {
        let scheme = origin.scheme?.lowercased() ?? "https"
        let port = origin.port.flatMap { $0 == (scheme == "https" ? 443 : 80) ? nil : ":\($0)" } ?? ""
        let expectedOrigin = "\(scheme)://\(origin.host?.lowercased() ?? "")\(port)"
        let payload: [String: Any] = ["seed": seed(status: status, snapshot: snapshot),
                                     "origin": expectedOrigin]
        let data = try! JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        let json = String(decoding: data, as: UTF8.self)
        return WKUserScript(source: "(function(configuration){\n" + body + "\n})(" + json + ");",
                            injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    static let body = #"""
    if (location.origin !== configuration.origin || !window.NearcastNative) return;
    const bridge = window.NearcastNative;
    const documentID = crypto.randomUUID();
    const pending = new Map();
    let confirmDocument;
    let documentConfirmed = false;
    const documentReady = new Promise(resolve => { confirmDocument = resolve; });
    const keys = new Set(['weather-places','weather-last-place','weather-unit','weather-theme',
      'nearcast-time-format','nearcast-reactive-sky-v1','nearcast-reactive-sky-motion-v1']);
    function request(action, values) {
      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error('The native change could not be verified. Reopen Places before retrying.'));
        }, 20000);
        pending.set(requestId, {resolve, reject, timer});
        documentReady.then(() => {
          if (pending.has(requestId)) bridge.postMessage({type:'placesOwner.' + action, documentID, requestId, ...values});
        });
      });
    }
    const api = bridge.placesOwner = {
      version:1, status:configuration.seed.status, snapshot:configuration.seed.snapshot,
      documentID, compatibleReady:false, ready:documentReady,
      perform(command) { return request('perform', {command}); },
      activate() { return Promise.reject(new Error('Enable native storage from native Settings.')); },
      acknowledgeDeletions(through) { return request('acknowledge', {through}); }
    };
    bridge.__resolvePlacesOwner = (result) => {
      if (result.documentID !== documentID) return;
      const entry = pending.get(result.requestId);
      if (!entry) return;
      clearTimeout(entry.timer); pending.delete(result.requestId);
      if (result.ok) entry.resolve(result.value);
      else entry.reject(new Error(result.message || 'Native places could not be verified.'));
    };
    bridge.__updatePlacesOwner = (value) => {
      if (value.documentID !== documentID) return;
      api.compatibleReady = false;
      api.status = value.status; api.snapshot = value.snapshot;
      documentConfirmed = true;
      confirmDocument();
      window.dispatchEvent(new CustomEvent('nearcast:native-places-owner', {detail:value}));
    };
    function fenced() { return !documentConfirmed || api.status !== 'unmigrated'; }
    function place(value) {
      if (!value) return null;
      const result = {...value};
      if (result.legacyIDType === 'number') result.id = Number(result.id);
      delete result.legacyIDType;
      return result;
    }
    function projection(key) {
      if (api.status === 'blocked') return null;
      const source = api.snapshot?.source;
      if (!source) return null;
      switch (key) {
        case 'weather-places': return JSON.stringify(source.savedPlaces.map(place));
        case 'weather-last-place': return source.lastPlace ? JSON.stringify(place(source.lastPlace)) : null;
        case 'weather-unit': return source.preferences.unit;
        case 'weather-theme': return source.preferences.theme;
        case 'nearcast-time-format': return source.preferences.timeFormat;
        case 'nearcast-reactive-sky-v1': return source.preferences.reactiveSkyEnabled ? '1' : '0';
        case 'nearcast-reactive-sky-motion-v1': return source.preferences.reactiveSkyMotionAllowed ? '1' : '0';
      }
      return null;
    }
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    const remove = Storage.prototype.removeItem, clear = Storage.prototype.clear;
    Storage.prototype.getItem = function(key) {
      return this === localStorage && api.status !== 'unmigrated' && keys.has(String(key)) ? projection(String(key)) : get.call(this, key);
    };
    Storage.prototype.setItem = function(key, value) {
      if (this === localStorage && fenced() && keys.has(String(key))) throw new Error('Native places own this setting.');
      return set.call(this, key, value);
    };
    Storage.prototype.removeItem = function(key) {
      if (this === localStorage && fenced() && keys.has(String(key))) throw new Error('Native places own this setting.');
      return remove.call(this, key);
    };
    Storage.prototype.clear = function() {
      if (this === localStorage && fenced()) throw new Error('Native places cannot be cleared by this document.');
      return clear.call(this);
    };
    const fetch = window.fetch.bind(window);
    window.fetch = function(input, init) {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      if (fenced() && !api.compatibleReady && !['GET','HEAD'].includes(method) &&
          /^\/api\/watch\/notifications\/(register|unregister)\/?$/.test(url.pathname)) {
        return Promise.reject(new Error('Notification targets are not reconciled yet.'));
      }
      return fetch(input, init);
    };
    bridge.postMessage({type:'placesOwner.ready', documentID});
    """#
}
