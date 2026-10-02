/*
 * Siaivo Dorama for Lampa 3.x / Siaivo
 * Version: 0.4.1
 *
 * One left-navigation category: "Дорами".
 * Nothing is injected into the home/main screen.
 *
 * Architecture:
 * - a namespaced custom source owns category rows + category_full pagination;
 * - cards remain source:'tmdb', so details/person/seasons stay native;
 * - category rows are loaded lazily through Lampa.Api.partNext;
 * - first-page rows use TMDB.get() to follow native Lampa cache/filter logic;
 * - category_full uses public Lampa.Api.list(), including Siaivo's own patches;
 * - TMDB responses are copied before row metadata is changed (do not mutate cache);
 * - date-dependent routes contain an anchor date, so pagination remains stable
 *   even if the device crosses midnight while the category is open.
 */
(function () {
    'use strict';

    var PLUGIN_ID = 'siaivo_dorama';
    var SOURCE_ID = 'plugin_siaivo_dorama';
    var VERSION = '0.4.1';
    var MENU_ACTION = 'plugin_siaivo_dorama';
    var MENU_TITLE = 'Дорами';
    var KOREA_TIMEZONE = 'Asia/Seoul';
    var KOREA_UTC_OFFSET_HOURS = 9;
    var ROOT_ROUTE = 'siaivo-dorama';
    var ROUTE_PREFIX = ROOT_ROUTE + ':';
    var PARTS_LIMIT = 4;
    var DEFAULT_CACHE_LIFE = 60 * 24;
    var START_FLAG = '__' + PLUGIN_ID + '_started';
    var MENU_LISTENER_FLAG = '__' + PLUGIN_ID + '_menu_listener';
    var APP_LISTENER_FLAG = '__' + PLUGIN_ID + '_app_listener';
    var MAX_BOOT_ATTEMPTS = 120;

    var ICON = '' +
        '<svg width="38" height="38" viewBox="0 0 38 38" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M8 7.5H30C32.2091 7.5 34 9.29086 34 11.5V27C34 29.2091 32.2091 31 30 31H8C5.79086 31 4 29.2091 4 27V11.5C4 9.29086 5.79086 7.5 8 7.5Z" stroke="currentColor" stroke-width="2.6"/>' +
        '<path d="M14 3.5L19 7.5L24 3.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="M15 14L26 19.25L15 24.5V14Z" fill="currentColor"/>' +
        '</svg>';

    function consoleWrite(method, args) {
        var parts = ['[Siaivo Dorama]'];
        var i;

        if (!window.console || !window.console[method]) return;

        for (i = 0; i < args.length; i++) parts.push(String(args[i]));

        /* Some old TV WebViews expose console methods as host functions without .apply(). */
        try {
            window.console[method](parts.join(' '));
        } catch (error) {
            /* Logging must never break the plugin. */
        }
    }

    function log() {
        consoleWrite('log', arguments);
    }

    function warn() {
        consoleWrite('warn', arguments);
    }

    function pad2(value) {
        return value < 10 ? '0' + value : String(value);
    }

    function dateKey(date) {
        return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
    }

    /*
     * Korean date-sensitive rows must use the Korean calendar day, not the
     * device's local day. Korea is fixed at UTC+9 and has no daylight saving,
     * so this avoids Intl/time-zone dependencies on older TV WebViews.
     */
    function koreaCalendarDate(now) {
        var shifted = new Date((now || new Date()).getTime() + KOREA_UTC_OFFSET_HOURS * 60 * 60 * 1000);

        return new Date(
            shifted.getUTCFullYear(),
            shifted.getUTCMonth(),
            shifted.getUTCDate(),
            12, 0, 0
        );
    }

    function dateOffsetFrom(anchor, days) {
        var date = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 12, 0, 0);
        date.setDate(date.getDate() + (days || 0));
        return dateKey(date);
    }

    function parseDateKey(value) {
        var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
        var date;

        if (!match) return null;

        date = new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10), 12, 0, 0);

        if (dateKey(date) !== value) return null;
        return date;
    }

    function copyObject(source) {
        var target = {};
        var key;

        source = source || {};
        for (key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = source[key];
        }

        return target;
    }

    function buildQuery(path, params) {
        var query = [];
        var key;

        for (key in params) {
            if (!Object.prototype.hasOwnProperty.call(params, key)) continue;
            if (params[key] === undefined || params[key] === null || params[key] === '') continue;

            query.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(params[key])));
        }

        return path + (query.length ? '?' + query.join('&') : '');
    }

    function dramaQuery(options) {
        options = options || {};

        var params = {
            include_adult: 'false',
            include_null_first_air_dates: 'false',
            sort_by: options.sort_by || 'popularity.desc'
        };

        if (options.country) params.with_origin_country = options.country;
        if (options.language) params.with_original_language = options.language;
        if (options.with_genres) params.with_genres = options.with_genres;
        if (options.without_genres) params.without_genres = options.without_genres;
        if (options.with_networks) params.with_networks = options.with_networks;
        if (options.with_status) params.with_status = options.with_status;
        if (options.with_type) params.with_type = options.with_type;
        if (options.first_air_date_year) params.first_air_date_year = options.first_air_date_year;
        if (options.first_air_date_lte) params['first_air_date.lte'] = options.first_air_date_lte;
        if (options.first_air_date_gte) params['first_air_date.gte'] = options.first_air_date_gte;
        if (options.air_date_lte) params['air_date.lte'] = options.air_date_lte;
        if (options.air_date_gte) params['air_date.gte'] = options.air_date_gte;
        if (options.timezone) params.timezone = options.timezone;
        if (options.vote_average_gte !== undefined) params['vote_average.gte'] = options.vote_average_gte;
        if (options.vote_count_gte !== undefined) params['vote_count.gte'] = options.vote_count_gte;
        if (options.with_keywords) params.with_keywords = options.with_keywords;

        return buildQuery('discover/tv', params);
    }

    /*
     * "Dorama" is not identical to TMDB genre Drama (18).
     * Base regional catalogs use Miniseries OR Scripted and exclude Animation.
     * Genre filtering is added only for thematic rows.
     */
    function regional(country, language, extra) {
        var options = {};
        var key;

        extra = extra || {};
        for (key in extra) {
            if (Object.prototype.hasOwnProperty.call(extra, key)) options[key] = extra[key];
        }

        options.country = country;
        options.language = language;
        if (!options.with_type) options.with_type = '2|4';
        if (!options.without_genres) options.without_genres = '16';

        return dramaQuery(options);
    }

    function korean(extra) {
        return regional('KR', 'ko', extra);
    }

    function section(id, title, tmdb, cacheLife) {
        return {
            id: id,
            title: title,
            tmdb: tmdb,
            cache_life: typeof cacheLife === 'number' ? cacheLife : DEFAULT_CACHE_LIFE
        };
    }

    function getSections(anchor) {
        var today = dateOffsetFrom(anchor, 0);

        return [
            section(
                'kr_popular',
                '🇰🇷 Популярні корейські дорами',
                korean({ sort_by: 'popularity.desc' }),
                60 * 12
            ),
            section(
                'kr_recent_episodes',
                '🔥 Дорами з новими серіями',
                korean({
                    sort_by: 'popularity.desc',
                    air_date_gte: dateOffsetFrom(anchor, -14),
                    air_date_lte: today,
                    timezone: KOREA_TIMEZONE
                }),
                60 * 6
            ),
            section(
                'kr_ongoing',
                '📺 Корейські онгоїнги',
                korean({
                    sort_by: 'popularity.desc',
                    with_status: '0|2',
                    first_air_date_lte: today,
                    air_date_gte: dateOffsetFrom(anchor, -21),
                    air_date_lte: dateOffsetFrom(anchor, 21),
                    timezone: KOREA_TIMEZONE
                }),
                60 * 6
            ),
            section(
                'kr_new',
                '🆕 Нові корейські дорами',
                korean({
                    sort_by: 'first_air_date.desc',
                    first_air_date_gte: dateOffsetFrom(anchor, -180),
                    first_air_date_lte: today
                }),
                60 * 12
            ),
            section(
                'kr_top',
                '⭐ Корейські дорами з високим рейтингом',
                korean({
                    sort_by: 'vote_average.desc',
                    vote_average_gte: 7.5,
                    vote_count_gte: 100
                }),
                60 * 24 * 3
            ),
            section(
                'kr_comedy',
                '😂 Комедійні дорами',
                korean({
                    sort_by: 'popularity.desc',
                    with_genres: '35'
                })
            ),
            section(
                'kr_mystery',
                '🕵️ Детективи та таємниці',
                korean({
                    sort_by: 'popularity.desc',
                    with_genres: '9648'
                })
            ),
            section(
                'kr_fantasy',
                '✨ Фентезі та фантастика',
                korean({
                    sort_by: 'popularity.desc',
                    with_genres: '10765'
                })
            ),
            section(
                'kr_netflix',
                '🎬 Netflix • корейські серіали',
                korean({
                    sort_by: 'popularity.desc',
                    with_networks: '213'
                })
            ),
            section(
                'kr_tvn',
                '📡 tvN',
                korean({
                    sort_by: 'popularity.desc',
                    with_networks: '866'
                })
            ),
            section(
                'kr_jtbc',
                '📡 JTBC',
                korean({
                    sort_by: 'popularity.desc',
                    with_networks: '885'
                })
            ),
            section(
                'cn_popular',
                '🇨🇳 Китайські дорами',
                regional('CN', 'zh', { sort_by: 'popularity.desc' })
            ),
            section(
                'jp_popular',
                '🇯🇵 Японські дорами',
                regional('JP', 'ja', { sort_by: 'popularity.desc' })
            ),
            section(
                'th_popular',
                '🇹🇭 Тайські дорами',
                regional('TH', 'th', { sort_by: 'popularity.desc' })
            )
        ];
    }

    function getSection(id, anchor) {
        var sections = getSections(anchor);
        var i;

        for (i = 0; i < sections.length; i++) {
            if (sections[i].id === id) return sections[i];
        }

        return null;
    }

    function routeFor(section, anchor) {
        return ROUTE_PREFIX + dateKey(anchor) + ':' + section.id;
    }

    function parseRoute(url) {
        var value = String(url || '');
        var rest;
        var split;
        var anchor;

        if (value.indexOf(ROUTE_PREFIX) !== 0) return null;

        rest = value.slice(ROUTE_PREFIX.length);
        split = rest.indexOf(':');
        if (split <= 0) return null;

        anchor = parseDateKey(rest.slice(0, split));
        if (!anchor) return null;

        return {
            anchor: anchor,
            id: rest.slice(split + 1)
        };
    }

    function normalize(json, section, page, anchor) {
        var output = copyObject(json || {});
        var inputResults = json && Array.isArray(json.results) ? json.results : [];
        var results = [];

        inputResults.forEach(function (card) {
            var item;
            var id;

            /* Native Card/Router require an actual TMDB card, not null/arrays. */
            if (!card || typeof card !== 'object' || Array.isArray(card)) return;
            if (typeof card.id !== 'number' && typeof card.id !== 'string') return;
            id = Number(card.id);
            if (!isFinite(id) || id <= 0 || Math.floor(id) !== id) return;

            item = copyObject(card);
            item.id = id;
            /* These cards always originate from TMDB; keep details routed there. */
            item.source = 'tmdb';
            results.push(item);
        });

        output.results = results;
        output.title = section.title;
        output.name = section.title;
        output.url = routeFor(section, anchor);
        output.source = SOURCE_ID;
        var normalizedPage = parseInt(page || output.page || 1, 10);
        var totalPages = parseInt(output.total_pages, 10);
        var totalResults = parseInt(output.total_results, 10);

        output.page = isFinite(normalizedPage) && normalizedPage > 0 ? normalizedPage : 1;
        output.total_pages = isFinite(totalPages) && totalPages >= 0 ? totalPages : 1;
        output.total_results = isFinite(totalResults) && totalResults >= 0 ? totalResults : results.length;

        return output;
    }

    function rowCache(section) {
        return {
            life: typeof section.cache_life === 'number' ? section.cache_life : DEFAULT_CACHE_LIFE
        };
    }

    function loadRow(section, anchor, onComplete, onError) {
        var tmdb = Lampa.Api.sources.tmdb;

        /* Native Lampa path for horizontal category rows. */
        if (tmdb && typeof tmdb.get === 'function') {
            tmdb.get(section.tmdb, { page: 1 }, function (json) {
                onComplete(normalize(json, section, 1, anchor));
            }, function () {
                if (onError) onError();
            }, rowCache(section));
            return;
        }

        /* Compatibility fallback if a future build stops exposing tmdb.get(). */
        Lampa.Api.list({
            source: 'tmdb',
            url: section.tmdb,
            page: 1
        }, function (json) {
            onComplete(normalize(json, section, 1, anchor));
        }, function () {
            if (onError) onError();
        });
    }

    function loadPage(section, anchor, page, onComplete, onError) {
        Lampa.Api.list({
            source: 'tmdb',
            url: section.tmdb,
            page: page || 1
        }, function (json) {
            onComplete(normalize(json, section, page || 1, anchor));
        }, function () {
            if (onError) onError();
        });
    }

    function category(params, onComplete, onError) {
        var anchor = koreaCalendarDate(new Date());
        var parts = [];

        getSections(anchor).forEach(function (item) {
            parts.push(function (call) {
                loadRow(item, anchor, call, call);
            });
        });

        function loadPart(partLoaded, partEmpty) {
            Lampa.Api.partNext(parts, PARTS_LIMIT, partLoaded, partEmpty);
        }

        loadPart(onComplete, onError);
        return loadPart;
    }

    function list(params, onComplete, onError) {
        var route = parseRoute(params && params.url);
        var sectionItem;
        var page = parseInt(params && params.page || 1, 10) || 1;
        if (!isFinite(page) || page < 1) page = 1;

        if (!route || !route.id) {
            if (onError) onError();
            return;
        }

        sectionItem = getSection(route.id, route.anchor);
        if (!sectionItem) {
            if (onError) onError();
            return;
        }

        loadPage(sectionItem, route.anchor, page, onComplete, onError);
    }

    function clear() {
        /* No private cache/state. Global Lampa.Api.clear() also clears TMDB. */
    }

    var SOURCE = {
        main: category,
        category: category,
        list: list,
        clear: clear,
        __siaivo_dorama_plugin: VERSION
    };

    function registerSource() {
        var existing;

        if (!Lampa.Api || !Lampa.Api.sources || !Lampa.Api.sources.tmdb) return false;

        existing = Lampa.Api.sources[SOURCE_ID];
        if (existing && existing !== SOURCE) {
            warn('Source id is already occupied:', SOURCE_ID);
            return false;
        }

        Lampa.Api.sources[SOURCE_ID] = SOURCE;
        return true;
    }

    function openDorama() {
        if (!registerSource()) {
            warn('TMDB/custom source is not ready');
            return;
        }

        Lampa.Router.call('category', {
            url: ROOT_ROUTE,
            title: MENU_TITLE,
            source: SOURCE_ID,
            page: 1
        });
    }

    function menuRoot(body) {
        if (body && body.find) return body;
        if (Lampa.Menu && typeof Lampa.Menu.render === 'function') return Lampa.Menu.render();
        return null;
    }

    function syncMenuButton(body) {
        var root = menuRoot(body);
        var current;
        var button;

        if (!root || !root.find) return;

        current = root.find('[data-action="' + MENU_ACTION + '"]').first();
        if (current && current.length) {
            if (typeof current.attr === 'function') {
                var owner = current.attr('data-plugin');
                if (owner !== PLUGIN_ID) warn('Menu action is already occupied:', MENU_ACTION);
            }
            return;
        }

        button = Lampa.Menu.addButton(ICON, MENU_TITLE, openDorama);
        if (!button || typeof button.attr !== 'function') {
            warn('Menu.addButton did not return a JQuery-like element');
            return;
        }

        button.attr('data-action', MENU_ACTION);
        button.attr('data-plugin', PLUGIN_ID);

        /*
         * Do not write menu_sort/menu_hide here. Siaivo's menu editor owns
         * visibility/order and observes dynamically added .selector items.
         */
    }

    function bindMenu() {
        if (!window[MENU_LISTENER_FLAG]) {
            Lampa.Listener.follow('menu', function (event) {
                if (event && event.type === 'start') syncMenuButton(event.body);
            });
            window[MENU_LISTENER_FLAG] = true;
        }

        /* Covers plugins loaded after the menu start event. */
        syncMenuButton();
    }

    function coreReady() {
        return !!(
            window.Lampa &&
            Lampa.Api &&
            typeof Lampa.Api.list === 'function' &&
            typeof Lampa.Api.partNext === 'function' &&
            Lampa.Api.sources &&
            Lampa.Api.sources.tmdb &&
            Lampa.Menu &&
            typeof Lampa.Menu.addButton === 'function' &&
            typeof Lampa.Menu.render === 'function' &&
            Lampa.Router &&
            typeof Lampa.Router.call === 'function' &&
            Lampa.Listener &&
            typeof Lampa.Listener.follow === 'function'
        );
    }

    function init(attempt) {
        attempt = attempt || 0;
        if (window[START_FLAG]) return;

        if (!coreReady()) {
            if (attempt < MAX_BOOT_ATTEMPTS) {
                setTimeout(function () {
                    init(attempt + 1);
                }, 250);
            } else {
                warn('Required Lampa 3.x APIs were not found');
            }
            return;
        }

        if (!registerSource()) return;
        bindMenu();

        window[START_FLAG] = true;
        log('loaded', VERSION, Lampa.Manifest && Lampa.Manifest.app_version ? 'Lampa ' + Lampa.Manifest.app_version : '');
    }

    function boot(attempt) {
        attempt = attempt || 0;

        if (window.appready) {
            init(0);
            return;
        }

        if (window.Lampa && Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
            if (!window[APP_LISTENER_FLAG]) {
                Lampa.Listener.follow('app', function (event) {
                    if (event && event.type === 'ready') init(0);
                });
                window[APP_LISTENER_FLAG] = true;
            }
            return;
        }

        if (attempt < MAX_BOOT_ATTEMPTS) {
            setTimeout(function () {
                boot(attempt + 1);
            }, 250);
        } else {
            warn('Lampa bootstrap timeout');
        }
    }

    boot(0);
})();
