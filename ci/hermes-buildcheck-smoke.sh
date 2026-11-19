#!/bin/sh
set -eu

venv=/opt/hermes/.venv/bin
test -x /usr/bin/tini
test -x "$venv/hermes"
bash -n /opt/hermes/docker/entrypoint.sh
"$venv/python" - <<'PY'
from importlib.metadata import version
import anyio, certifi, jwt
assert tuple(map(version, ('PyJWT', 'anyio', 'certifi'))) == ('2.14.0', '4.14.2', '2026.10.18')
PY
uv --no-cache pip check --python "$venv/python"
uv --version | grep -Eq '^uv 0[.]13[.]7( |$)'
uvx --version | grep -Eq '^uvx 0[.]13[.]7( |$)'
gosu --version | grep -Eq '^1[.]19 [(]go1[.]27[.]4 '
test "$(gosu nobody id -u)" = "$(id -u nobody)"
test -s /opt/hermes/hermes_cli/web_dist/index.html

node <<'JS'
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = '/opt/hermes';
const trust = require(root + '/node_modules/proxy-addr').compile(['loopback']);
assert(trust('127.0.0.1'));
assert(!trust('192.0.2.1'));
const sanitize = require(root + '/web/node_modules/sanitize-html');
assert.equal(sanitize('<p>Hello</p>'), '<p>Hello</p>');
for (const [dir, version] of [
  ['ui-tui', '0.27.7'],
  ['ui-tui/packages/hermes-ink', '0.25.12'],
  ['web', '0.27.7']
]) {
  const modules = root + '/' + dir + '/node_modules';
  for (const executable of [
    modules + '/esbuild/bin/esbuild',
    modules + '/@esbuild/linux-' + process.arch + '/bin/esbuild'
  ]) {
    assert.equal(execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim(), version);
  }
  const esbuild = require(modules + '/esbuild');
  assert.equal(esbuild.version, version);
  assert(esbuild.transformSync('const result = 42;', { loader: 'js' }).code.includes('42'));
}
JS
