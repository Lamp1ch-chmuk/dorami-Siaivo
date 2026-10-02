/*
 * Siaivo Dorama for Lampa 3.x / Siaivo
 * Version: 0.7.0
 *
 * One left-navigation category: "Дорами".
 * Nothing is injected into the home/main screen.
 *
 * Architecture:
 * - a namespaced custom source owns category rows + category_full pagination;
 * - cards remain source:'tmdb', so details/person/seasons stay native;
 * - category rows are loaded lazily through Lampa.Api.partNext;
 * - a native Reguest + TMDB API catalog avoids unrelated global Discover filters;
 * - rows and grids share bounded, per-section native caching;
 * - untranslated titles use an English page fallback, matched by TMDB id;
 * - TMDB responses are copied before row metadata is changed (do not mutate cache);
 * - dated routes stay compatible; release dates never restrict the catalog;
 * - TMDB popularity order reflects user interest, without release-year gates.
 */
(function () {
    'use strict';

    var PLUGIN_ID = 'siaivo_dorama';
    var SOURCE_ID = 'plugin_siaivo_dorama';
    var VERSION = '0.7.0';
    var MENU_ACTION = 'plugin_siaivo_dorama';
    var MENU_TITLE = 'Дорами';
    var KOREA_UTC_OFFSET_HOURS = 9;
    var ROOT_ROUTE = 'siaivo-dorama';
    var ROUTE_PREFIX = ROOT_ROUTE + ':';
    var PARTS_LIMIT = 4;
    var catalogNetwork;
    var EXCLUDED_GENRES = [16, 99, 10762, 10763, 10764, 10767];
    var FICTION_GENRES = [18, 35, 80, 9648, 10759, 10765, 10751, 10766, 10768];
    // TMDB keyword IDs verified against the keyword/TV APIs, not guessed from titles.
    var EXCLUDED_KEYWORDS = [210024, 317204, 194610, 191498, 300454]; // anime, tokusatsu, variety, sports entertainment, puppetry
    // Confirmed non-dramas misclassified as Scripted/Drama in TMDB; see docs/POPULARITY-AUDIT.md.
    var NON_DRAMA_IDS = [67192, 121651, 5822, 108112, 19530];
    var LGBT_KEYWORDS = [158718, 289844, 384569, 365317, 280003, 383699, 240305, 319872, 353629, 351185];
    var DRAMA_COUNTRIES = ['KR', 'JP', 'TH', 'CN', 'TW', 'HK', 'PH', 'VN', 'SG'];
    var FOREIGN_TITLE = /[^\u0000-\u036f\u0400-\u052f\u1e00-\u1eff\u2000-\u2bff\u3000-\u303f\ud800-\udfff\ufe0f]/;
    var DEFAULT_CACHE_LIFE = 60 * 6;
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
     * Preserve dated route identities independently of the device time zone.
     * Korea is fixed at UTC+9; no Intl dependency is needed on old TV WebViews.
     * This date identifies the visit only and never limits release dates.
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
            include_null_first_air_dates: 'true',
            sort_by: options.sort_by || 'popularity.desc'
        };

        if (options.country) params.with_origin_country = options.country;
        if (options.language) params.with_original_language = options.language;
        if (options.with_genres) params.with_genres = options.with_genres;
        if (options.without_genres) params.without_genres = options.without_genres;
        if (options.with_type) params.with_type = options.with_type;
        if (options.with_keywords) params.with_keywords = options.with_keywords;
        if (options.without_keywords) params.without_keywords = options.without_keywords;

        return buildQuery('discover/tv', params);
    }

    /*
     * "Dorama" is not identical to TMDB genre Drama (18).
     * Require fiction genres and Miniseries OR Scripted, with explicit exclusions.
     * A broad fiction OR preserves comedy, crime and daily dramas without forcing genre 18.
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
        if (!options.without_genres) options.without_genres = EXCLUDED_GENRES.join(',');
        if (!options.with_genres) options.with_genres = FICTION_GENRES.join('|');
        if (!options.without_keywords) options.without_keywords = EXCLUDED_KEYWORDS.join(',');

        return dramaQuery(options);
    }

    function section(id, title, tmdb, cacheLife) {
        return {
            id: id,
            title: title,
            tmdb: tmdb,
            cache_life: typeof cacheLife === 'number' ? cacheLife : DEFAULT_CACHE_LIFE
        };
    }

    function getSections() {
        // TMDB calculates popularity from daily user activity plus accumulated interest.
        // Preserve its order: no release-year, rating or vote-count gates.
        return [
            section('kr_popular', '🇰🇷 Популярні корейські дорами', regional('KR', 'ko')),
            section('cn_popular', '🇨🇳 Популярні китайські дорами', regional('CN', 'zh')),
            section('jp_popular', '🇯🇵 Популярні японські дорами', regional('JP', 'ja')),
            section('th_popular', '🇹🇭 Популярні тайські дорами', regional('TH', 'th')),
            section('tw_popular', '🇹🇼 Популярні тайванські дорами', regional('TW', 'zh')),
            section('lgbt', '🏳️‍🌈 ЛГБТ-дорами', regional(DRAMA_COUNTRIES.join('|'), null, {
                with_keywords: LGBT_KEYWORDS.join('|')
            }))
        ];
    }

    function getSection(id) {
        var sections = getSections();
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

    function allowedCard(card, section) {
        var genres = card.genre_ids;
        if (card.adult === true || card.mal_id || NON_DRAMA_IDS.indexOf(card.id) !== -1) return false;
        if (!Array.isArray(genres) || !genres.some(function (id) { return FICTION_GENRES.indexOf(id) !== -1; })) return false;
        if (EXCLUDED_GENRES.some(function (id) { return genres.indexOf(id) !== -1; })) return false;
        if (section.id === 'lgbt' && (!Array.isArray(card.origin_country) || !card.origin_country.some(function (country) {
            return DRAMA_COUNTRIES.indexOf(country) !== -1;
        }))) return false;
        // Use Siaivo's existing anime map via its public helper. Identity-only TV probe
        // avoids its cold-map heuristic that treats every Japanese title as anime.
        if (Lampa.Utils && typeof Lampa.Utils.isAnime === 'function') {
            try {
                if (Lampa.Utils.isAnime({ id: card.id, first_air_date: 'tv' })) return false;
            } catch (error) { /* Older helper variants: server/genre exclusions still apply. */ }
        }
        return true;
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
            if (allowedCard(item, section)) results.push(item);
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

    function catalogAvailable() {
        return typeof Lampa.Reguest === 'function' && Lampa.TMDB &&
            typeof Lampa.TMDB.api === 'function' && typeof Lampa.TMDB.key === 'function';
    }

    function catalogLanguage() {
        return Lampa.Storage && typeof Lampa.Storage.field === 'function' ?
            Lampa.Storage.field('tmdb_lang') || 'uk-UA' : 'uk-UA';
    }

    function readableTitle(card) {
        var title = card && (card.name || card.original_name || '');
        return !!title && !FOREIGN_TITLE.test(title);
    }

    function requestCatalog(section, page, language, onComplete, onError) {
        if (!catalogNetwork) catalogNetwork = new Lampa.Reguest();
        catalogNetwork.timeout(10000);
        // Different parameter order isolates raw catalog cache from filtered native get/list.
        var method = section.tmdb + '&language=' + encodeURIComponent(language) +
            '&page=' + page + '&api_key=' + encodeURIComponent(Lampa.TMDB.key());
        catalogNetwork.silent(Lampa.TMDB.api(method), function (json) {
            // An invalid response is an error, not a successful empty catalog.
            if (!json || !Array.isArray(json.results)) return onError();
            onComplete(json);
        }, onError, false, { cache: rowCache(section) });
    }

    function catalogPage(section, anchor, page, onComplete, onError) {
        var language = catalogLanguage();
        requestCatalog(section, page, language, function (json) {
            var output = normalize(json, section, page, anchor);
            var needsEnglish = language !== 'en-US' && language !== 'en' &&
                output.results.some(function (card) { return !readableTitle(card); });

            function finish(english) {
                var titles = {};
                if (english && Array.isArray(english.results)) english.results.forEach(function (card) {
                    if (card && readableTitle(card)) titles[card.id] = card.name || card.original_name;
                });
                output.results.forEach(function (card) {
                    if (!readableTitle(card) && titles[card.id]) card.name = titles[card.id];
                    if (!card.name) card.name = card.original_name || ('TMDB ' + card.id);
                    if (!card.original_name) card.original_name = card.name;
                });
                onComplete(output);
            }

            if (!needsEnglish) return finish();
            // At most one extra page request; no per-card translations or removal on failure.
            requestCatalog(section, page, 'en-US', finish, function () { finish(); });
        }, onError);
    }

    function loadRow(section, anchor, onComplete, onError) {
        var tmdb = Lampa.Api.sources.tmdb;

        if (catalogAvailable()) return catalogPage(section, anchor, 1, onComplete, onError);

        /* Compatibility path for horizontal category rows. */
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
        if (catalogAvailable()) {
            var first = (page - 1) * 2 + 1;
            var parts = [];
            catalogPage(section, anchor, first, function (head) {
                parts.push(head);
                // TMDB exposes at most 500 discover pages, even if total_pages is larger.
                var total = Math.min(head.total_pages, 500);
                function finish(tail) {
                    var merged = copyObject(head);
                    var seen = {};
                    merged.results = [];
                    if (tail) parts.push(tail);
                    parts.forEach(function (part) {
                        part.results.forEach(function (card) {
                            if (seen[card.id]) return;
                            seen[card.id] = true;
                            merged.results.push(card);
                        });
                    });
                    merged.page = page;
                    merged.total_pages = Math.ceil(total / 2);
                    onComplete(merged);
                }
                if (first >= total) return finish();
                // Sequential fetch bounds concurrency and avoids requesting past the last page.
                catalogPage(section, anchor, first + 1, finish, function () {
                    if (onError) onError();
                });
            }, function () { if (onError) onError(); });
            return;
        }
        // Legacy builds without public network/TMDB helpers retain the native source path.
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

        getSections().forEach(function (item) {
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

        sectionItem = getSection(route.id);
        if (!sectionItem) {
            if (onError) onError();
            return;
        }

        loadPage(sectionItem, route.anchor, page, onComplete, onError);
    }

    function clear() {
        if (catalogNetwork) catalogNetwork.clear();
        catalogNetwork = null;
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
