/*
 * Siaivo Dorama permanent loader v1.
 * Keep this entry URL stable; release changes belong in siaivo-dorama.js.
 */
(function () {
    'use strict';

    var FLAG = '__siaivo_dorama_loader_state';
    var CACHE_KEY = 'siaivo_dorama_loader_code_v1';
    var ROOT = 'Lamp1ch-chmuk/dorami-Siaivo';
    var RAW = 'https://raw.githubusercontent.com/' + ROOT + '/main/siaivo-dorama.js';
    var CDN = 'https://cdn.jsdelivr.net/gh/' + ROOT + '@main/siaivo-dorama.js';

    if (window[FLAG] === 'loading' || window[FLAG] === 'loaded' || window.__siaivo_dorama_started) return;
    window[FLAG] = 'loading';

    function warn(message) {
        if (window.console && window.console.warn) {
            try { window.console.warn('[Siaivo Dorama loader] ' + message); } catch (error) {}
        }
    }

    function valid(code) {
        return typeof code === 'string' && code.length < 512000 &&
            code.indexOf('Siaivo Dorama for Lampa 3.x / Siaivo') !== -1 &&
            code.indexOf("var PLUGIN_ID = 'siaivo_dorama';") !== -1 &&
            /Version:\s*\d+\.\d+\.\d+/.test(code);
    }

    function cachedCode() {
        try { return window.localStorage.getItem(CACHE_KEY); } catch (error) { return ''; }
    }

    function install(code) {
        if (!valid(code)) return false;
        try {
            // Same inline-script technique used by Lampa's own cached plugin loader.
            var script = document.createElement('script');
            script.type = 'text/javascript';
            script.text = code;
            (document.head || document.body || document.documentElement).appendChild(script);
            window[FLAG] = 'loaded';
            try {
                if (cachedCode() !== code) window.localStorage.setItem(CACHE_KEY, code);
            } catch (storageError) { /* Quota/privacy restrictions must not block the plugin. */ }
            return true;
        } catch (error) {
            return false;
        }
    }

    function fetchCode(url, complete, failed) {
        var request;
        var timer;
        var done = false;

        function finish(success) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            if (request) {
                request.onload = request.onerror = request.ontimeout = request.onabort = null;
            }
            if (success) return complete(request.responseText);
            if (request) {
                try { request.abort(); } catch (error) {}
            }
            failed();
        }

        try {
            request = new XMLHttpRequest();
            // Do not forward the email/origin/reset arguments added to the short URL by Lampa.
            request.open('GET', url + '?siaivo_dorama_refresh=' + new Date().getTime(), true);
            request.onload = function () { finish(request.status === 200 && valid(request.responseText)); };
            request.onerror = request.ontimeout = request.onabort = function () { finish(false); };
            request.timeout = 10000;
            // The timer also bounds old TV implementations that ignore XHR.timeout.
            timer = setTimeout(function () { finish(false); }, 12000);
            request.send();
        } catch (error) {
            finish(false);
        }
    }

    function unavailable() {
        window[FLAG] = 'failed';
        warn('Could not load the plugin. Check the connection and restart Siaivo.');
        if (window.Lampa && Lampa.Noty && typeof Lampa.Noty.show === 'function') {
            Lampa.Noty.show('Не вдалося завантажити Дорами. Перевірте інтернет і перезапустіть Siaivo.');
        }
    }

    function fallback() {
        if (install(cachedCode())) {
            warn('Update unavailable; using the last saved version.');
            return;
        }
        // First installation can use the regular CDN if GitHub Raw is unreachable.
        fetchCode(CDN, function (code) {
            if (!install(code)) unavailable();
        }, unavailable);
    }

    fetchCode(RAW, function (code) {
        if (!install(code)) fallback();
    }, fallback);
}());
