'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers.cjs');
const card = (id, extra = {}) => ({ id, name: 'Drama ' + id, genre_ids: [18], origin_country: ['JP'],
    original_language: 'ja', first_air_date: '2024-01-01', vote_count: 10, ...extra });
function page(h, id) {
    let output, errors = 0;
    h.state.source().list({ url: 'siaivo-dorama:2026-10-02:' + id }, value => { output = value; }, () => errors++);
    return { output, errors };
}
function fixture(cards, catalog = true) {
    const h = harness({ catalog, respond(call) { call.ok({ page: 1, total_pages: 1, results: cards }); } });
    h.state.run(); return h;
}

test('balanced catalogs keep popular 2015–2020 dramas and reject archaic, future and unproven entries', () => {
    for (const id of ['kr_popular', 'jp_popular', 'th_popular', 'cn_popular', 'kr_comedy', 'kr_netflix', 'kr_tvn', 'kr_jtbc']) {
        const h = fixture([card(1, { first_air_date: '2015-01-01' }), card(2, { first_air_date: '2020-06-01' }),
            card(3, { first_air_date: '2026-10-02' }), card(4, { first_air_date: '2014-12-31', vote_count: 2000 }),
            card(5, { first_air_date: '1965-01-01' }), card(6, { first_air_date: '2026-10-03' }),
            card(7, { vote_count: 9 }), card(8, { first_air_date: '' }), card(9, { vote_count: 'broken' })]);
        assert.deepEqual(Array.from(page(h, id).output.results, c => c.id), [1, 2, 3]);
        const query = new URL(h.state.requests[0].url).searchParams;
        assert.equal(query.get('first_air_date.gte'), '2015-01-01');
        assert.equal(query.get('first_air_date.lte'), '2026-10-02');
        assert.equal(query.get('sort_by'), 'popularity.desc');
        assert.equal(query.get('vote_count.gte'), '10');
    }
});

test('airing catalogs retain fresh zero-vote daily dramas without the popular vote floor', () => {
    for (const id of ['kr_ongoing', 'kr_recent_episodes']) {
        const h = fixture([card(1, { first_air_date: '2026-10-01', vote_count: 0, genre_ids: [18, 10766] })]);
        assert.equal(page(h, id).output.results.length, 1);
        const query = new URL(h.state.requests[0].url).searchParams;
        assert.equal(query.get('vote_count.gte'), null);
        assert.equal(query.get('first_air_date.gte'), null);
    }
});

test('one LGBT catalog mixes Asian countries with verified BL/GL/romance tags and a modest vote floor', () => {
    const countries = ['KR', 'JP', 'TH', 'CN', 'TW', 'HK', 'PH', 'VN', 'SG'];
    const h = fixture(countries.map((country, i) => card(i + 1, { origin_country: [country], vote_count: 5 }))
        .concat([card(90, { origin_country: ['US'] }), card(91, { origin_country: [] }),
            card(92, { vote_count: 4 }), card(93, { genre_ids: [10764] })]));
    const { output } = page(h, 'lgbt');
    assert.deepEqual(Array.from(output.results, c => c.id), countries.map((_, i) => i + 1));
    const query = new URL(h.state.requests[0].url).searchParams;
    assert.equal(query.get('with_origin_country'), countries.join('|'));
    assert.equal(query.get('with_original_language'), null, 'one language must not discard other Asian countries');
    assert.equal(query.get('vote_count.gte'), '5');
    assert.equal(query.get('sort_by'), 'popularity.desc');
    for (const keyword of ['289844', '280003', '240305', '319872', '351185']) {
        assert.ok(query.get('with_keywords').split('|').includes(keyword));
    }
    const category = harness({ catalog: true });
    category.state.run();
    let rows;
    const next = category.state.source().category({}, data => { rows = Array.from(data); }, assert.fail);
    while (rows.length < 14) next(data => rows.push(...data), assert.fail);
    assert.equal(rows.filter(row => /lgbt/.test(row.url)).length, 1);
    assert.equal(rows.some(row => /kr_new/.test(row.url)), false);
});

test('animation, mapped anime, children and nonfiction are filtered before translation without excluding live Japanese actors', () => {
    const h = fixture([card(1), card(2, { genre_ids: [18, 16], name: 'アニメ' }),
        card(3, { name: 'アニメ' }), card(4, { mal_id: 100 }), card(5, { genre_ids: [10762, 10759] }),
        card(6, { genre_ids: [18, 10764] }), card(7, { genre_ids: [] }), card(8, { genre_ids: [99] }), card(9, { adult: true })]);
    h.lampa.Utils = { isAnime(probe) { return probe.id === 3 || probe.original_language === 'ja'; } };
    assert.deepEqual(Array.from(page(h, 'jp_popular').output.results, c => c.id), [1]);
    assert.equal(h.state.requests.length, 1, 'rejected untranslated anime needs no English request');
    const query = new URL(h.state.requests[0].url).searchParams;
    assert.equal(query.get('without_keywords'), '210024,317204', 'exclude anime and tokusatsu on the server too');
    assert.ok(query.get('without_genres').split(',').includes('16'));
});

test('missing or incompatible native anime helpers preserve live dramas and genre exclusions', () => {
    for (const helper of [undefined, () => { throw Error('Unavailable'); }]) {
        const h = fixture([card(1), card(2, { genre_ids: [16] })]);
        h.lampa.Utils = { isAnime: helper };
        assert.deepEqual(Array.from(page(h, 'jp_popular').output.results, c => c.id), [1]);
    }
});

test('legacy row and grid paths apply the same age and anime exclusions', () => {
    const h = fixture([card(1), card(2, { first_air_date: '1965-01-01' }), card(3, { genre_ids: [16] })], false);
    assert.deepEqual(Array.from(page(h, 'kr_popular').output.results, c => c.id), [1]);
    let rows;
    h.state.source().category({}, data => { rows = data; }, assert.fail);
    assert.deepEqual(Array.from(rows[0].results, c => c.id), [1]);
});

test('removed premiere route fails once without fetching or silently opening another catalog', () => {
    const h = fixture([card(1)]);
    assert.deepEqual(page(h, 'kr_new'), { output: undefined, errors: 1 });
    assert.equal(h.state.requests.length, 0);
});
