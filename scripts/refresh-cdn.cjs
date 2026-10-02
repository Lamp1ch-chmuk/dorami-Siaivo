'use strict';

// Run after regression tests, from the exact main revision being published.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const prefix = '/gh/Lamp1ch-chmuk/dorami-Siaivo@main/';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function get(url) {
    return execFileSync('curl', ['--fail', '--silent', '--show-error', '--retry', '2', '--retry-delay', '2',
        '--connect-timeout', '5', '--max-time', '15', '--retry-max-time', '30', url], { maxBuffer: 1024 * 1024 });
}

async function main() {
    for (const file of ['d.js', 'siaivo-dorama.js']) {
        const expected = fs.readFileSync(path.join(root, file));
        const url = 'https://cdn.jsdelivr.net' + prefix + file;
        try {
            if (expected.equals(get(url))) {
                console.log('CDN already current: ' + file);
                continue;
            }
        } catch (error) { /* A cold/missing cache can be refreshed below. */ }
        const result = JSON.parse(get('https://purge.jsdelivr.net' + prefix + file));
        if (result.status !== 'finished') throw new Error('CDN purge did not finish for ' + file);
        let verified = false;
        for (let attempt = 0; attempt < 12; attempt++) {
            try {
                if (expected.equals(get(url))) {
                    verified = true;
                    break;
                }
            } catch (error) {
                if (attempt === 11) throw error;
            }
            if (attempt < 11) await pause(10000);
        }
        if (!verified) throw new Error('CDN still differs from the published ' + file + '; retry the workflow');
        console.log('Verified current CDN bytes: ' + file);
    }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
