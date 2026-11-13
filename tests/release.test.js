const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('release workflow handles an absent PR output', () => {
  const workflow = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
  const expressions = workflow.match(/fromJSON\(steps\.release\.outputs\.pr[^)]*\)/g) || [];
  assert.equal(expressions.length, 2);
  for (const expression of expressions) assert.match(expression, /\|\| '\{\}'/);
});

test(
  'release formatting commits and pushes changes only when needed',
  { skip: process.platform === 'win32' },
  (t) => {
    const root = process.cwd();
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dictionary-release-'));
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    const repo = path.join(temp, 'repo');
    const remote = path.join(temp, 'remote.git');
    const tools = path.join(temp, 'tools');
    fs.mkdirSync(repo);
    fs.mkdirSync(tools);
    fs.writeFileSync(path.join(tools, 'gh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(repo, 'node_modules'));
    fs.copyFileSync(path.join(root, '.prettierrc.json'), path.join(temp, 'release-prettier.json'));
    const env = {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      PATH: `${tools}${path.delimiter}${process.env.PATH}`,
      RUNNER_TEMP: temp,
      RELEASE_BRANCH: 'release-test',
    };
    const run = (command, args, cwd = repo) =>
      execFileSync(command, args, {
        cwd,
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    run('git', ['init', '--bare', remote], temp);
    run('git', ['init', repo], temp);
    run('git', ['config', 'user.name', 'Test']);
    run('git', ['config', 'user.email', 'test@example.org']);
    run('git', ['remote', 'add', 'origin', remote]);
    fs.writeFileSync(path.join(repo, '.release-please-manifest.json'), '{".":"0.2.0"}\n');
    fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), '# Changelog\n\n* Fix a thing\n');
    fs.writeFileSync(path.join(repo, 'plugin.json'), '{"Version":"0.2.0","Name":"Dictionary"}\n');
    run('git', ['add', '.release-please-manifest.json', 'CHANGELOG.md', 'plugin.json']);
    run('git', ['commit', '-m', 'generated release']);
    const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
    const step = workflow
      .split('      - name: Format release files\n')[1]
      .split('        run: |\n')[1]
      .split('      - uses:')[0];
    const script = step
      .split('\n')
      .map((line) => line.slice(10))
      .join('\n');
    run('bash', ['-e', '-c', script]);
    const commit = run('git', ['rev-parse', 'HEAD']);
    assert.equal(run('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/release-test']), commit);
    run(path.join(root, 'node_modules/.bin/prettier'), [
      '--config',
      path.join(temp, 'release-prettier.json'),
      '--check',
      '.release-please-manifest.json',
      'CHANGELOG.md',
      'plugin.json',
    ]);
    run('bash', ['-e', '-c', script]);
    assert.equal(run('git', ['rev-parse', 'HEAD']), commit);
  },
);
