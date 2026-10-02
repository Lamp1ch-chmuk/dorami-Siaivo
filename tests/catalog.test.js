'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers.cjs');
const route = 'siaivo-dorama:2026-10-02:kr_recent_episodes';

function load(h, page = 1, url = route) {
    h.state.run();
    let output, errors = 0;
    h.state.source().list({ url, page }, data => { output = data; }, () => errors++);
    return { output, errors };
}
const result = (page, cards, pages = 8) => ({ page, total_pages: pages, total_results: pages * 20, results: cards.map(card => card && !Array.isArray(card) ? { genre_ids: [18], first_air_date: '2024-01-01', vote_count: 200, origin_country: ['KR'], ...card } : card) });

test('curated catalog retains fresh zero-vote, daily Soap, and untranslated dramas', () => {
    const h = harness({ catalog: true, respond(call) {
        call.ok(result(call.params.page, [{ id: call.params.page, name: '새 드라마', original_name: '새 드라마',
            genre_ids: [18, 10766], vote_count: 0, first_air_date: '2026-10-01' }]));
    } });
    const { output, errors } = load(h);
    assert.equal(errors, 0);
    assert.equal(output.results.length, 2);
    assert.equal(output.results[0].name, '새 드라마', 'missing English must not remove the card');
    assert.ok(h.state.requests.every(r => r.kind === 'catalog'));
    assert.equal(h.state.requests.length, 4, 'two primary pages and at most two English fallbacks');
});

test('English titles join by ID, preserving local titles, original names, order, and frozen cache', () => {
    const raw = Object.freeze(result(1, Object.freeze([
        Object.freeze({ id: 42, name: '새 드라마', original_name: '원본' }),
        Object.freeze({ id: 43, name: 'Українська назва', original_name: '원본' })
    ]), 1));
    raw.results.forEach(Object.freeze);
    Object.freeze(raw.results);
    const h = harness({ catalog: true, respond(call) {
        call.ok(call.params.language === 'en-US' ? result(1, [
            { id: 43, name: 'Keep Ukrainian' }, { id: 99, name: 'Unrelated' }, { id: 42, name: 'New Drama' }
        ], 1) : raw);
    } });
    const { output } = load(h);
    assert.deepEqual(Array.from(output.results, c => [c.id, c.name, c.original_name, c.source]),
        [[42, 'New Drama', '원본', 'tmdb'], [43, 'Українська назва', '원본', 'tmdb']]);
    assert.equal(raw.results[0].name, '새 드라마');
    assert.equal(output.total_pages, 1);
});

test('readable catalog pages need no translation request; English failure preserves cards', () => {
    for (const name of ['Українська назва', 'Test Drama', '새 드라마']) {
        const h = harness({ catalog: true, respond(call) {
            if (call.params.language === 'en-US') return call.error();
            call.ok(result(1, [{ id: 42, name }], 1));
        } });
        const { output, errors } = load(h);
        assert.equal(errors, 0);
        assert.equal(output.results[0].name, name);
        assert.equal(h.state.requests.length, name === '새 드라마' ? 2 : 1);
    }
});

test('English locale never triggers a duplicate translation request', () => {
    const h = harness({ catalog: true, language: 'en-US', respond(call) {
        call.ok(result(1, [{ id: 1, name: '새 드라마' }], 1));
    } });
    assert.equal(load(h).output.results.length, 1);
    assert.equal(h.state.requests.length, 1);
});

test('grid mapping is fixed 2:1, ordered, deduplicated, and capped to TMDB 500 pages', () => {
    const h = harness({ catalog: true, respond(call) {
        call.ok(result(call.params.page, [{ id: call.params.page, name: 'Drama' }, { id: 10, name: 'Duplicate' }], 1001));
    } });
    const { output } = load(h, 2);
    assert.deepEqual(h.state.requests.map(c => c.params.page), [3, 4]);
    assert.deepEqual(Array.from(output.results, c => c.id), [3, 10, 4]);
    assert.equal(output.page, 2);
    assert.equal(output.total_pages, 250);
    assert.equal(output.url, route);
});

test('last odd page stops at catalog end; empty catalog preserves zero totals', () => {
    for (const total of [0, 3]) {
        const h = harness({ catalog: true, respond(call) { call.ok(result(call.params.page, [], total)); } });
        const { output } = load(h, total ? 2 : 1);
        assert.equal(h.state.requests.length, 1);
        assert.equal(output.total_pages, Math.ceil(total / 2));
        assert.equal(output.results.length, 0);
    }
});

test('first or second primary page failure reports error without silently losing half a grid', () => {
    for (const failed of [1, 2]) {
        const h = harness({ catalog: true, respond(call) {
            if (call.params.page === failed) return call.error();
            call.ok(result(call.params.page, [{ id: call.params.page, name: 'Drama' }]));
        } });
        const { output, errors } = load(h);
        assert.equal(output, undefined);
        assert.equal(errors, 1);
        assert.equal(h.state.requests.length, failed);
    }
});

test('invalid catalog responses fail; malformed, adult, and animated cards never render', () => {
    const invalid = harness({ catalog: true, respond(call) { call.ok({ results: {} }); } });
    assert.equal(load(invalid).errors, 1);
    const h = harness({ catalog: true, respond(call) {
        call.ok(result(1, [null, [], {}, { id: 1, name: 'Adult', adult: true },
            { id: 2, name: 'Anime', genre_ids: [16] }, { id: 4, name: 'Reality', genre_ids: [10764] }, { id: 3, original_name: 'Drama' }, { id: 5, name: 'Broken genres', genre_ids: {} }], 1));
    } });
    assert.deepEqual(Array.from(load(h).output.results, c => c.id), [3]);
});

test('rows and grid share section TTL, native proxy/key, language and date filters', () => {
    const h = harness({ catalog: true });
    h.state.run();
    let rows;
    h.state.source().category({}, data => { rows = data; }, assert.fail);
    assert.equal(h.state.requests.length, 4);
    assert.deepEqual(h.state.requests.map(c => c.cache.life), [720, 120, 120, 720]);
    for (const row of rows) {
        const before = h.state.requests.length;
        h.state.source().list({ url: row.url, page: 1 }, () => {}, assert.fail);
        assert.equal(h.state.requests[before].url, h.state.requests[rows.indexOf(row)].url);
        assert.equal(h.state.requests[before].cache.life, h.state.requests[rows.indexOf(row)].cache.life);
        const url = new URL(h.state.requests[before].url);
        assert.equal(url.host, 'tmdb-proxy.test');
        assert.equal(url.searchParams.get('api_key'), 'fixture');
        assert.equal(url.searchParams.get('language'), 'uk-UA');
    }
    assert.equal(h.state.timeout, 10000);
    h.state.source().clear();
    assert.equal(h.state.cleared, 1);
});

test('native catalog path retains lazy ordering and KST date over device midnight', () => {
    const h = harness({ catalog: true });
    h.state.run();
    let rows;
    const next = h.state.source().category({}, data => { rows = data; }, assert.fail);
    const all = Array.from(rows);
    while (all.length < 14) next(more => all.push(...more), assert.fail);
    assert.equal(h.state.requests.length, 14, 'all fourteen sections remain lazy and reachable');
    assert.equal(h.state.requests[4].cache.life, 4320);
    assert.equal(h.state.requests[5].cache.life, 1440);
    assert.ok(all.every(row => row.source === 'plugin_siaivo_dorama' && row.results[0].source === 'tmdb'));
    h.state.now = '2026-10-02T16:30:00Z';
    h.state.source().list({ url: rows[1].url, page: 2 }, () => {}, assert.fail);
    assert.equal(new URL(h.state.requests.at(-1).url).searchParams.get('air_date.lte'), '2026-10-02');
});
