'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers.cjs');
const card = (id, extra = {}) => ({ id, name: 'Drama ' + id, original_name: 'Drama ' + id,
    genre_ids: [18], origin_country: ['KR'], first_air_date: '2026-09-01',
    popularity: 20, vote_count: 3, ...extra });
function read(h, page = 1, anchor = '2026-10-02') {
    let output, errors = 0;
    h.state.source().list({ url: 'siaivo-dorama:' + anchor + ':new_popular', page },
        data => { output = data; }, () => errors++);
    return { get output() { return output; }, get errors() { return errors; } };
}
function start(options) { const h = harness({ catalog: true, ...options }); h.state.run(); return h; }
function raw(call, cards, pages = 1) { call.ok({ page: call.params.page, total_pages: pages, results: cards }); }

test('newest is one five-country window with inclusive interest, vote and valid-date boundaries', () => {
    const h = start({ respond(call) {
        raw(call, [card(1, { first_air_date: '2026-06-04', popularity: 10 }),
            card(2, { first_air_date: '2026-10-02' }), card(3, { first_air_date: '2026-06-03' }),
            card(4, { first_air_date: '2026-10-03' }), card(5, { first_air_date: '' }),
            card(6, { first_air_date: '2026-09-31' }), card(7, { popularity: 9.99 }),
            card(8, { vote_count: 2 }), card(9, { popularity: 'unknown' }),
            card(10, { origin_country: ['HK'] }), card(11, { genre_ids: [16, 18] }),
            ...['CN', 'JP', 'TH', 'TW'].map((country, i) => card(20 + i, { origin_country: [country] }))]);
    }});
    const result = read(h).output;
    assert.deepEqual(Array.from(result.results, c => c.id), [1, 2, 20, 21, 22, 23]);
    const query = new URL(h.state.requests[0].url).searchParams;
    assert.equal(query.get('with_origin_country'), 'KR|CN|JP|TH|TW');
    assert.equal(query.get('with_original_language'), null);
    assert.equal(query.get('first_air_date.gte'), '2026-06-04');
    assert.equal(query.get('first_air_date.lte'), '2026-10-02');
    assert.equal(query.get('vote_count.gte'), '3');
    assert.equal(query.get('include_null_first_air_dates'), 'false');
    assert.equal(query.get('sort_by'), 'popularity.desc');
});

test('shortlist compacts gaps and duplicates into exact pages, shared with the horizontal row', () => {
    const h = start({ respond(call) {
        if (!call.url.includes('first_air_date.gte')) return raw(call, [card(900)]);
        const n = call.params.page;
        const cards = Array.from({ length: 20 }, (_, i) => card((n - 1) * 20 + i + 1,
            { popularity: n === 3 && i >= 6 ? 9 : 100 - n }));
        if (n === 2) cards.push(card(1)); // duplicate returned by a changing upstream page
        raw(call, cards, 20);
    }});
    const first = read(h).output;
    assert.equal(first.results.length, 40); assert.equal(first.total_results, 46); assert.equal(first.total_pages, 2);
    assert.deepEqual(Array.from(read(h, 2).output.results, c => c.id), [41, 42, 43, 44, 45, 46]);
    assert.equal(read(h, 3).output.results.length, 0);
    assert.equal(h.state.requests.length, 3);
    first.results[0].name = 'UI mutated title';
    let rows;
    const next = h.state.source().category({}, data => { rows = Array.from(data); }, assert.fail);
    next(data => rows.push(...data), assert.fail);
    const newest = rows.find(row => row.url.endsWith(':new_popular'));
    assert.equal(newest.results.length, 20); assert.equal(newest.results[0].name, 'Drama 1');
    assert.equal(newest.total_results, 46);
    assert.equal(h.state.requests.filter(call => call.url.includes('first_air_date.gte')).length, 3);
});

test('newest caps fetching at five raw pages and shows at most 100 ranked unique cards', () => {
    const h = start({ respond(call) { raw(call,
        Array.from({ length: 20 }, (_, i) => card(call.params.page * 100 + i)), 900); } });
    assert.equal(read(h).output.total_results, 100);
    assert.equal(read(h, 3).output.results.length, 20);
    assert.equal(read(h, 3).output.total_pages, 3);
    assert.equal(h.state.requests.length, 5);
});

test('entirely rejected high-interest page continues fetching without making an empty first view', () => {
    const h = start({ respond(call) { raw(call, call.params.page === 1
        ? [card(1, { genre_ids: [16] })] : [card(2)], 2); } });
    assert.deepEqual(Array.from(read(h).output.results, c => c.id), [2]);
    assert.equal(h.state.requests.length, 2);
});

test('empty and below-cutoff upstream pages end shortlist without chasing unrelated pages', () => {
    for (const cards of [[], [card(1, { popularity: 2 })]]) {
        const h = start({ respond(call) { raw(call, cards, 900); } });
        const out = read(h).output;
        assert.equal(out.total_results, 0); assert.equal(out.total_pages, 0);
        assert.equal(h.state.requests.length, 1);
    }
});

test('simultaneous readers share fetching and receive independent copies', () => {
    const pending = [];
    const h = start({ respond(call) { pending.push(call); } });
    const a = read(h), b = read(h);
    assert.equal(pending.length, 1);
    raw(pending.shift(), [card(1)], 2);
    assert.equal(pending.length, 1);
    raw(pending.shift(), [card(2, { popularity: 9 })], 2);
    a.output.results[0].name = 'mutated';
    assert.equal(b.output.results[0].name, 'Drama 1');
    assert.equal(a.errors + b.errors, 0);
    assert.equal(h.state.requests.length, 2);
});

test('late upstream failure fails all readers and never saves a misleading partial shortlist', () => {
    let failure = true;
    const h = start({ respond(call) {
        if (failure && call.params.page === 2) return call.error();
        raw(call, [card(call.params.page)], 2);
    }});
    const first = read(h); assert.equal(first.output, undefined); assert.equal(first.errors, 1);
    failure = false;
    assert.deepEqual(Array.from(read(h).output.results, c => c.id), [1, 2]);
    assert.equal(h.state.requests.length, 4);
});

test('three-hour expiry refetches snapshot while route date and language separate cache entries', () => {
    const h = start({ respond(call) { raw(call, [card(1)]); } });
    read(h); h.state.now = '2026-10-01T19:29:59Z'; read(h);
    assert.equal(h.state.requests.length, 1);
    h.state.now = '2026-10-01T19:30:00Z'; read(h);
    assert.equal(h.state.requests.length, 2);
    read(h, 1, '2026-10-03'); assert.equal(h.state.requests.length, 3);
    h.lampa.Storage.field = () => 'en-US'; read(h, 1, '2026-10-03');
    assert.equal(h.state.requests.length, 4);
    assert.equal(h.state.requests.every(call => call.cache.life === 180), true);
});

test('snapshot freezes locale across asynchronous pages and freezes its original date window', () => {
    const pending = [];
    const h = start({ respond(call) { pending.push(call); } });
    const first = read(h);
    h.state.now = '2026-10-02T20:00:00Z'; h.lampa.Storage.field = () => 'en-US';
    raw(pending.shift(), [card(1)], 2); raw(pending.shift(), [card(2)], 2);
    assert.equal(first.output.total_results, 2);
    assert.equal(h.state.requests.every(call => call.params.language === 'uk-UA'), true);
    assert.equal(h.state.requests.every(call => new URL(call.url).searchParams.get('first_air_date.lte') === '2026-10-02'), true);
});

test('clear cancels pending readers and prevents late callbacks from repopulating snapshots', () => {
    const pending = [];
    const h = start({ respond(call) { pending.push(call); } });
    const old = read(h); h.state.source().clear(); const fresh = read(h);
    raw(pending.shift(), [card(1)]); assert.equal(old.output, undefined);
    raw(pending.shift(), [card(2)]); assert.equal(fresh.output.results[0].id, 2);
    assert.equal(read(h).output.results[0].id, 2); assert.equal(h.state.requests.length, 2);
});

test('English title fallback is per page, preserves candidates on failure, and does not refetch in More', () => {
    const h = start({ respond(call) {
        if (call.params.language === 'en-US') return call.error();
        raw(call, [card(1, { name: '새 드라마', original_name: '새 드라마' })]);
    }});
    assert.equal(read(h).output.results[0].name, '새 드라마');
    assert.equal(read(h).output.total_results, 1); assert.equal(h.state.requests.length, 2);
});

test('legacy get and list fallback use the same shortlist exclusions and precise pagination', () => {
    for (const listOnly of [false, true]) {
        const h = start({ catalog: false, respond(call) {
            raw(call, [card(1), card(2, { vote_count: 2 }), card(3, { first_air_date: '1999-01-01' })]);
        }});
        if (listOnly) delete h.lampa.Api.sources.tmdb.get;
        assert.deepEqual(Array.from(read(h).output.results, c => c.id), [1]);
        assert.equal(read(h, 2).output.results.length, 0);
        assert.equal(h.state.requests.length, 1);
    }
});
