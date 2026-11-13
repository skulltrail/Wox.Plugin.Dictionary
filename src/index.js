const icon = { ImageType: 'relative', ImageData: 'images/icon.svg' };
const builtins = [
  {
    name: 'Free Dictionary API',
    url: 'https://api.dictionaryapi.dev/api/v2/entries/en/{query}',
  },
];

function expandTemplate(template, query) {
  if (typeof template !== 'string' || template.split('{query}').length !== 2)
    throw new Error('Use exactly one {query} placeholder.');
  const marker = 'woxdictionaryqueryplaceholder';
  const url = new URL(template.replace('{query}', marker));
  if (url.protocol !== 'https:' || url.username || url.password || url.hostname.includes(marker))
    throw new Error('Use an HTTPS URL without credentials; {query} must be in the path or query.');
  return template.replace('{query}', encodeURIComponent(query));
}

function parseFree(data) {
  if (!Array.isArray(data)) throw new Error('invalid response');
  return data.flatMap((entry) =>
    (entry.meanings || []).flatMap((meaning) =>
      (meaning.definitions || [])
        .filter((item) => typeof item.definition === 'string')
        .map((item) => ({
          word: entry.word,
          pronunciation: entry.phonetic || entry.phonetics?.find((p) => p.text)?.text,
          part: meaning.partOfSpeech,
          definition: item.definition,
          example: item.example,
          sourceUrl: entry.sourceUrls?.[0],
          license: entry.license,
        })),
    ),
  );
}

function createPlugin(fetcher = fetch) {
  let api;
  let sequence = 0;
  let suggestionsBlockedUntil = 0;
  const message = (title, subtitle) => ({
    Results: [{ Title: title, SubTitle: subtitle, Icon: icon, Actions: [] }],
  });
  return {
    async init(_ctx, params) {
      api = params.API;
    },
    async query(ctx, query) {
      const current = ++sequence;
      const search = (query.Search || '').trim();
      if (!search) return message('Enter a word or phrase', 'Definitions appear here in Wox');
      try {
        const [selected, custom] = await Promise.all([
          api.GetSetting(ctx, 'default_source'),
          api.GetSetting(ctx, 'custom_sources'),
        ]);
        if (current !== sequence) return { Results: [] };
        let sources;
        try {
          sources = JSON.parse(custom || '[]');
        } catch {
          return message('Check Dictionary settings', 'Custom sources must be a valid table.');
        }
        if (!Array.isArray(sources))
          return message('Check Dictionary settings', 'Custom sources must be a valid table.');
        const source = [...builtins, ...sources].find(
          (item) => item.name === (selected || 'Free Dictionary API'),
        );
        if (!source)
          return message('Check Dictionary settings', 'Select a supported dictionary source.');
        let url;
        try {
          url = expandTemplate(source.url, search);
        } catch {
          return message(
            'Check Dictionary settings',
            'Custom sources need a valid HTTPS API URL with one {query} placeholder.',
          );
        }
        const response = await fetcher(url, {
          signal: AbortSignal.timeout(5000),
          redirect: 'error',
        });
        if (current !== sequence) return { Results: [] };
        const noDefinitions = async () => {
          const fallback = message(
            'No definitions found',
            `No entry for “${search}” in ${source.name}.`,
          );
          fallback.Results[0].Actions = [
            {
              Name: 'No definition available',
              IsDefault: true,
              PreventHideAfterAction: true,
              Action: async () => {},
            },
          ];
          if (Date.now() < suggestionsBlockedUntil) return fallback;
          try {
            const params = new URLSearchParams({
              action: 'query',
              list: 'search',
              srsearch: search,
              srinfo: 'suggestion',
              srlimit: '1',
              format: 'json',
              formatversion: '2',
            });
            const suggestionResponse = await fetcher(
              `https://en.wikipedia.org/w/api.php?${params}`,
              {
                signal: AbortSignal.timeout(3000),
                redirect: 'error',
                headers: {
                  'User-Agent':
                    'Wox.Plugin.Dictionary/0.1 (https://github.com/skulltrail/Wox.Plugin.Dictionary)',
                },
              },
            );
            if (suggestionResponse.status === 429) {
              const retryAfter = suggestionResponse.headers.get('retry-after');
              const seconds = Number(retryAfter);
              const until =
                retryAfter && Number.isFinite(seconds)
                  ? Date.now() + seconds * 1000
                  : Date.parse(retryAfter);
              suggestionsBlockedUntil =
                Number.isFinite(until) && until > Date.now() ? until : Date.now() + 60000;
            }
            if (current !== sequence) return { Results: [] };
            if (!suggestionResponse.ok) return fallback;
            const suggestions = await suggestionResponse.json();
            if (current !== sequence) return { Results: [] };
            const word = suggestions?.query?.searchinfo?.suggestion;
            const results =
              typeof word === 'string' && word.trim() && word.toLowerCase() !== search.toLowerCase()
                ? [
                    {
                      Title: `Did you mean ${word}?`,
                      SubTitle:
                        'Wikipedia suggestion · Search this spelling in your selected dictionary',
                      Icon: icon,
                      Actions: [
                        {
                          Name: 'Look up word',
                          IsDefault: true,
                          PreventHideAfterAction: true,
                          Action: async (actionCtx) =>
                            api.ChangeQuery(actionCtx, {
                              QueryType: 'input',
                              QueryText: `${query.TriggerKeyword || 'define'} ${word}`,
                            }),
                        },
                      ],
                    },
                  ]
                : [];
            return results.length ? { Results: results } : fallback;
          } catch {
            return current === sequence ? fallback : { Results: [] };
          }
        };
        if (response.status === 404) return noDefinitions();
        if (response.status === 429)
          return message('Dictionary request limit reached', 'Try again later.');
        if (response.status === 401 || response.status === 403)
          return message('Dictionary access denied', 'Check the source access requirements.');
        if (!response.ok) return message('Dictionary unavailable', 'Try again later.');
        const data = await response.json();
        if (current !== sequence) return { Results: [] };
        const definitions = parseFree(data);
        if (!definitions.length) return noDefinitions();
        return {
          Results: definitions.map((entry) => {
            const detail = [entry.word, entry.pronunciation, entry.part]
              .filter(Boolean)
              .join(' · ');
            return {
              Title: entry.definition,
              SubTitle: [
                detail,
                source.name,
                entry.example && `Example: ${entry.example}`,
                entry.sourceUrl,
                entry.license?.name,
                entry.license?.url,
              ]
                .filter((value) => typeof value === 'string' && value)
                .join(' · '),
              Icon: icon,
              Actions: [
                {
                  Name: 'Copy definition',
                  IsDefault: true,
                  Action: async (actionCtx) =>
                    api.Copy(actionCtx, {
                      type: 'text',
                      text: entry.definition,
                    }),
                },
              ],
            };
          }),
        };
      } catch {
        if (current !== sequence) return { Results: [] };
        return message(
          'Dictionary unavailable',
          'Check your connection or source response and try again.',
        );
      }
    },
  };
}

module.exports = { plugin: createPlugin(), createPlugin, expandTemplate };
