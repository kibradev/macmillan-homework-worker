import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiProvider, scoreGeminiModel } from '../src/ai/gemini';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('scoreGeminiModel - prefers stable flash-lite over pro and preview builds', () => {
  const ids = ['gemini-2.5-pro', 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
  assert.deepEqual(ids.sort((a, b) => scoreGeminiModel(b) - scoreGeminiModel(a)), [
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-3-flash-preview',
    'gemini-2.5-pro',
  ]);
});

test('Gemini - falls back to a usable model when the requested one is closed to new users', async () => {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/models?pageSize')) {
      return json(200, {
        models: [
          { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        ],
      });
    }
    if (url.includes('/models/gemini-old-lite:generateContent')) {
      return json(404, { error: { message: 'This model models/gemini-old-lite is no longer available to new users.' } });
    }
    if (url.includes('/models/gemini-2.5-flash-lite:generateContent')) {
      return json(200, { candidates: [{ content: { parts: [{ text: 'OK' }] } }] });
    }
    return json(500, { error: { message: 'unexpected ' + url } });
  }) as typeof fetch;

  try {
    const result = await new GeminiProvider().testConnection('test-key', 'gemini-old-lite');
    assert.equal(result.success, true);
    assert.match(result.message, /gemini-2\.5-flash-lite/);
    assert.ok(calls.some((c) => c.includes('/models?pageSize')));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Gemini - does not retry on unrelated errors such as an invalid API key', async () => {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return json(400, { error: { message: 'API key not valid. Please pass a valid API key.' } });
  }) as typeof fetch;

  try {
    const result = await new GeminiProvider().testConnection('bad-key', 'gemini-2.5-flash-lite');
    assert.equal(result.success, false);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});
