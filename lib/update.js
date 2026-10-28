/*
 * Is there a newer LiveGenie? Reads the version number from package.json on GitHub,
 * a few seconds after start and every six hours. It only reads; it never changes anything.
 * Turn it off with LIVEGENIE_NO_UPDATE_CHECK=1.
 */
'use strict';

const https = require('https');
const http = require('http');

const URL_DEFAULT = 'https://raw.githubusercontent.com/leonidis2013/LiveGenie/main/package.json';
const IMAGE = 'ghcr.io/leonidis2013/livegenie';

function newer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

function create(current, opts = {}) {
  const url = opts.url || process.env.LIVEGENIE_UPDATE_URL || URL_DEFAULT;
  const enabled = opts.enabled !== undefined ? opts.enabled : process.env.LIVEGENIE_NO_UPDATE_CHECK !== '1';
  let state = { latest: '', checkedAt: 0, failed: false };

  function check() {
    if (!enabled) return Promise.resolve(false);
    return new Promise((resolve) => {
      let done = false;
      const end = (latest) => {
        if (done) return; done = true;
        state = latest ? { latest, checkedAt: Date.now(), failed: false } : { latest: state.latest, checkedAt: Date.now(), failed: true };
        resolve(!!latest);
      };
      try {
        const lib = url.startsWith('https:') ? https : http;
        const req = lib.get(url, { timeout: 6000, headers: { 'user-agent': 'LiveGenie/' + current } }, (res) => {
          if (res.statusCode !== 200) { res.resume(); return end(null); }
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (d) => { raw += d; if (raw.length > 20000) req.destroy(); });
          res.on('end', () => {
            try { const v = String(JSON.parse(raw).version || ''); end(/^\d+\.\d+\.\d+$/.test(v) ? v : null); }
            catch (e) { end(null); }
          });
        });
        req.on('timeout', () => req.destroy());
        req.on('error', () => end(null));
      } catch (e) { end(null); }
    });
  }

  function start() {
    if (!enabled) return;
    setTimeout(check, 3000).unref();
    setInterval(check, 6 * 3600 * 1000).unref();
  }

  function info() {
    return {
      enabled,
      current,
      latest: state.latest,
      available: !!state.latest && newer(state.latest, current),
      checkedAt: state.checkedAt,
      failed: state.failed,
      image: IMAGE + ':' + (state.latest || current)
    };
  }

  return { check, start, info };
}

module.exports = { create, newer };
