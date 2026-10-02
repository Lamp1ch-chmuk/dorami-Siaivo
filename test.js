'use strict';

var fs = require('fs');
var vm = require('vm');
var assert = require('assert');

var menuItems = [];
var listeners = {};
var routerCalls = [];
var rowCalls = [];
var listCalls = [];
var rawRowResponses = [];

/*
 * Fixed instant intentionally sits across the Korea/day boundary:
 * 2026-10-01 16:30 UTC = 2026-10-02 01:30 in Seoul.
 * The plugin must anchor Korean date-sensitive rows to 2026-10-02 regardless
 * of the machine running this test.
 */
var RealDate = Date;
var FIXED_NOW = '2026-10-01T16:30:00Z';
function TestDate() {
    var args = Array.prototype.slice.call(arguments);

    if (!(this instanceof TestDate)) return RealDate.apply(null, args);
    if (!args.length) return new RealDate(FIXED_NOW);

    switch (args.length) {
        case 1: return new RealDate(args[0]);
        case 2: return new RealDate(args[0], args[1]);
        case 3: return new RealDate(args[0], args[1], args[2]);
        case 4: return new RealDate(args[0], args[1], args[2], args[3]);
        case 5: return new RealDate(args[0], args[1], args[2], args[3], args[4]);
        case 6: return new RealDate(args[0], args[1], args[2], args[3], args[4], args[5]);
        default: return new RealDate(args[0], args[1], args[2], args[3], args[4], args[5], args[6]);
    }
}
TestDate.prototype = RealDate.prototype;
TestDate.UTC = RealDate.UTC;
TestDate.parse = RealDate.parse;
TestDate.now = function () { return new RealDate(FIXED_NOW).getTime(); };

function Button(title, action) {
    this.title = title;
    this.action = action;
    this.attrs = {};
    this.length = 1;
}
Button.prototype.attr = function (name, value) {
    if (arguments.length === 1) return this.attrs[name];
    this.attrs[name] = value;
    return this;
};
Button.prototype.first = function () { return this; };

var empty = {
    length: 0,
    first: function () { return this; }
};

var menuRoot = {
    find: function (selector) {
        var match = selector.match(/^\[data-action="([^"]+)"\]$/);
        if (!match) return empty;
        var action = match[1];
        var item = menuItems.filter(function (x) {
            return x.attrs['data-action'] === action;
        })[0];
        return item || empty;
    }
};

function emit(name, event) {
    (listeners[name] || []).forEach(function (fn) { fn(event); });
}

/* Mirrors current Lampa Api.partNext behavior for plugin regression tests. */
function partNext(parts, limit, loaded, emptyCb) {
    var pieces = parts.filter(function (p) { return typeof p === 'function'; }).slice(0, limit);
    if (!pieces.length) return emptyCb();

    var results = new Array(pieces.length);
    var pending = pieces.length;

    pieces.forEach(function (fn, index) {
        try {
            fn(function (result) {
                results[index] = result;
                pending--;
                if (!pending) finish();
            });
        } catch (e) {
            pending--;
            if (!pending) finish();
        }
    });

    function finish() {
        var data = results.filter(function (r) { return r && r.results && r.results.length; });
        pieces.forEach(function (piece) { parts[parts.indexOf(piece)] = false; });

        if (data.length) {
            if (data.length < 3) {
                partNext(parts, limit, function (more) { loaded(data.concat(more)); }, function () { loaded(data); });
            } else loaded(data);
        } else partNext(parts, limit, loaded, emptyCb);
    }
}

function queryParams(url) {
    var result = {};
    var q = String(url || '').split('?')[1] || '';
    q.split('&').forEach(function (pair) {
        var p;
        if (!pair) return;
        p = pair.split('=');
        result[decodeURIComponent(p[0])] = decodeURIComponent(p.slice(1).join('='));
    });
    return result;
}

var Lampa = {
    Manifest: { app_version: '3.3.4.29', app_digital: 33429 },
    /* Deliberately Russian to verify that menu identity stays stable. */
    Lang: {
        selected: function (langs) { return langs.indexOf('ru') >= 0; }
    },
    Api: {
        sources: {
            tmdb: {
                get: function (url, params, ok, err, cache) {
                    var raw = {
                        results: [{ id: rowCalls.length + 1, name: 'Drama ' + (rowCalls.length + 1), source: 'tmdb', genre_ids: [18], first_air_date: '2024-01-01', vote_count: 200, origin_country: ['KR'] }],
                        page: 1,
                        total_pages: 9,
                        total_results: 180,
                        source: 'tmdb',
                        url: url
                    };
                    rowCalls.push({ url: url, params: params, cache: cache });
                    rawRowResponses.push(raw);
                    ok(raw);
                }
            }
        },
        partNext: partNext,
        list: function (params, ok) {
            listCalls.push(params);
            ok({
                results: [{ id: 999, name: 'Page card', source: 'tmdb', genre_ids: [18], first_air_date: '2024-01-01', vote_count: 200, origin_country: ['KR'] }],
                page: params.page,
                total_pages: 4,
                total_results: 80,
                source: 'tmdb',
                url: params.url
            });
        }
    },
    Menu: {
        render: function () { return menuRoot; },
        addButton: function (icon, title, action) {
            var button = new Button(title, action);
            menuItems.push(button);
            return button;
        }
    },
    Router: {
        call: function (name, data) {
            routerCalls.push({ name: name, data: data });
        }
    },
    Listener: {
        follow: function (name, fn) {
            if (!listeners[name]) listeners[name] = [];
            listeners[name].push(fn);
        }
    }
};

var context = {
    window: {
        appready: true,
        Lampa: Lampa,
        console: console
    },
    Lampa: Lampa,
    console: console,
    setTimeout: function (fn) { fn(); },
    clearTimeout: function () {},
    Date: TestDate,
    encodeURIComponent: encodeURIComponent,
    Object: Object,
    Array: Array,
    String: String,
    parseInt: parseInt
};
context.window.window = context.window;

var code = fs.readFileSync(__dirname + '/siaivo-dorama.js', 'utf8');

/* Known invalid/legacy patterns must not return. */
assert.strictEqual(code.indexOf("sort_by: 'air_date.desc'"), -1, 'unsupported air_date sort must not be used');
assert.strictEqual(code.indexOf("with_genres: '10749'"), -1, 'movie-only Romance genre must not be used for TV discover');
assert.strictEqual(code.indexOf('Lampa.Interaction'), -1, 'deprecated Interaction API must not be used');
assert.strictEqual(code.indexOf('Lampa.ContentRows'), -1, 'plugin must not inject home/category ContentRows');
assert.strictEqual(code.indexOf('Lampa.Activity'), -1, 'plugin should use Router rather than patching/directly pushing Activity');
assert.strictEqual(/Lampa\.Storage\.(set|remove|clear)\s*\(/.test(code), false, 'plugin must not mutate Siaivo menu/storage state');
assert.strictEqual(code.indexOf('Lampa.Lang'), -1, 'menu title must not change with UI language');
assert.strictEqual(code.indexOf('.apply(console'), -1, 'console host methods must not depend on Function.apply');

/* Keep plugin source compatible with older TV WebViews: ES5-style author code. */
assert.strictEqual(/=>/.test(code), false, 'arrow functions must not be used');
assert.strictEqual(/(^|[^A-Za-z0-9_$])(let|const)\s+[A-Za-z_$]/m.test(code), false, 'let/const must not be used');
assert.strictEqual(/\basync\s+function\b|\bPromise\b|\bfetch\s*\(/.test(code), false, 'modern async/fetch primitives must not be required');

vm.runInNewContext(code, context, { filename: 'siaivo-dorama.js' });

assert.ok(Lampa.Api.sources.plugin_siaivo_dorama, 'namespaced custom source must be registered');
assert.strictEqual(menuItems.length, 1, 'exactly one menu button must be added');
assert.strictEqual(menuItems[0].title, 'Дорами', 'menu title must stay stable even in Russian UI');
assert.strictEqual(menuItems[0].attrs['data-action'], 'plugin_siaivo_dorama');
assert.strictEqual(menuItems[0].attrs['data-plugin'], 'siaivo_dorama');

menuItems[0].action();
assert.strictEqual(routerCalls.length, 1);
assert.strictEqual(routerCalls[0].name, 'category');
assert.strictEqual(routerCalls[0].data.source, 'plugin_siaivo_dorama');
assert.strictEqual(routerCalls[0].data.url, 'siaivo-dorama');
assert.strictEqual(routerCalls[0].data.title, 'Дорами');

emit('menu', { type: 'start', body: menuRoot });
assert.strictEqual(menuItems.length, 1, 'menu entry must not duplicate');

var source = Lampa.Api.sources.plugin_siaivo_dorama;
var allRows = [];
var batch;
var exhausted = false;
var nextLoader = source.category({}, function (rows) {
    batch = rows;
    allRows = allRows.concat(rows);
}, function () {
    throw new Error('first category batch unexpectedly empty');
});

assert.strictEqual(typeof nextLoader, 'function', 'category must return lazy loader');
assert.strictEqual(rowCalls.length, 4, 'initial category load must fetch only 4 rows');
assert.strictEqual(listCalls.length, 0, 'initial rows must not use category_full list path');
assert.strictEqual(batch.length, 4);

/* Load the remaining lazy batches: 4 + 4 + 4 + 2 = 14 sections. */
while (!exhausted && allRows.length < 14) {
    batch = null;
    nextLoader(function (rows) {
        batch = rows;
        allRows = allRows.concat(rows);
    }, function () {
        exhausted = true;
    });
    if (!batch && !exhausted) throw new Error('lazy loader neither loaded nor exhausted');
}

assert.strictEqual(allRows.length, 14, 'all configured dorama sections must be reachable');
assert.strictEqual(rowCalls.length, 14, 'all 14 rows should require one first-page TMDB request each');

assert.ok(/^siaivo-dorama:2026-10-02:/.test(allRows[0].url), 'route anchor must use the Seoul calendar date, not device-local date');

var seenRoutes = {};
var allowedSorts = {
    'first_air_date.asc': true,
    'first_air_date.desc': true,
    'name.asc': true,
    'name.desc': true,
    'original_name.asc': true,
    'original_name.desc': true,
    'popularity.asc': true,
    'popularity.desc': true,
    'vote_average.asc': true,
    'vote_average.desc': true,
    'vote_count.asc': true,
    'vote_count.desc': true
};

allRows.forEach(function (row, index) {
    var params = queryParams(rowCalls[index].url);

    assert.strictEqual(row.source, 'plugin_siaivo_dorama', 'row route source must remain custom');
    assert.ok(/^siaivo-dorama:\d{4}-\d{2}-\d{2}:[a-z0-9_]+$/.test(row.url), 'row must use a stable dated custom route');
    assert.strictEqual(seenRoutes[row.url], undefined, 'section routes must be unique');
    seenRoutes[row.url] = true;

    assert.strictEqual(row.results[0].source, 'tmdb', 'card source must remain TMDB');
    assert.strictEqual(rowCalls[index].url.indexOf('discover/tv?'), 0, 'all rows must use TMDB Discover TV');
    assert.strictEqual(params.include_adult, 'false');
    assert.strictEqual(params.include_null_first_air_dates, 'false');
    assert.strictEqual(!!allowedSorts[params.sort_by], true, 'sort_by must be a documented Discover TV sort');

    /* Important: plugin row metadata must not poison TMDB/Request cached object. */
    assert.strictEqual(rawRowResponses[index].source, 'tmdb');
    assert.ok(rawRowResponses[index].url.indexOf('discover/tv?') === 0);
    assert.strictEqual(rawRowResponses[index].title, undefined);
    assert.notStrictEqual(row, rawRowResponses[index]);
    assert.notStrictEqual(row.results, rawRowResponses[index].results);
});

assert.strictEqual(rowCalls[0].cache.life, 60 * 12, 'popular row should use a shorter freshness-aware cache');
assert.strictEqual(rowCalls[1].cache.life, 60 * 2, 'recent episodes should refresh frequently');
assert.strictEqual(rowCalls[2].cache.life, 60 * 2, 'ongoing row should refresh frequently');

var recentParams = queryParams(rowCalls[1].url);
var ongoingParams = queryParams(rowCalls[2].url);
assert.strictEqual(recentParams.timezone, 'Asia/Seoul', 'episode air-date filters should use Korean broadcast timezone');
assert.strictEqual(recentParams['air_date.lte'], '2026-10-02', 'recent episodes must use the Seoul calendar day');
assert.strictEqual(ongoingParams.timezone, 'Asia/Seoul', 'ongoing air-date filters should use Korean broadcast timezone');
assert.strictEqual(ongoingParams.with_status, '0|2', 'ongoing row must use active production statuses');
assert.ok(ongoingParams['air_date.gte'] && ongoingParams['air_date.lte'], 'ongoing row must also use an airing-date window');
assert.strictEqual(queryParams(rowCalls[0].url).timezone, undefined, 'timezone is unnecessary for rows without air_date filters');

/* Broad fiction OR includes crime and comedy without forcing Drama genre 18. */
assert.strictEqual(queryParams(rowCalls[0].url).with_type, '2|4', 'base dorama filter must include miniseries|scripted');
assert.strictEqual(queryParams(rowCalls[0].url).without_genres, '16,99,10762,10763,10764,10767', 'base dorama filter should exclude non-fiction and animation');
assert.strictEqual(queryParams(rowCalls[0].url).with_genres, '18|35|80|9648|10759|10765|10751|10766|10768', 'base dorama filter should cover fiction genres');

/* Pagination: dated custom route -> public Api.list(TMDb) -> custom route, native cards. */
var pageResult;
var rowRoute = allRows[1].url;
var routeDate = rowRoute.match(/^siaivo-dorama:(\d{4}-\d{2}-\d{2}):/)[1];
source.list({ url: rowRoute, page: 2 }, function (data) { pageResult = data; }, function () {
    throw new Error('pagination unexpectedly failed');
});
assert.strictEqual(listCalls.length, 1);
assert.strictEqual(listCalls[0].source, 'tmdb');
assert.strictEqual(listCalls[0].page, 2);
assert.ok(listCalls[0].url.indexOf('discover/tv?') === 0);
assert.strictEqual(queryParams(listCalls[0].url)['air_date.lte'], routeDate, 'pagination must reconstruct query from route anchor date');
assert.strictEqual(queryParams(listCalls[0].url).timezone, 'Asia/Seoul', 'pagination must preserve Korean timezone');
assert.strictEqual(pageResult.source, 'plugin_siaivo_dorama');
assert.strictEqual(pageResult.page, 2);
assert.strictEqual(pageResult.results[0].source, 'tmdb');

/* Defensive page normalization. */
var clampedResult;
source.list({ url: allRows[0].url, page: -5 }, function (data) { clampedResult = data; }, function () {
    throw new Error('clamped pagination unexpectedly failed');
});
assert.strictEqual(listCalls[1].page, 1, 'negative pages must be clamped to page 1');
assert.strictEqual(clampedResult.page, 1);

var invalidErrored = false;
source.list({ url: 'bad-route', page: 1 }, function () {}, function () { invalidErrored = true; });
assert.strictEqual(invalidErrored, true, 'invalid custom routes must fail closed');

source.clear();

/* Deliberately absent: Activity, ContentRows, SettingsApi, Storage. */
assert.strictEqual(typeof Lampa.Activity, 'undefined');
assert.strictEqual(typeof Lampa.ContentRows, 'undefined');
assert.strictEqual(typeof Lampa.SettingsApi, 'undefined');
assert.strictEqual(typeof Lampa.Storage, 'undefined');

console.log('OK: all 14 rows, Seoul-day anchoring, stable menu identity, routing and filters passed');
