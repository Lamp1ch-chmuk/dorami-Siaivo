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

test('popular catalogs retain old, new, undated and zero-vote live dramas in upstream interest order', () => {
    for (const id of ['kr_popular', 'jp_popular', 'th_popular', 'cn_popular', 'tw_popular', 'lgbt']) {
        const h = fixture([card(1, { first_air_date: '2005-01-01', popularity: 100, vote_count: 0 }),
            card(2, { first_air_date: '2026-01-01', popularity: 90, vote_count: 10000 }),
            card(3, { first_air_date: '2015-01-01', popularity: 80 }),
            card(4, { first_air_date: '1965-01-01', popularity: 70 }),
            card(5, { first_air_date: '', popularity: 60, vote_count: 1 })]);
        assert.deepEqual(Array.from(page(h, id).output.results, c => c.id), [1, 2, 3, 4, 5]);
        const query = new URL(h.state.requests[0].url).searchParams;
        assert.equal(query.get('sort_by'), 'popularity.desc');
        assert.equal(query.get('include_null_first_air_dates'), 'true');
        for (const name of ['first_air_date.gte', 'first_air_date.lte', 'first_air_date_year',
            'air_date.gte', 'air_date.lte', 'vote_count.gte', 'vote_average.gte', 'with_status', 'with_networks']) {
            assert.equal(query.get(name), null, 'no release-date or accumulated-vote gates');
        }
    }
});

test('five countries, one popular-newest and one LGBT row remain lazy with targeted TTL', () => {
    const h = harness({ catalog: true }); h.state.run();
    let rows;
    const next = h.state.source().category({}, data => { rows = Array.from(data); }, assert.fail);
    assert.equal(rows.length, 4); assert.equal(h.state.requests.length, 4);
    next(data => rows.push(...data), assert.fail);
    assert.deepEqual(rows.map(row => row.url.split(':').pop()),
        ['kr_popular', 'cn_popular', 'jp_popular', 'th_popular', 'tw_popular', 'new_popular', 'lgbt']);
    assert.deepEqual(h.state.requests.map(call => call.cache.life), [360, 360, 360, 360, 360, 180, 360]);
    assert.equal(new URL(h.state.requests[4].url).searchParams.get('with_origin_country'), 'TW');
    assert.equal(new URL(h.state.requests[4].url).searchParams.get('with_original_language'), 'zh');
});

test('one LGBT catalog mixes Asian countries with verified BL/GL/romance tags and no vote floor', () => {
    const countries = ['KR', 'JP', 'TH', 'CN', 'TW', 'HK', 'PH', 'VN', 'SG'];
    const h = fixture(countries.map((country, i) => card(i + 1, { origin_country: [country], vote_count: 5 }))
        .concat([card(90, { origin_country: ['US'] }), card(91, { origin_country: [] }),
            card(92, { vote_count: 0 }), card(93, { genre_ids: [10764] })]));
    const { output } = page(h, 'lgbt');
    assert.deepEqual(Array.from(output.results, c => c.id), countries.map((_, i) => i + 1).concat([92]));
    const query = new URL(h.state.requests[0].url).searchParams;
    assert.equal(query.get('with_origin_country'), countries.join('|'));
    assert.equal(query.get('with_original_language'), null, 'one language must not discard other Asian countries');
    assert.equal(query.get('vote_count.gte'), null);
    assert.equal(query.get('sort_by'), 'popularity.desc');
    for (const keyword of ['289844', '280003', '240305', '319872', '351185']) {
        assert.ok(query.get('with_keywords').split('|').includes(keyword));
    }
    const category = harness({ catalog: true });
    category.state.run();
    let rows;
    const next = category.state.source().category({}, data => { rows = Array.from(data); }, assert.fail);
    while (rows.length < 7) next(data => rows.push(...data), assert.fail);
    assert.equal(rows.filter(row => /lgbt/.test(row.url)).length, 1);
    assert.equal(rows.some(row => /kr_new/.test(row.url)), false);
});

test('animation, mapped anime, children and nonfiction are filtered before translation without excluding live Japanese actors', () => {
    const h = fixture([card(1), card(2, { genre_ids: [18, 16], name: 'アニメ' }),
        card(3, { name: 'アニメ' }), card(4, { mal_id: 100 }), card(5, { genre_ids: [10762, 10759] }),
        card(6, { genre_ids: [18, 10764] }), card(7, { genre_ids: [] }), card(8, { genre_ids: [99] }), card(9, { adult: true }), ...[67192, 121651, 5822, 108112, 19530].map(id => card(id)),
        card(201736, { genre_ids: [35], name: 'Actual campus romantic comedy' })]);
    h.lampa.Utils = { isAnime(probe) { return probe.id === 3 || probe.original_language === 'ja'; } };
    assert.deepEqual(Array.from(page(h, 'jp_popular').output.results, c => c.id), [1, 201736]);
    assert.equal(h.state.requests.length, 1, 'rejected untranslated anime needs no English request');
    const query = new URL(h.state.requests[0].url).searchParams;
    assert.equal(query.get('without_keywords'), '210024,317204,194610,191498,300454', 'exclude anime, tokusatsu and misclassified show categories on the server too');
    assert.ok(query.get('without_genres').split(',').includes('16'));
});

test('missing or incompatible native anime helpers preserve live dramas and genre exclusions', () => {
    for (const helper of [undefined, () => { throw Error('Unavailable'); }]) {
        const h = fixture([card(1), card(2, { genre_ids: [16] })]);
        h.lampa.Utils = { isAnime: helper };
        assert.deepEqual(Array.from(page(h, 'jp_popular').output.results, c => c.id), [1]);
    }
});

test('legacy row and grid paths also keep old dramas and exclude anime', () => {
    const h = fixture([card(1), card(2, { first_air_date: '1965-01-01' }), card(3, { genre_ids: [16] })], false);
    assert.deepEqual(Array.from(page(h, 'kr_popular').output.results, c => c.id), [1, 2]);
    let rows;
    h.state.source().category({}, data => { rows = data; }, assert.fail);
    assert.deepEqual(Array.from(rows[0].results, c => c.id), [1, 2]);
});

test('all removed routes fail once without fetching or redirecting into another catalog', () => {
    for (const id of ['kr_new', 'kr_recent_episodes', 'kr_ongoing', 'kr_top', 'kr_comedy',
        'kr_mystery', 'kr_fantasy', 'kr_netflix', 'kr_tvn', 'kr_jtbc']) {
        const h = fixture([card(1)]);
        assert.deepEqual(page(h, id), { output: undefined, errors: 1 });
        assert.equal(h.state.requests.length, 0);
    }
});
