'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const acorn = require('acorn');
const { harness: pluginHarness, code: pluginCode } = require('./helpers.cjs');
const loader = fs.readFileSync(require.resolve('../d.js'), 'utf8');
const CACHE_KEY = 'siaivo_dorama_loader_code_v1';
const payload = version => `/* Siaivo Dorama for Lampa 3.x / Siaivo\n * Version: ${version}\n */
(function () { var PLUGIN_ID = 'siaivo_dorama'; window.payloadVersion = '${version}';
window.payloadCalls = (window.payloadCalls || 0) + 1; }());`;

function harness(options = {}) {
    const state = { requests: [], warnings: [], notices: [], timers: new Map(), saved: options.saved || '', writes: 0 };
    let timerId = 0;
    const window = {
        console: { warn: message => state.warnings.push(message) },
        localStorage: {
            getItem(key) { assert.equal(key, CACHE_KEY); if (options.storageFails) throw Error('Privacy'); return state.saved; },
            setItem(key, value) { assert.equal(key, CACHE_KEY); if (options.storageFails) throw Error('Quota'); state.saved = value; state.writes++; }
        },
        Lampa: { Noty: { show: message => state.notices.push(message) } }
    };
    const document = {
        createElement(tag) { assert.equal(tag, 'script'); return {}; },
        head: { appendChild(script) { vm.runInContext(script.text, context); } }
    };
    function XHR() {
        this.open = (method, url, async) => { assert.equal(method, 'GET'); assert.equal(async, true); this.url = url; };
        this.send = () => { state.requests.push(this); options.respond?.(this, state); };
        this.abort = () => { this.aborted = true; this.onabort?.(); };
    }
    const context = vm.createContext({ window, document, Lampa: window.Lampa, XMLHttpRequest: XHR,
        setTimeout(fn, delay) { const id = ++timerId; state.timers.set(id, { fn, delay }); return id; },
        clearTimeout(id) { state.timers.delete(id); }
    });
    state.run = () => vm.runInContext(loader, context);
    state.complete = (request, code, status = 200) => { request.responseText = code; request.status = status; request.onload(); };
    return { state, window };
}

test('permanent loader is ES5 and fetches only the unversioned plugin source', () => {
    acorn.parse(loader, { ecmaVersion: 5 });
    const h = harness();
    h.state.run();
    const request = h.state.requests[0];
    const url = new URL(request.url);
    assert.equal(url.host, 'raw.githubusercontent.com');
    assert.equal(url.pathname, '/Lamp1ch-chmuk/dorami-Siaivo/main/siaivo-dorama.js');
    assert.deepEqual(Array.from(url.searchParams.keys()), ['siaivo_dorama_refresh']);
    assert.ok(Number(url.searchParams.get('siaivo_dorama_refresh')) > 0);
    assert.equal(request.timeout, 10000);
    h.state.complete(request, payload('0.5.1'));
    assert.equal(h.window.payloadVersion, '0.5.1');
    assert.equal(h.state.writes, 1);
    assert.equal(h.state.timers.size, 0);
});

test('the actual published plugin passes loader validation and registers in native APIs', () => {
    const h = pluginHarness();
    h.context.clearTimeout = () => {};
    h.context.window.localStorage = { getItem: () => '', setItem: () => {} };
    h.context.document = { createElement: () => ({}), head: {
        appendChild(script) { vm.runInContext(script.text, h.context); }
    } };
    h.context.XMLHttpRequest = function () {
        this.open = () => {};
        this.send = () => { this.status = 200; this.responseText = pluginCode; this.onload(); };
    };
    vm.runInContext(loader, h.context);
    assert.equal(h.state.source().__siaivo_dorama_plugin, require('../package.json').version);
    assert.equal(h.state.items.length, 1);
    assert.equal(h.context.window.__siaivo_dorama_loader_state, 'loaded');
});

test('a new app session downloads a newer release with the same entry and cache key', () => {
    const old = harness();
    old.state.run();
    old.state.complete(old.state.requests[0], payload('0.5.1'));
    const next = harness({ saved: old.state.saved });
    next.state.run();
    next.state.complete(next.state.requests[0], payload('0.5.2'));
    assert.equal(next.window.payloadVersion, '0.5.2');
    assert.equal(new URL(next.state.requests[0].url).pathname, new URL(old.state.requests[0].url).pathname);
    assert.equal(next.state.saved, payload('0.5.2'));
});

test('repeated injection while loading or loaded issues one request and one execution', () => {
    const h = harness();
    h.state.run(); h.state.run();
    assert.equal(h.state.requests.length, 1);
    h.state.complete(h.state.requests[0], payload('0.5.1'));
    h.state.run();
    assert.equal(h.window.payloadCalls, 1);
    assert.equal(h.state.requests.length, 1);
});

test('a directly loaded native plugin is preserved without a second download', () => {
    const h = harness();
    h.window.__siaivo_dorama_started = true;
    h.state.run();
    assert.equal(h.state.requests.length, 0);
});

test('network failure and timeout use last saved version without requesting stale CDN', () => {
    for (const event of ['onerror', 'ontimeout']) {
        const h = harness({ saved: payload('0.5.1') });
        h.state.run();
        h.state.requests[0][event]();
        assert.equal(h.window.payloadVersion, '0.5.1');
        assert.equal(h.state.requests.length, 1);
        assert.equal(h.state.writes, 0);
        assert.equal(h.state.timers.size, 0);
    }
});

test('unsupported XHR timeout is bounded; a late response cannot run a second version', () => {
    const h = harness({ saved: payload('0.5.1') });
    h.state.run();
    const request = h.state.requests[0];
    const late = request.onload;
    const timer = Array.from(h.state.timers.values())[0];
    assert.equal(timer.delay, 12000);
    timer.fn();
    assert.equal(request.aborted, true);
    request.status = 200; request.responseText = payload('0.5.2'); late();
    assert.equal(h.window.payloadVersion, '0.5.1');
    assert.equal(h.window.payloadCalls, 1);
});

test('first installation without saved code uses one CDN fallback', () => {
    const h = harness();
    h.state.run();
    h.state.requests[0].onerror();
    assert.equal(h.state.requests.length, 2);
    assert.equal(new URL(h.state.requests[1].url).host, 'cdn.jsdelivr.net');
    h.state.complete(h.state.requests[1], payload('0.5.1'));
    assert.equal(h.window.payloadVersion, '0.5.1');
    assert.equal(h.state.saved, payload('0.5.1'));
});

test('HTML, redirects without JS, oversized bodies, and HTTP errors never replace saved code', () => {
    for (const [body, status] of [['<html>Not Found</html>', 200], [payload('0.5.2'), 404],
        [payload('0.5.2').padEnd(512001), 200], [loader, 200]]) {
        const h = harness({ saved: payload('0.5.1') });
        h.state.run();
        h.state.complete(h.state.requests[0], body, status);
        assert.equal(h.window.payloadVersion, '0.5.1');
        assert.equal(h.state.saved, payload('0.5.1'));
        assert.equal(h.state.requests.length, 1);
    }
});

test('failed primary/CDN with invalid cache reports once and permits a later retry', () => {
    const h = harness({ saved: '<html>Invalid cache</html>' });
    h.state.run();
    h.state.requests[0].onerror();
    h.state.requests[1].onerror();
    assert.equal(h.window.payloadCalls, undefined);
    assert.equal(h.state.notices.length, 1);
    assert.equal(h.state.timers.size, 0);
    h.state.run();
    assert.equal(h.state.requests.length, 3);
    h.state.complete(h.state.requests[2], payload('0.5.1'));
    assert.equal(h.window.payloadVersion, '0.5.1');
});

test('privacy/quota restrictions do not prevent fresh code from executing', () => {
    const h = harness({ storageFails: true });
    h.state.run();
    h.state.complete(h.state.requests[0], payload('0.5.1'));
    assert.equal(h.window.payloadVersion, '0.5.1');
    assert.equal(h.state.writes, 0);
    assert.equal(h.state.notices.length, 0);
});
