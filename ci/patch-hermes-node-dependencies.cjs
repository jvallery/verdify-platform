const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const cache = mkdtempSync(join(tmpdir(), 'hermes-npm-'));
const npmOptions = [
  '--cache', cache, '--install-links=false', '--ignore-scripts', '--no-audit', '--no-fund',
];

function packageLock(directory) {
  const lock = JSON.parse(readFileSync(join(directory, 'package-lock.json')));
  assert.equal(lock.lockfileVersion, 3);
  return lock.packages;
}

function patch(directory, replacements) {
  const npm = (...args) => execFileSync('npm', args, { cwd: directory, stdio: 'inherit' });
  const baseline = packageLock(directory);
  const names = new Set(replacements.map(([name]) => `node_modules/${name}`));
  const verifyLock = () => {
    const lock = packageLock(directory);
    for (const [name, version, integrity] of replacements) {
      const entry = lock[`node_modules/${name}`];
      assert.equal(entry.version, version, name);
      assert.equal(entry.integrity, `sha512-${integrity}`, name);
      assert.equal(entry.resolved, `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`);
    }
    for (const [path, entry] of Object.entries(baseline)) {
      if (!names.has(path)) assert.deepEqual(lock[path], entry, path);
    }
    for (const path of Object.keys(lock)) {
      if (Object.hasOwn(baseline, path) || names.has(path)) continue;
      // npm 9 may materialize bundled dependencies of this existing optional WASM package.
      assert(path.startsWith('node_modules/@tailwindcss/oxide-wasm32-wasi/node_modules/'), path);
      assert.equal(lock[path].inBundle, true, path);
    }
  };

  npm('pkg', 'set', ...replacements.map(([name, version]) => `overrides.${name}=${version}`));
  npm('install', '--package-lock-only', ...npmOptions);
  verifyLock();
  npm('install', ...npmOptions);
  verifyLock();
  npm('ls', ...replacements.map(([name]) => name));
}

try {
  patch('/opt/hermes', [
    ['proxy-addr', '2.0.8', '5nnx0yGyVUcY6t9RnWcARWtwT9F1D8O9rt08htPvnd49W1IgZtmLkhu9WfMzQj1cFxjHIO6connUNVW5k7AVyQ=='],
  ]);
  patch('/opt/hermes/web', [
    ['sanitize-html', '2.17.4', '2HW7v2ol/uAM7sX4hbD8Z59OGWmAPrvjL8E71UWlBcj6m+kcF6ilQBLny+cIgY214QJeJT5tQuxKKqX0SQqjGQ=='],
    ['launder', '1.7.1', 'mU6WRz5EusL9ZZuiZ5SO4Y6C0P9PAUR9iwdb6bzj4KDihm28DiHFw+/yk9DBH4f+Pv1wuzQ4e2jV3oQ7mkIqvw=='],
    ['dayjs', '1.11.23', 'QDTCU0M0MxR3hQfnlDJfwekQiaanm1ubOD231u73WBckQ/fsamwRLiE2GBz6D3a/xF1NgfiDLJjXBa1hYOYTtQ=='],
  ]);

  // Vite empties HERMES_WEB_DIST and rebundles the sanitizer into the served assets.
  execFileSync('npm', ['run', 'build'], { cwd: '/opt/hermes/web', stdio: 'inherit' });
} finally {
  rmSync(cache, { recursive: true, force: true });
}
