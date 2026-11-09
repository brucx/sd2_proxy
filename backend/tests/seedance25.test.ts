import assert from 'node:assert/strict';
import { test } from 'node:test';

// Isolate tests from deployment overrides; all upstream calls below are mocked.
process.env.JWT_SECRET = 'test-only';
delete process.env.MODEL_MAPPING;
delete process.env.ARK_MODEL_MAPPING;
const { config } = await import('../src/config.js');
const { calculateCost } = await import('../src/utils/cost.util.js');
const { normalizeModelFamily, isFastModel, lookupArkPricePerMillion, reverseTokensFromCost } = await import('../src/utils/arkPricing.util.js');
const { meituProvider } = await import('../src/providers/meitu.provider.js');
const { arkProvider } = await import('../src/providers/ark.provider.js');

const aliases = ['doubao-seedance-2-5', 'doubao-seedance-2-5-260628', 'doubao-seedance-2.5', 'doubao-seedance-2.5-260628'];

test('2.5 aliases have consistent pricing and token reverse conversion on both channels', () => {
  for (const model of aliases) {
    assert.equal(normalizeModelFamily(model), '2.5');
    assert.equal(isFastModel(model), false);
    for (const [quality, hasVideo, expected] of [
      ['480p', false, 70], ['720p', false, 70], ['1080p', false, 77],
      ['480p', true, 42], ['720p', true, 42], ['1080p', true, 46],
    ] as const) {
      assert.equal(lookupArkPricePerMillion({ model, quality, hasVideo }), expected);
      for (const provider of ['meitu', 'ark']) {
        assert.equal(calculateCost(provider, { model, quality, hasVideo, completionTokens: 100_000 }), (expected / 10).toFixed(6));
      }
      assert.equal(reverseTokensFromCost({ costYuan: expected / 10, model, quality, hasVideo }), 100_000);
    }
  }
});

test('existing 2.0 pricing and fast resolution classification remain intact', () => {
  assert.equal(calculateCost('meitu', { model: 'doubao-seedance-2-0-260128', completionTokens: 1_000_000 }), '46.000000');
  assert.equal(calculateCost('ark', { model: 'doubao-seedance-2-0-fast-260128', completionTokens: 1_000_000, hasVideo: true }), '22.000000');
  assert.equal(isFastModel('doubao-seedance-2-0-fast-260128'), true);
  assert.equal(lookupArkPricePerMillion({ model: 'doubao-seedance-2-0-fast-260128', quality: '1080p', hasVideo: false }), 0);
});

test('Meitu and Ark submit mapped 2.5 models and preserve native parameters', async () => {
  const originalFetch = globalThis.fetch;
  let submitted: any;
  let requestedUrl = '';
  globalThis.fetch = (async (url, init) => {
    requestedUrl = String(url);
    submitted = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: 'upstream-test-id' }), { status: 200 });
  }) as typeof fetch;
  try {
    for (const model of aliases) {
      const body = { model, content: [{ type: 'text', text: 'test' }], duration: 30, resolution: '1080p', omni_reference_task_type: 'reference' };
      for (const [provider, expectedModel, expectedUrl] of [
        [meituProvider, 'ep-20260806152205-qvvvg', `${config.UPSTREAM_URL}/api/v1/doubao/create`],
        [arkProvider, 'doubao-seedance-2-5-260628', `${config.ARK_URL}/api/v3/contents/generations/tasks`],
      ] as const) {
        const result = await provider.createTask(body, model);
        assert.equal(requestedUrl, expectedUrl);
        assert.deepEqual(submitted, { ...body, model: expectedModel });
        assert.equal(result.upstreamTaskId, 'upstream-test-id');
        assert.equal(result.arkResponse.model, model);
        assert.equal(body.model, model);
      }
      assert.equal(config.EVOLINK_MODEL_BASE[model], undefined);
      assert.equal(config.AIVIDEO_MODEL_MAPPING[model], undefined);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
