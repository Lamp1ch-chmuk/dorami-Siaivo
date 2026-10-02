'use strict';

// Real, unmodified Siaivo UI + deterministic TMDB responses. No live credentials.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const appRoot = path.resolve(process.env.SIAIVO_APP_DIR || '/tmp/siaivo-upstream');
const pluginFile = path.resolve(__dirname, '../siaivo-dorama.js');
const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = pathname === '/siaivo-dorama.js' ? pluginFile
        : path.resolve(appRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (file !== pluginFile && !file.startsWith(appRoot + path.sep)) {
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
        original_language: 'ko', first_air_date: '2024-01-01', genre_ids: [18],
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
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', e => {
            // Inspect native rendering warnings too: Lampa catches Card exceptions.
            if (e.type() === 'warning' && /onCreateAndAppend|Progress.*task error/.test(e.text())) warnings.push(e.text());
        });
        await page.route('**/*', async route => {
            const url = route.request().url();
            if (url.startsWith(origin + '/')) return route.continue();
            if (url.includes('discover/tv')) {
                const query = new URL(url).searchParams;
                const n = Number(query.get('page')) || 1;
                discover.push({ page: n, country: query.get('with_origin_country') });
                // Reversed response delays exercise real Progress ordering.
                await new Promise(resolve => setTimeout(resolve, n % 2 ? 30 : 5));
                return route.fulfill({ json: { page: n, total_pages: 8, total_results: 160,
                    results: Array.from({ length: 20 }, (_, i) => card(n * 100 + i)) } });
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
        await page.addInitScript(() => {
            localStorage.setItem('language', 'uk');
            localStorage.setItem('tmdb_lang', 'uk-UA');
            localStorage.setItem('account_use', 'false');
            localStorage.setItem('plugins', '[]');
        });
        await page.goto(origin);
        await page.waitForFunction(() => window.appready === true && window.app_time_launch && window.show_app, { timeout: 30000 });
        const version = await page.evaluate(() => Lampa.Manifest.app_version);
        await page.addScriptTag({ url: origin + '/siaivo-dorama.js' });
        const menu = '[data-action="plugin_siaivo_dorama"]';
        assert.equal(await page.locator(menu).count(), 1);
        await page.locator(menu).dispatchEvent('hover:enter');
        await page.waitForFunction(() => Lampa.Activity.active().component === 'category'
            && Lampa.Activity.active().activity.component.items.length === 4);
        assert.equal(await page.locator('.items-line__more').count(), 4);
        assert.equal(await page.evaluate(() => Lampa.Activity.active().source), 'plugin_siaivo_dorama');
        const titles = await page.evaluate(() => Lampa.Activity.active().activity.component.items.map(i => i.data.title));
        assert.match(titles[0], /Популярні корейські/);
        assert.match(titles[1], /новими серіями/);
        assert.match(titles[2], /онгоїнги/);
        assert.match(titles[3], /Нові корейські/);

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
        assert.equal(grid.pages, 4, 'native Siaivo must merge two raw TMDB pages per view');

        // Run native pagination callback, including its real patched TMDB list.
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
        assert.deepEqual(errors, [], 'uncaught browser errors');
        assert.deepEqual(warnings, [], 'native rendering/task errors');
        console.log('OK: Siaivo ' + version + ': menu, rows, More, merged pagination, TV details, Back; fixture TMDB data');
    } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
