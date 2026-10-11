'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers.cjs');
const defs = [
    ['studio_dragon', 'with_companies', '86418', 'KR', 'ko'],
    ['sll', 'with_companies', '164046|86981', 'KR', 'ko'],
    ['netflix', 'with_networks', '213', 'KR|CN|JP|TH|TW', null],
    ['studio_s', 'with_companies', '83914', 'KR', 'ko'],
    ['disney', 'with_networks', '2739', 'KR|CN|JP|TH|TW', null]
];
const card = (id, extra = {}) => ({ id, name: 'Drama ' + id, original_name: 'Drama ' + id,
    genre_ids: [18], origin_country: ['KR'], first_air_date: '2026-10-01',
    popularity: 30, vote_count: 0, ...extra });
function start(options) { const h = harness({ catalog: true, ...options }); h.state.run(); return h; }
function read(h, id, page = 1, day = '2026-10-02') {
    let result, errors = 0;
    h.state.source().list({ url: 'siaivo-dorama:' + day + ':' + id, page },
        data => { result = data; }, () => errors++);
    return { result, errors };
}
function reply(call, results, pages = 1) { call.ok({ page: call.params.page, results, total_pages: pages, total_results: pages * 20 }); }

test('brands use verified production or platform IDs and SLL legacy credits with OR', () => {
    for (const [id, field, value, countries, language] of defs) {
        const h = start({ respond(call) { reply(call, [card(1)]); } });
        assert.equal(read(h, id).result.results.length, 1);
        const q = new URL(h.state.requests[0].url).searchParams;
        assert.equal(q.get(field), value);
        assert.equal(q.get(field === 'with_companies' ? 'with_networks' : 'with_companies'), null,
            'a production company must not be intersected with an unrelated broadcaster');
        assert.equal(q.get('with_origin_country'), countries);
        assert.equal(q.get('with_original_language'), language);
        assert.equal(q.get('sort_by'), 'popularity.desc');
        assert.equal(q.get('first_air_date.lte'), '2026-10-02');
        assert.equal(q.get('include_null_first_air_dates'), 'false');
        for (const name of ['first_air_date.gte', 'first_air_date_year', 'vote_count.gte', 'vote_average.gte', 'with_status'])
            assert.equal(q.get(name), null, 'no forced freshness year, accumulated votes or rating order');
        assert.equal(h.state.requests[0].cache.life, 180);
    }
});

test('brand rows retain earlier and newly premiered hits in interest order while hiding future, undated, anime and foreign cards', () => {
    for (const [id] of defs) {
        const h = start({ respond(call) { reply(call, [
            card(1, { first_air_date: '2016-01-01', popularity: 90, vote_count: 1 }),
            card(2, { first_air_date: '2026-10-02', popularity: 80 }),
            card(3, { first_air_date: '2026-10-03', popularity: 70 }),
            card(4, { first_air_date: '', popularity: 60 }),
            card(5, { first_air_date: '2026-09-31' }), card(6, { genre_ids: [18, 16] }),
            card(7, { origin_country: ['US'] }), card(8, { genre_ids: [10764, 18] }),
            card(9, { origin_country: [] }), card(10, { origin_country: ['KR','US'], popularity: 10 })]); } });
        assert.deepEqual(Array.from(read(h, id).result.results, c => c.id), [1, 2, 10]);
    }
});

test('platforms mix all five drama countries without turning Studio S into the whole SBS catalog', () => {
    const cards = ['KR','CN','JP','TH','TW','US'].map((country,i) => card(i+1, { origin_country: [country] }));
    for (const id of ['netflix', 'disney', 'studio_s']) {
        const h = start({ respond(call) { reply(call, cards); } });
        assert.deepEqual(Array.from(read(h,id).result.results, c => c.id), id === 'studio_s' ? [1] : [1,2,3,4,5]);
    }
});

test('brand More shares raw row cache parameters, keeps 2:1 pagination and deduplicates co-production credits', () => {
    const h = start({ respond(call) { reply(call, Array.from({ length:20 }, (_,i)=>card(call.params.page*100+i)).concat([card(999)]), 5); } });
    let rows;
    const next = h.state.source().category({}, data => { rows=Array.from(data); }, assert.fail);
    next(data => rows.push(...data), assert.fail); // first brand arrives only in second batch
    const row = rows.find(row=>row.url.endsWith(':studio_dragon'));
    assert.ok(row); assert.equal(h.state.requests.filter(c=>c.url.includes('with_companies')).length,1);
    const rowCall = h.state.requests.find(c=>c.url.includes('with_companies'));
    const before = h.state.requests.length;
    const grid = read(h,'studio_dragon').result;
    assert.equal(h.state.requests[before].url,rowCall.url); assert.equal(h.state.requests[before].cache.life,rowCall.cache.life);
    assert.equal(grid.results.length,41); assert.equal(new Set(grid.results.map(c=>c.id)).size,41);
    assert.equal(grid.total_pages,3);
    const last=read(h,'studio_dragon',3).result;
    assert.equal(last.results.length,21);
    assert.equal(new URL(h.state.requests.at(-1).url).searchParams.get('page'),'5');
    const page2=read(h,'studio_dragon',2).result;
    assert.equal(page2.results[0].id,300);
});

test('brand date remains pinned over midnight but a new route admits the next premiere', () => {
    const h = start({ respond(call) { reply(call,[card(1,{first_air_date:'2026-10-03'})]); } });
    assert.equal(read(h,'netflix').result.results.length,0);
    h.state.now='2026-10-02T20:00:00Z';
    assert.equal(read(h,'netflix',1,'2026-10-02').result.results.length,0);
    assert.equal(read(h,'netflix',1,'2026-10-03').result.results.length,1);
    assert.equal(new URL(h.state.requests[0].url).searchParams.get('first_air_date.lte'),'2026-10-02');
});

test('brand translation is bounded to one English page and failed primary pages fail the complete view', () => {
    const h = start({ respond(call) {
        reply(call,[card(call.params.page,{name:call.params.language==='en-US'?'English name':'새 드라마'})],2);
    }});
    assert.equal(read(h,'sll').result.results[0].name,'English name');
    assert.equal(h.state.requests.length,4);
    const failure = start({ respond(call) { call.params.page===2?call.error():reply(call,[card(1)],2); } });
    const out=read(failure,'sll'); assert.equal(out.result,undefined); assert.equal(out.errors,1);
});

test('legacy rows and grids apply brand date/country/fiction gates and keep brand query IDs', () => {
    for(const listOnly of [false,true]) {
        const h=start({catalog:false,respond(call){reply(call,[card(1),card(2,{first_air_date:'2099-01-01'}),card(3,{origin_country:['US']})]);}});
        if(listOnly) delete h.lampa.Api.sources.tmdb.get;
        let rows; const next=h.state.source().category({},data=>{rows=Array.from(data);},assert.fail);
        next(data=>rows.push(...data),assert.fail);
        assert.deepEqual(Array.from(rows.find(row=>row.url.endsWith(':studio_dragon')).results,c=>c.id),[1]);
        assert.deepEqual(Array.from(read(h,'studio_dragon').result.results,c=>c.id),[1]);
        assert.equal(new URL('https://fixture.test/'+h.state.requests.at(-1).url).searchParams.get('with_companies'),'86418');
    }
});
