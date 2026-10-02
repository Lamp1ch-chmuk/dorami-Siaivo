'use strict';

// No request interception: Playwright routing disables the HTTP cache under test.
// These minimal JS fixtures isolate the redirect/cache policy observed in production.
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
let version = '0.4.1';
let cdnRequests = 0;

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/s') {
        res.writeHead(302, { Location: '/cdn/d.js', 'Cache-Control': 'no-cache' }).end();
        return;
    }
    if (url.pathname === '/cdn/d.js') {
        cdnRequests++;
        res.writeHead(200, {
            'Content-Type': 'application/javascript',
            'Cache-Control': 'public, max-age=604800, s-maxage=43200',
            ETag: '"' + version + '"'
        });
        res.end('window.loadedVersion=' + JSON.stringify(version) + ';');
        return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    res.end('<!doctype html><script src="/s?reset=' + url.searchParams.get('reset') + '"></script>');
});

async function main() {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const launch = { headless: true };
    if (process.env.SIAIVO_CHROMIUM_PATH) launch.executablePath = process.env.SIAIVO_CHROMIUM_PATH;
    const browser = await chromium.launch(launch);
    try {
        const page = await browser.newPage();
        await page.goto(origin + '/?reset=first');
        assert.equal(await page.evaluate(() => window.loadedVersion), '0.4.1');
        version = '0.5.1';
        await page.goto(origin + '/?reset=second');
        assert.equal(await page.evaluate(() => window.loadedVersion), '0.4.1');
        assert.equal(cdnRequests, 1, 'fresh short URL still reuses the old cached CDN body');

        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Page.reload', { ignoreCache: true });
        await page.waitForFunction(() => window.loadedVersion === '0.5.1');
        assert.equal(cdnRequests, 2);
        await page.goto(origin + '/?reset=third');
        assert.equal(await page.evaluate(() => window.loadedVersion), '0.5.1');
        assert.equal(cdnRequests, 2, 'hard refresh repairs cached entry for subsequent regular starts');
        console.log('OK: stripped redirect query retains old 7-day client cache; hard reload updates it without a new URL.');
    } finally {
        await browser.close();
    }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => server.close());
