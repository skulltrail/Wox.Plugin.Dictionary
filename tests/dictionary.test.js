const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPlugin, expandTemplate } = require('../src/index');
const free = [
  {
    word: 'hello',
    phonetic: '/həˈləʊ/',
    meanings: [
      {
        partOfSpeech: 'noun',
        definitions: [{ definition: 'A greeting.', example: 'She said hello.' }],
      },
    ],
    sourceUrls: ['https://en.wiktionary.org/wiki/hello'],
    license: {
      name: 'CC BY-SA 3.0',
      url: 'https://creativecommons.org/licenses/by-sa/3.0',
    },
  },
];
const api = (settings = {}) => ({
  GetSetting: async (_, key) => settings[key] || '',
  Copy: async () => {},
});
const response = (body, status = 200) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});
const fallback = {
  word: 'hello',
  entries: [
    {
      partOfSpeech: 'noun',
      pronunciations: [{ type: 'ipa', text: '/həˈləʊ/' }],
      senses: [
        {
          definition: 'A greeting.',
          examples: ['She said hello.'],
          subsenses: [{ definition: 'A more specific greeting.', subsenses: [] }],
        },
      ],
    },
  ],
  source: {
    url: 'https://en.wiktionary.org/wiki/hello',
    license: { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  },
};

test('falls back when the default source fails and shows attribution', async () => {
  for (const failure of [403, 429, 500, 'network', 'invalid']) {
    const calls = [];
    const plugin = createPlugin(async (url) => {
      calls.push(url);
      if (url.includes('dictionaryapi.dev')) {
        if (failure === 'network') throw new Error('offline');
        return failure === 'invalid' ? response({}) : response({}, failure);
      }
      return response(fallback);
    });
    await plugin.init({}, { API: api() });
    const results = (await plugin.query({}, { Search: 'hello' })).Results;
    const result = results[0];
    assert.equal(calls[1], 'https://freedictionaryapi.com/api/v1/entries/en/hello');
    assert.equal(result.Title, 'A greeting.');
    assert.match(result.SubTitle, /FreeDictionaryAPI\.com/);
    assert.match(result.SubTitle, /həˈləʊ.*noun/);
    assert.match(result.SubTitle, /She said hello/);
    assert.match(result.SubTitle, /https:\/\/en\.wiktionary\.org\/wiki\/hello/);
    assert.match(result.SubTitle, /CC BY-SA 4\.0/);
    assert.match(result.SubTitle, /https:\/\/creativecommons\.org\/licenses\/by-sa\/4\.0\//);
    assert.equal(result.Preview.PreviewType, 'markdown');
    assert.match(
      result.Preview.PreviewData,
      /\[Wiktionary\]\(https:\/\/en\.wiktionary\.org\/wiki\/hello\)/,
    );
    assert.match(
      result.Preview.PreviewData,
      /\[FreeDictionaryAPI\.com\]\(https:\/\/freedictionaryapi\.com\/\)/,
    );
    assert.equal(results[1].Title, 'A more specific greeting.');
  }
});

test('preserves the primary error if the fallback fails', async () => {
  for (const fallbackResponse of [response({}, 500), response({ entries: [] })]) {
    const plugin = createPlugin(async (url) =>
      url.includes('dictionaryapi.dev') ? response({}, 403) : fallbackResponse,
    );
    await plugin.init({}, { API: api() });
    const result = (await plugin.query({}, { Search: 'hello' })).Results[0];
    assert.equal(result.Title, 'Dictionary access forbidden');
    assert.match(result.SubTitle, /Free Dictionary API.*403/);
  }
});

test('does not send custom-source failures to the fallback', async () => {
  const calls = [];
  const plugin = createPlugin(async (url) => {
    calls.push(url);
    return response({}, 403);
  });
  await plugin.init(
    {},
    {
      API: api({
        default_source: 'Custom',
        custom_sources: JSON.stringify([{ name: 'Custom', url: 'https://example.com/{query}' }]),
      }),
    },
  );
  await plugin.query({}, { Search: 'hello' });
  assert.deepEqual(calls, ['https://example.com/hello']);
});

test('does not start a fallback for a superseded request', async () => {
  let resolveOld;
  const calls = [];
  const plugin = createPlugin((url) => {
    calls.push(url);
    return url.endsWith('/old')
      ? new Promise((resolve) => {
          resolveOld = resolve;
        })
      : Promise.resolve(response(free));
  });
  await plugin.init({}, { API: api() });
  const old = plugin.query({}, { Search: 'old' });
  await new Promise((resolve) => setImmediate(resolve));
  await plugin.query({}, { Search: 'hello' });
  resolveOld(response({}, 403));
  assert.deepEqual(await old, { Results: [] });
  assert.equal(calls.length, 2);
});

test('encodes query and rejects unsafe custom URLs', () => {
  assert.equal(
    expandTemplate('https://example.com/?q={query}', 'café & tea'),
    'https://example.com/?q=caf%C3%A9%20%26%20tea',
  );
  for (const template of [
    'http://example.com/{query}',
    'https://example.com/',
    'https://example.com/{query}/{query}',
    'https://{query}.example.com/',
    'https://user:pass@example.com/{query}',
  ])
    assert.throws(() => expandTemplate(template, 'hello'));
});

test('shows definitions, pronunciation, source, example and attribution in Wox', async () => {
  const urls = [];
  const plugin = createPlugin(async (url) => {
    urls.push(url);
    return response(free);
  });
  await plugin.init({}, { API: api() });
  const result = (await plugin.query({}, { Search: 'hello' })).Results[0];
  assert.match(urls[0], /dictionaryapi\.dev.*hello/);
  assert.match(result.Title, /A greeting/);
  assert.match(result.SubTitle, /noun.*Free Dictionary API/);
  assert.equal(result.Preview.PreviewType, 'markdown');
  assert.match(result.Preview.PreviewData, /A greeting\./);
  assert.match(result.Preview.PreviewData, /She said hello\./);
  assert.match(result.SubTitle, /həˈləʊ/);
  assert.match(result.SubTitle, /She said hello/);
  assert.match(result.SubTitle, /wiktionary/);
  assert.match(result.SubTitle, /CC BY-SA 3.0/);
});

test('shows the full definition in the preview and copies it with the default action', async () => {
  const copied = [];
  const definition = 'A long definition with [special](https://example.com) characters.';
  const data = [
    { ...free[0], meanings: [{ partOfSpeech: 'noun', definitions: [{ definition }] }] },
  ];
  const plugin = createPlugin(async () => response(data));
  await plugin.init({}, { API: { ...api(), Copy: async (_, value) => copied.push(value) } });
  const result = (await plugin.query({}, { Search: 'hello' })).Results[0];
  assert.match(result.Preview.PreviewData, /A long definition/);
  assert.match(result.Preview.PreviewData, /\\\[special\\\]/);
  assert.equal(result.Actions[0].IsDefault, true);
  await result.Actions[0].Action({});
  assert.deepEqual(copied, [{ type: 'text', text: definition }]);
});

test('supports custom API sources using Free Dictionary response format', async () => {
  let requested;
  const plugin = createPlugin(async (url) => {
    requested = url;
    return response(free);
  });
  await plugin.init(
    {},
    {
      API: api({
        default_source: 'Custom',
        custom_sources: JSON.stringify([{ name: 'Custom', url: 'https://example.com/{query}' }]),
      }),
    },
  );
  const results = (await plugin.query({}, { Search: 'café' })).Results;
  assert.equal(requested, 'https://example.com/caf%C3%A9');
  assert.match(results[0].Title, /A greeting/);
});

test('reports not found and service errors without leaking request details', async () => {
  for (const [status, expected] of [
    [404, /No definitions/],
    [429, /limit/i],
    [403, /access/i],
    [500, /unavailable/i],
  ]) {
    const plugin = createPlugin(async () => response({}, status));
    await plugin.init({}, { API: api() });
    assert.match((await plugin.query({}, { Search: 'unknown' })).Results[0].Title, expected);
  }
});

test('distinguishes authentication from forbidden access and identifies the selected source', async () => {
  for (const [status, title] of [
    [401, 'Dictionary authentication required'],
    [403, 'Dictionary access forbidden'],
  ]) {
    const plugin = createPlugin(async () => response({}, status));
    await plugin.init(
      {},
      {
        API: api({
          default_source: 'Custom dictionary',
          custom_sources: JSON.stringify([
            { name: 'Custom dictionary', url: 'https://example.com/{query}' },
          ]),
        }),
      },
    );
    const result = (await plugin.query({}, { Search: 'hello' })).Results[0];
    assert.equal(result.Title, title);
    assert.match(result.SubTitle, /Custom dictionary/);
    assert.match(result.SubTitle, new RegExp(String(status)));
  }
});

test('old requests cannot replace newer results', async () => {
  let resolveOld;
  const plugin = createPlugin((url) =>
    url.endsWith('/old')
      ? new Promise((resolve) => {
          resolveOld = resolve;
        })
      : Promise.resolve(response(free)),
  );
  await plugin.init({}, { API: api() });
  const old = plugin.query({}, { Search: 'old' });
  await new Promise((resolve) => setImmediate(resolve));
  const latest = await plugin.query({}, { Search: 'hello' });
  resolveOld(response(free));
  assert.match(latest.Results[0].Title, /A greeting/);
  assert.deepEqual((await old).Results, []);
});

test('offers spelling suggestions after a missing entry and searches the selected word', async () => {
  const changes = [];
  const calls = [];
  const plugin = createPlugin(async (url) => {
    calls.push(url);
    return url.includes('dictionaryapi.dev')
      ? response({}, 404)
      : response({ query: { searchinfo: { suggestion: 'rendezvous' } } });
  });
  await plugin.init(
    {},
    { API: { ...api(), ChangeQuery: async (_, query) => changes.push(query) } },
  );
  const result = (await plugin.query({}, { Search: 'rendevous' })).Results[0];
  assert.match(result.Title, /rendezvous/);
  assert.match(calls[1], /en\.wikipedia\.org\/w\/api\.php/);
  assert.equal(new URL(calls[1]).searchParams.get('srsearch'), 'rendevous');
  await result.Actions[0].Action({});
  assert.deepEqual(changes, [{ QueryType: 'input', QueryText: 'define rendezvous' }]);
});

test('preserves no-results state when suggestions are unavailable', async () => {
  const plugin = createPlugin(async (url) => {
    if (url.includes('dictionaryapi.dev')) return response({}, 404);
    throw new Error('offline');
  });
  await plugin.init({}, { API: api() });
  assert.match((await plugin.query({}, { Search: 'unknown' })).Results[0].Title, /No definitions/);
});

test('does not retry Wikipedia while rate limited', async () => {
  let suggestions = 0;
  const plugin = createPlugin(async (url) => {
    if (url.includes('dictionaryapi.dev')) return response({}, 404);
    suggestions++;
    return { ...response({}, 429), headers: { get: () => '60' } };
  });
  await plugin.init({}, { API: api() });
  assert.match((await plugin.query({}, { Search: 'unknown' })).Results[0].Title, /No definitions/);
  await plugin.query({}, { Search: 'unknown again' });
  assert.equal(suggestions, 1);
});

test('no-definition rows have an inert default action instead of pinning', async () => {
  const plugin = createPlugin(async () => response({}, 404));
  await plugin.init({}, { API: api() });
  const row = (await plugin.query({}, { Search: 'word-that-does-not-exist' })).Results[0];
  assert.equal(row.Title, 'No definitions found');
  assert.equal(row.Actions[0].IsDefault, true);
  assert.equal(row.Actions[0].PreventHideAfterAction, true);
  await row.Actions[0].Action({});
});
