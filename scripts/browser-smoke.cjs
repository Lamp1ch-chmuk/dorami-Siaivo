'use strict';

// Real, unmodified Siaivo UI + deterministic TMDB responses. No live credentials.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const appRoot = path.resolve(process.env.SIAIVO_APP_DIR || '/tmp/siaivo-upstream');
const pluginFile = path.resolve(__dirname, '../siaivo-dorama.js');
const loaderFile = path.resolve(__dirname, '../d.js');
const currentVersion = require('../package.json').version;
const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = pathname === '/siaivo-dorama.js' ? pluginFile : pathname === '/d.js' ? loaderFile
        : path.resolve(appRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (file !== pluginFile && file !== loaderFile && !file.startsWith(appRoot + path.sep)) {
        res.writeHead(403).end(); return;
    }
    try {
        const data = await fs.readFile(file);
        const type = { '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css',
            '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }[path.extname(file)];
        res.setHeader('Content-Type', type || 'application/octet-stream');
        res.end(data);
    } catch { res.writeHead(404).end(); }
});

function card(id) {
    return { id, name: 'Тестова дорама ' + id, original_name: 'Test Drama',
        original_language: 'ko', first_air_date: '2024-01-01', genre_ids: [18], popularity: 20,
        vote_count: 200, vote_average: 8, overview: 'Тестовий опис',
        poster_path: '/test.jpg', backdrop_path: '/test.jpg' };
}

async function main() {
    await fs.access(path.join(appRoot, 'app.min.js'));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const launch = { headless: true };
    if (process.env.SIAIVO_CHROMIUM_PATH) launch.executablePath = process.env.SIAIVO_CHROMIUM_PATH;
    const browser = await chromium.launch(launch);
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        const errors = [];
        const discover = [];
        const warnings = [];
        let revision = 0;
        let offline = false;
        let codeOffline = false;
        let deliveredVersion = currentVersion;
        const codeRequests = [];
        const payload = await fs.readFile(pluginFile, 'utf8');
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', e => {
            // Inspect native rendering warnings too: Lampa catches Card exceptions.
            if (e.type() === 'warning' && /onCreateAndAppend|Progress.*task error/.test(e.text())) warnings.push(e.text());
        });
        await page.route('**/*', async route => {
            const url = route.request().url();
            if (url.startsWith(origin + '/')) return route.continue();
            if (url.startsWith('https://raw.githubusercontent.com/Lamp1ch-chmuk/dorami-Siaivo/main/siaivo-dorama.js')
                || url.startsWith('https://cdn.jsdelivr.net/gh/Lamp1ch-chmuk/dorami-Siaivo@main/siaivo-dorama.js')) {
                codeRequests.push(url);
                if (codeOffline) return route.abort();
                return route.fulfill({ headers: { 'content-type': 'text/plain; charset=utf-8',
                    'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*' },
                    body: payload.replaceAll(currentVersion, deliveredVersion) });
            }
            if (url.endsWith('/anime/map.json')) return route.fulfill({ json: { tv: { '900001': [1] }, movie: {} } });
            if (url.includes('discover/tv')) {
                if (offline) return route.abort();
                const query = new URL(url).searchParams;
                const n = Number(query.get('page')) || 1;
                const newest = query.has('first_air_date.gte');
                discover.push({ page: n, country: query.get('with_origin_country'), language: query.get('language') });
                // Reversed response delays exercise real Progress ordering.
                await new Promise(resolve => setTimeout(resolve, n % 2 ? 30 : 5));
                return route.fulfill({ json: { page: n, total_pages: 8, total_results: 160,
                    results: Array.from({ length: 20 }, (_, i) => ({
                        ...card(n * 100 + i), vote_count: newest ? 3 : 0,
                        first_air_date: newest ? '2026-09-01' : i === 2 ? '' : i % 3 === 0 ? '2005-01-01' : i % 3 === 1 ? '2018-01-01' : '2026-01-01',
                        popularity: newest && n === 3 && i >= 6 ? 9 : 100 - n, genre_ids: [18, 10766],
                        origin_country: [query.get('with_origin_country').split('|')[i % query.get('with_origin_country').split('|').length]],
                        original_name: '새 드라마',
                        name: i % 4 === 0 ? (query.get('language') === 'en-US' ? 'English Drama ' + (n * 100 + i) + ' r' + revision : '새 드라마')
                            : 'Тестова дорама ' + (n * 100 + i) + ' r' + revision
                    })).concat([{ ...card(900001), origin_country: ['JP'], original_language: 'ja', name: 'Mapped anime with wrong Drama genre' }]) } });
            }
            const details = /\/tv\/(\d+)(?:\?|$)/.exec(url);
            if (details) return route.fulfill({ json: {
                ...card(Number(details[1])), genres: [{ id: 18, name: 'Drama' }],
                origin_country: ['KR'], production_countries: [{ iso_3166_1: 'KR', name: 'South Korea' }],
                networks: [], episode_run_time: [60], spoken_languages: [{ iso_639_1: 'ko', name: 'Korean' }],
                adult: false, created_by: [], homepage: '', languages: ['ko'],
                last_air_date: '2024-01-02', last_episode_to_air: null, next_episode_to_air: null,
                popularity: 100, production_companies: [], tagline: '', type: 'Scripted',
                in_production: true, content_ratings: { results: [] },
                keywords: { results: [] }, alternative_titles: { results: [] },
                number_of_seasons: 1, number_of_episodes: 2, status: 'Returning Series',
                seasons: [{ id: 1001, name: 'Сезон 1', season_number: 1, episode_count: 2 }],
                credits: { cast: [], crew: [] }, videos: { results: [] },
                images: { backdrops: [], posters: [] }, external_ids: {},
                translations: { translations: [{ iso_639_1: 'uk', data: { name: 'Тестова дорама', overview: 'Тестовий опис' } }] }
            } });
            const extra = /\/tv\/\d+\/(credits|similar|recommendations|videos|season\/\d+)(?:\?|$)/.exec(url);
            if (extra) return route.fulfill({ json: extra[1] === 'credits' ? { cast: [], crew: [] }
                : extra[1].startsWith('season/') ? { id: 1001, season_number: 1, episodes: [] }
                : { results: [], total_pages: 1, total_results: 0 } });
            if (route.request().resourceType() === 'image') return route.fulfill({
                contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="150"/>'
            });
            // Other online services are intentionally disabled for this UI test.
            return route.abort();
        });
        await page.addInitScript(({ pluginUrl }) => {
            localStorage.setItem('language', 'uk');
            localStorage.setItem('tmdb_lang', 'uk-UA');
            localStorage.setItem('account_use', 'false');
            localStorage.setItem('plugins', JSON.stringify([{ url: pluginUrl, status: 1 }]));
            localStorage.setItem('request_caching', 'true');
        }, { pluginUrl: origin + '/d.js' });
        await page.goto(origin);
        await page.waitForFunction(() => window.appready === true && window.app_time_launch && window.show_app, null, { timeout: 30000 });
        const version = await page.evaluate(() => Lampa.Manifest.app_version);
        const menu = '[data-action="plugin_siaivo_dorama"]';
        await page.waitForSelector(menu, { state: 'attached' });
        assert.equal(await page.locator(menu).count(), 1);
        assert.equal(codeRequests.length, 1, 'one fresh code request per startup');
        await page.addScriptTag({ url: origin + '/d.js' });
        assert.equal(codeRequests.length, 1, 'loader reinjection does not download twice');
        await page.waitForFunction(() => Lampa.Utils.isAnime({ id: 900001, first_air_date: 'tv' }));
        await page.locator(menu).dispatchEvent('hover:enter');
        await page.waitForFunction(() => Lampa.Activity.active().component === 'category'
            && Lampa.Activity.active().activity.component.items.length === 4);
        assert.equal(await page.locator('.items-line__more').count(), 4);
        assert.equal(await page.evaluate(() => Lampa.Activity.active().source), 'plugin_siaivo_dorama');
        const titles = await page.evaluate(() => Lampa.Activity.active().activity.component.items.map(i => i.data.title));
        assert.match(titles[0], /Популярні корейські/);
        assert.match(titles[1], /Популярні китайські/);
        assert.match(titles[2], /Популярні японські/);
        assert.match(titles[3], /Популярні тайські/);

        const rowCards = await page.evaluate(() => Lampa.Activity.active().activity.component.items.map(i => i.data.results));
        assert.ok(rowCards.every(cards => cards.length === 20), 'old and new zero-vote dramas fill popular rows without mapped anime');
        assert.equal(rowCards[3][0].name, 'English Drama 100 r0', 'page-level English title fallback');
        assert.equal(rowCards[3][1].name, 'Тестова дорама 101 r0', 'local title preserved');
        assert.equal(rowCards[3][0].original_name, '새 드라마');
        assert.equal(discover.length, 8, 'bounded primary + English request per row');
        assert.equal(rowCards[0][0].first_air_date, '2005-01-01', 'older drama remains first in popularity order');
        assert.ok(discover.every(r => ['KR', 'CN', 'JP', 'TH'].includes(r.country)));

        // Actual "More" event through native Line -> Router -> category_full.
        await page.locator('.items-line__more').first().dispatchEvent('hover:enter');
        await page.waitForFunction(() => Lampa.Activity.active().component === 'category_full'
            && Lampa.Activity.active().activity.component.items.length === 40);
        const grid = await page.evaluate(() => ({
            source: Lampa.Activity.active().source,
            route: Lampa.Activity.active().url,
            pages: Lampa.Activity.active().activity.component.total_pages
        }));
        assert.equal(grid.source, 'plugin_siaivo_dorama');
        assert.match(grid.route, /^siaivo-dorama:\d{4}-\d{2}-\d{2}:kr_popular$/);
        assert.equal(grid.pages, 4, 'catalog must merge two raw TMDB pages per view');
        assert.equal(discover.filter(r => r.page === 1).length, 8, 'More reuses raw row and English page cache');

        // Run native pagination callback, including real native catalog requests.
        await page.evaluate(() => new Promise((resolve, reject) => {
            const comp = Lampa.Activity.active().activity.component;
            comp.object.page = 2;
            comp.emit('next', data => {
                if (data.results.length !== 40) return reject(new Error('Expected merged page 2'));
                resolve();
            }, () => reject(new Error('Native pagination failed')));
        }));
        assert.ok(discover.some(r => r.page === 3));
        assert.ok(discover.some(r => r.page === 4));

        // Actual card enter: original_name -> native Router method tv + TMDB details.
        await page.evaluate(() => Lampa.Activity.active().activity.component.items[0].render(true).dispatchEvent(new Event('hover:enter')));
        await page.waitForFunction(() => Lampa.Activity.active().component === 'full');
        const full = await page.evaluate(() => ({ source: Lampa.Activity.active().source, method: Lampa.Activity.active().method }));
        assert.deepEqual(full, { source: 'tmdb', method: 'tv' });
        await page.waitForFunction(() => document.body.textContent.includes('Тестовий опис'), null, { timeout: 10000 }).catch(async error => {
            console.error('Details rendering failed:', (await page.locator('body').innerText()).slice(-1600));
            throw error;
        });
        await page.evaluate(() => Lampa.Activity.backward());
        await page.waitForFunction(() => Lampa.Activity.active().component === 'category_full');
        await page.evaluate(() => Lampa.Activity.backward());
        await page.waitForFunction(() => Lampa.Activity.active().component === 'category');
        assert.equal(await page.locator(menu).count(), 1);
        // Native lazy loading appends the remaining Taiwanese, popular-newest and shared LGBT rows.
        await page.evaluate(() => {
            const comp = Lampa.Activity.active().activity.component;
            comp.builded_time = 0;
            comp.emit('loadNext');
        });
        await page.waitForFunction(() => {
            const comp = Lampa.Activity.active().activity.component;
            // Each native scroll-animation completion appends one queued row.
            if (comp.loaded.length) comp.scroll.onAnimateEnd();
            return comp.items.length === 7;
        }, null, { timeout: 5000 }).catch(async error => {
            console.error('Lazy rows:', await page.evaluate(() => {
                const c = Lampa.Activity.active().activity.component;
                return { count: c.items.length, loaded: c.loaded.length, next: c.next_wait, animated: c.scroll.animated() };
            }));
            throw error;
        });
        const allTitles = await page.evaluate(() => Lampa.Activity.active().activity.component.items.map(i => i.data.title));
        assert.match(allTitles[4], /Популярні тайванські/);
        assert.match(allTitles[5], /Популярні новинки/);
        assert.match(allTitles[6], /ЛГБТ-дорами/);
        const beforeNewest = discover.length;
        await page.evaluate(() => Lampa.Activity.active().activity.component.items[5].toggle());
        await page.locator('.items-line__more').nth(5).dispatchEvent('hover:enter');
        await page.waitForFunction(() => Lampa.Activity.active().component === 'category_full'
            && Lampa.Activity.active().activity.component.items.length === 40);
        const newest = await page.evaluate(() => ({
            route: Lampa.Activity.active().url,
            pages: Lampa.Activity.active().activity.component.total_pages,
            cards: Lampa.Activity.active().activity.component.items.map(item => item.data)
        }));
        assert.match(newest.route, /:new_popular$/);
        assert.equal(newest.pages, 2);
        assert.equal(new Set(newest.cards.flatMap(card => card.origin_country)).size, 5);
        assert.ok(newest.cards.every(card => card.vote_count >= 3 && card.first_air_date === '2026-09-01'));
        await page.evaluate(() => new Promise((resolve, reject) => {
            const comp = Lampa.Activity.active().activity.component;
            comp.object.page = 2;
            comp.emit('next', data => {
                if (data.results.length !== 6 || data.total_results !== 46 || data.total_pages !== 2)
                    return reject(new Error('Expected exact 46-card shortlist end'));
                resolve();
            }, () => reject(new Error('Newest pagination failed')));
        }));
        assert.equal(discover.length, beforeNewest, 'newest row and both grid pages reuse the shortlist');
        await page.evaluate(() => Lampa.Activity.backward());
        await page.waitForFunction(() => Lampa.Activity.active().component === 'category');
        // Focus the last native line so off-screen cards/More finish lazy rendering.
        await page.evaluate(() => Lampa.Activity.active().activity.component.items[6].toggle());
        // Open the single mixed-country LGBT row through its actual native More control.
        await page.locator('.items-line__more').nth(6).dispatchEvent('hover:enter');
        await page.waitForFunction(() => Lampa.Activity.active().component === 'category_full'
            && Lampa.Activity.active().activity.component.items.length === 40);
        const lgbt = await page.evaluate(() => ({
            route: Lampa.Activity.active().url,
            cards: Lampa.Activity.active().activity.component.items.map(item => item.data)
        }));
        assert.match(lgbt.route, /:lgbt$/);
        assert.equal(new Set(lgbt.cards.flatMap(card => card.origin_country)).size, 9);
        assert.ok(lgbt.cards.every(card => card.id !== 900001 && card.source === 'tmdb'));
        await page.evaluate(() => Lampa.Activity.backward());
        await page.waitForFunction(() => Lampa.Activity.active().component === 'category');

        // Real native persistent caching: no refresh at two hours, all rows at six hours.
        revision = 1;
        const beforeRefresh = discover.length;
        async function readInitialRowsAfter(hours) {
            return page.evaluate(async hours => {
                const originalNow = Date.now;
                Date.now = () => originalNow() + (hours * 60 * 60 * 1000) + 1000;
                try {
                    return await new Promise((resolve, reject) => Lampa.Api.sources.plugin_siaivo_dorama.category({},
                        rows => resolve(rows.map(row => row.results[0].name)), () => reject(new Error('Refresh failed'))));
                } finally { Date.now = originalNow; }
            }, hours);
        }
        const cached = await readInitialRowsAfter(2);
        assert.equal(discover.length, beforeRefresh, 'six-hour cache avoids repeated requests');
        assert.ok(cached.every(name => /r0$/.test(name)));
        const refreshed = await readInitialRowsAfter(6);
        assert.equal(discover.length - beforeRefresh, 8, 'four expired rows and their translations refresh');
        assert.ok(refreshed.every(name => /r1$/.test(name)));

        const beforeNewestRefresh = discover.length;
        async function readNewestAfter(hours) {
            return page.evaluate(async ({ hours, route }) => {
                const originalNow = Date.now;
                Date.now = () => originalNow() + hours * 3600000 + 1000;
                try {
                    return await new Promise((resolve, reject) => Lampa.Api.sources.plugin_siaivo_dorama.list({
                        url: route, page: 1
                    }, data => resolve(data.results[0].name), () => reject(new Error('Newest refresh failed'))));
                } finally { Date.now = originalNow; }
            }, { hours, route: newest.route });
        }
        assert.match(await readNewestAfter(2), /r0$/);
        assert.equal(discover.length, beforeNewestRefresh);
        assert.match(await readNewestAfter(3), /r1$/);
        assert.equal(discover.length - beforeNewestRefresh, 6, 'three expired raw newest pages and English titles');

        offline = true;
        const offlineRows = await page.evaluate(async () => {
            const originalNow = Date.now;
            Date.now = () => originalNow() + (73 * 60 * 60 * 1000);
            try {
                return await new Promise((resolve, reject) => Lampa.Api.sources.plugin_siaivo_dorama.category({},
                    rows => resolve(rows.map(row => row.results.length)), () => reject(new Error('Offline fallback failed'))));
            } finally { Date.now = originalNow; }
        });
        assert.deepEqual(offlineRows, [20, 20, 20, 20], 'native stale cache survives an upstream outage');

        // Reusing the identical entry after app restart loads newer code, including with
        // GitHub Raw's real text/plain + nosniff response policy.
        offline = false;
        deliveredVersion = '0.8.1'; // synthetic next release fixture
        await page.reload();
        await page.waitForFunction(() => window.appready && window.app_time_launch && window.show_app);
        await page.waitForFunction(() => Lampa.Api.sources.plugin_siaivo_dorama &&
            Lampa.Api.sources.plugin_siaivo_dorama.__siaivo_dorama_plugin === '0.8.1');
        assert.equal(await page.locator(menu).count(), 1);
        assert.equal(codeRequests.length, 2);
        assert.equal(new URL(codeRequests[0]).pathname, new URL(codeRequests[1]).pathname);
        assert.notEqual(new URL(codeRequests[0]).search, new URL(codeRequests[1]).search);

        codeOffline = true;
        await page.reload();
        await page.waitForFunction(() => window.appready && window.app_time_launch && window.show_app);
        await page.waitForFunction(() => Lampa.Api.sources.plugin_siaivo_dorama &&
            Lampa.Api.sources.plugin_siaivo_dorama.__siaivo_dorama_plugin === '0.8.1');
        assert.equal(await page.locator(menu).count(), 1);
        assert.equal(codeRequests.length, 3, 'saved newest code used without requesting older CDN');

        assert.deepEqual(errors, [], 'uncaught browser errors');
        assert.deepEqual(warnings, [], 'native rendering/task errors');
        console.log('OK: Siaivo ' + version + ': menu, rows, full rows, translated titles, More, merged pagination, five-country newest shortlist and exact end, mixed-country LGBT More, mapped anime exclusion, TV details, Back, shared cache, TTL expiry, permanent loader update and offline fallback; fixture TMDB/code data');
    } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
