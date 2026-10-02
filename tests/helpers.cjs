'use strict';

const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync(require.resolve('../siaivo-dorama.js'), 'utf8');

// Models Progress + partNext: task-index ordering and backfill below 3 rows.
function partNext(parts, limit, loaded, empty) {
    const tasks = parts.filter(p => typeof p === 'function').slice(0, limit);
    if (!tasks.length) return empty();
    const results = new Array(tasks.length);
    let pending = tasks.length;
    function done(index, result) {
        results[index] = result;
        if (--pending) return;
        tasks.forEach(task => { parts[parts.indexOf(task)] = false; });
        const data = results.filter(r => r && r.results && r.results.length);
        if (!data.length) return partNext(parts, limit, loaded, empty);
        if (data.length < 3) return partNext(parts, limit, more => loaded(data.concat(more)), () => loaded(data));
        loaded(data);
    }
    tasks.forEach((task, i) => {
        try { task(result => done(i, result)); }
        catch (error) { done(i); }
    });
}

function harness(options = {}) {
    const state = {
        items: [], listeners: {}, timers: [], requests: [], routes: [], warnings: [],
        now: options.now || '2026-10-01T16:30:00Z'
    };
    const root = { find(selector) {
        const action = selector.match(/data-action="([^"]+)"/)[1];
        return state.items.find(item => item.attrs['data-action'] === action) || { length: 0, first() { return this; } };
    }};
    function button(title, action) {
        return { title, action, attrs: {}, length: 1,
            first() { return this; },
            attr(name, value) {
                if (arguments.length === 1) return this.attrs[name];
                this.attrs[name] = value; return this;
            }
        };
    }
    const response = page => ({ page, total_pages: 8, total_results: 160,
        results: [{ id: 1, name: 'Test Drama', original_name: 'Test Drama', source: 'foreign' }] });
    function request(kind, url, params, ok, error, cache) {
        const call = { kind, url, params, ok, error, cache };
        state.requests.push(call);
        if (options.respond) options.respond(call, state);
        else ok(response(params.page));
    }
    const lampa = {
        Api: {
            sources: { tmdb: { get(url, params, ok, error, cache) { request('row', url, params, ok, error, cache); } } },
            partNext,
            list(params, ok, error) { request('list', params.url, params, ok, error); }
        },
        Menu: {
            render() { return root; },
            addButton(icon, title, action) { const b = button(title, action); state.items.push(b); return b; }
        },
        Router: { call(name, data) { state.routes.push({ name, data }); } },
        Listener: { follow(name, callback) { (state.listeners[name] ||= []).push(callback); } }
    };
    function Clock(...args) { return args.length ? new Date(...args) : new Date(state.now); }
    Clock.prototype = Date.prototype;
    const context = vm.createContext({
        Lampa: lampa, Date: Clock,
        window: { Lampa: lampa, appready: options.ready !== false,
            console: { log() {}, warn(message) { state.warnings.push(message); } } },
        setTimeout(fn) { state.timers.push(fn); }
    });
    state.run = () => vm.runInContext(code, context, { filename: 'siaivo-dorama.js' });
    state.emit = (name, event) => (state.listeners[name] || []).forEach(fn => fn(event));
    state.tick = () => state.timers.shift()?.();
    state.source = () => lampa.Api.sources.plugin_siaivo_dorama;
    return { state, lampa, context, root, button, response };
}

module.exports = { harness, code };
