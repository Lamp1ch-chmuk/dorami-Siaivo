'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const acorn = require('acorn');
const { harness, code } = require('./helpers.cjs');
const route = 'siaivo-dorama:2026-10-02:kr_popular';

test('plugin parses as ES5, not merely a regex subset', () => {
    acorn.parse(code, { ecmaVersion: 5 });
});

test('repeated injection and ready/menu events keep one source/button/listener', () => {
    const h = harness();
    h.state.run();
    const source = h.state.source();
    h.state.run();
    h.state.emit('app', { type: 'ready' });
    h.state.emit('menu', { type: 'start', body: h.root });
    assert.equal(h.state.source(), source);
    assert.equal(h.state.items.length, 1);
    assert.equal(h.state.listeners.menu.length, 1);
    h.state.items = [];
    h.state.emit('menu', { type: 'start', body: h.root });
    assert.equal(h.state.items.length, 1);
    h.state.items[0].action();
    assert.equal(h.state.routes[0].data.source, 'plugin_siaivo_dorama');
});

test('foreign sources are preserved even with a spoofed plugin marker', () => {
    for (const foreign of [{}, { __siaivo_dorama_plugin: 'other' }]) {
        const h = harness();
        h.lampa.Api.sources.plugin_siaivo_dorama = foreign;
        h.state.run();
        assert.equal(h.state.source(), foreign);
        assert.equal(h.state.items.length, 0);
        assert.match(h.state.warnings[0], /Source id/);
    }
});

test('foreign menu actions, including unmarked ones, are diagnosed and untouched', () => {
    for (const owner of [undefined, 'another_plugin']) {
        const h = harness();
        const foreign = h.button('Foreign', () => {});
        foreign.attr('data-action', 'plugin_siaivo_dorama');
        if (owner) foreign.attr('data-plugin', owner);
        h.state.items.push(foreign);
        h.state.run();
        assert.equal(h.state.items.length, 1);
        assert.equal(h.state.items[0], foreign);
        assert.match(h.state.warnings[0], /Menu action/);
    }
});

test('waits for app ready; core retries recover when a required API appears', () => {
    const h = harness({ ready: false });
    h.state.run();
    assert.equal(h.state.items.length, 0);
    const list = h.lampa.Api.list;
    delete h.lampa.Api.list;
    h.state.emit('app', { type: 'ready' });
    assert.equal(h.state.items.length, 0);
    h.lampa.Api.list = list;
    h.state.tick();
    assert.equal(h.state.items.length, 1);
});

test('bootstrap recovers when Lampa appears after plugin injection', () => {
    const h = harness({ ready: false });
    delete h.context.window.Lampa;
    h.state.run();
    assert.equal(h.state.timers.length, 1);
    h.context.window.Lampa = h.lampa;
    h.state.tick();
    h.state.emit('app', { type: 'ready' });
    assert.equal(h.state.items.length, 1);
    assert.equal(h.state.listeners.app.length, 1);
});

test('missing core and missing Lampa have bounded retries', () => {
    for (const bootstrap of [false, true]) {
        const h = harness({ ready: !bootstrap });
        if (bootstrap) delete h.context.window.Lampa;
        else delete h.lampa.Api.partNext;
        h.state.run();
        let ticks = 0;
        while (h.state.timers.length && ticks < 200) { h.state.tick(); ticks++; }
        assert.equal(ticks, 120);
        assert.equal(h.state.timers.length, 0);
        assert.equal(h.state.items.length, 0);
        assert.equal(h.state.warnings.length, 1);
    }
});

test('tmdb.get absence uses public Api.list without recursion into custom source', () => {
    const h = harness();
    delete h.lampa.Api.sources.tmdb.get;
    h.state.run();
    let rows;
    h.state.source().category({}, value => { rows = value; }, assert.fail);
    assert.equal(rows.length, 4);
    assert.ok(h.state.requests.every(r => r.kind === 'list' && r.params.source === 'tmdb'));
});

test('empty/failed rows are skipped and remaining rows backfill in order', () => {
    const h = harness({ respond(call, state) {
        if (state.requests.length === 1) return call.error();
        if (state.requests.length === 2) return call.ok({ results: [] });
        call.ok({ results: [{ id: state.requests.length, name: 'Drama', genre_ids: [18], first_air_date: '2024-01-01', vote_count: 200, origin_country: ['KR'] }] });
    }});
    h.state.run();
    let rows;
    h.state.source().category({}, value => { rows = value; }, assert.fail);
    assert.equal(h.state.requests.length, 6);
    assert.deepEqual(Array.from(rows, r => r.results[0].id), [3, 4, 5, 6]);
});

test('all empty responses or all network failures terminate once', () => {
    for (const fail of [false, true]) {
        const h = harness({ respond(call) { fail ? call.error() : call.ok({ results: [] }); } });
        h.state.run();
        let errors = 0;
        h.state.source().category({}, () => assert.fail('must not load empty rows'), () => errors++);
        assert.equal(errors, 1);
        assert.equal(h.state.requests.length, 6);
    }
});

test('out-of-order asynchronous completion preserves section order', () => {
    const pending = [];
    const h = harness({ respond(call) { pending.push(call); } });
    h.state.run();
    let rows;
    h.state.source().category({}, value => { rows = value; }, assert.fail);
    assert.equal(rows, undefined);
    pending.slice().reverse().forEach((call, i) => call.ok({ results: [{ id: i + 1, genre_ids: [18], first_air_date: '2024-01-01', vote_count: 200, origin_country: ['KR'] }] }));
    assert.deepEqual(Array.from(rows, r => r.url.split(':').pop()), ['kr_popular', 'cn_popular', 'jp_popular', 'th_popular']);
});

test('new category visits have independent lazy queues and Seoul-day anchors', () => {
    const h = harness();
    h.state.run();
    let first;
    const next = h.state.source().category({}, rows => { first = rows; }, assert.fail);
    h.state.now = '2026-10-02T16:30:00Z';
    let second;
    h.state.source().category({}, rows => { second = rows; }, assert.fail);
    assert.match(first[0].url, /2026-10-02/);
    assert.match(second[0].url, /2026-10-03/);
    let more;
    next(rows => { more = rows; }, assert.fail);
    assert.match(more[0].url, /2026-10-02:tw_popular/);
    h.state.source().list({ url: first[1].url, page: 2 }, () => {}, assert.fail);
    assert.equal(new URL(h.state.requests.at(-1).url, 'https://example.test').searchParams.get('first_air_date.lte'), null);
});

test('invalid dates/unknown sections fail once without a TMDB request', () => {
    const h = harness();
    h.state.run();
    const invalid = ['bad', 'siaivo-dorama:2026-02-29:kr_popular', 'siaivo-dorama:2026-13-01:kr_popular',
        'siaivo-dorama:2026-10-02:unknown', 'siaivo-dorama:2026-10-02:'];
    for (const url of invalid) {
        let errors = 0;
        h.state.source().list({ url }, assert.fail, () => errors++);
        assert.equal(errors, 1);
    }
    assert.equal(h.state.requests.length, 0);
});

test('page failures reach the error callback; valid leap-day route is accepted', () => {
    const h = harness({ respond(call) { call.error(); } });
    h.state.run();
    let errors = 0;
    h.state.source().list({ url: 'siaivo-dorama:2024-02-29:kr_popular' }, assert.fail, () => errors++);
    assert.equal(errors, 1);
    assert.equal(h.state.requests.length, 1);
});

test('malformed cards/metadata are sanitized without modifying frozen responses', () => {
    const card = Object.freeze({ id: 42, source: 'foreign', original_name: 'Drama', genre_ids: [18] });
    const raw = Object.freeze({
        results: Object.freeze([null, 'bad', [], {}, { id: -1 }, { id: Infinity }, { id: 1.5 }, { id: true }, { id: 'abc' }, card]),
        total_pages: '9'.repeat(400), total_results: '9'.repeat(400), source: 'tmdb'
    });
    const h = harness({ respond(call) { call.ok(raw); } });
    h.state.run();
    let output;
    h.state.source().list({ url: route, page: '9'.repeat(400) }, data => { output = data; }, assert.fail);
    assert.equal(h.state.requests[0].params.page, 1);
    assert.equal(output.results.length, 1);
    assert.equal(output.results[0].id, 42);
    assert.equal(output.results[0].source, 'tmdb');
    assert.equal(card.source, 'foreign');
    assert.notEqual(output.results[0], card);
    assert.equal(output.page, 1);
    assert.equal(output.total_pages, 1);
    assert.equal(output.total_results, 1);
});

test('legitimate empty-page totals remain zero; non-array results become empty', () => {
    const h = harness({ respond(call) { call.ok({ results: {}, total_pages: 0, total_results: 0 }); } });
    h.state.run();
    let data;
    h.state.source().list({ url: route }, value => { data = value; }, assert.fail);
    assert.equal(data.results.length, 0);
    assert.equal(data.total_pages, 0);
    assert.equal(data.total_results, 0);
});
