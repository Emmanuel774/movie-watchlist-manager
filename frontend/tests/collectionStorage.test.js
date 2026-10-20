import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  GUEST_COLLECTION_STORAGE_KEY,
  mergeGuestCollection,
  readGuestCollection,
  writeGuestCollection,
} from '../src/collections/collectionStorage.js'

const createMemoryStorage = () => {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

test('guest collection persists locally and can be read back', () => {
  const storage = createMemoryStorage()
  const collection = [{ tmdbId: 42, title: 'Example', note: 'For later' }]
  writeGuestCollection(collection, storage)

  assert.equal(storage.getItem(GUEST_COLLECTION_STORAGE_KEY) !== null, true)
  assert.deepEqual(readGuestCollection(storage), { items: collection, error: '' })
})

test('failed guest merge preserves the local collection', async () => {
  const storage = createMemoryStorage()
  const items = [{ tmdbId: 42, title: 'Example' }]
  writeGuestCollection(items, storage)

  await assert.rejects(
    mergeGuestCollection({
      api: { post: async () => { throw new Error('Network unavailable') } },
      items,
      url: '/api/collections/me/merge',
      storage,
    }),
    /Network unavailable/
  )

  assert.deepEqual(readGuestCollection(storage), { items, error: '' })
})

test('guest data clears only after a valid successful merge response', async () => {
  const storage = createMemoryStorage()
  const items = [{ tmdbId: 42, title: 'Example' }]
  writeGuestCollection(items, storage)

  const result = await mergeGuestCollection({
    api: {
      post: async () => ({
        data: { mergedCount: 1, items: [{ ...items[0], isFavorite: true }] },
      }),
    },
    items,
    url: '/api/collections/me/merge',
    storage,
  })

  assert.equal(result.mergedCount, 1)
  assert.deepEqual(readGuestCollection(storage), { items: [], error: '' })
})

test('a partially failed batched merge keeps all guest data available for retry', async () => {
  const storage = createMemoryStorage()
  const items = Array.from({ length: 12 }, (_, index) => ({
    tmdbId: index + 1,
    title: `Example ${index + 1}`,
    overview: 'A'.repeat(5000),
    note: 'B'.repeat(2000),
  }))
  writeGuestCollection(items, storage)
  let requestCount = 0

  await assert.rejects(
    mergeGuestCollection({
      api: {
        post: async (_url, body) => {
          requestCount += 1
          if (requestCount === 2) throw new Error('Second batch failed')
          return {
            data: {
              mergedCount: body.items.length,
              items: body.items,
            },
          }
        },
      },
      items,
      url: '/api/collections/me/merge',
      storage,
    }),
    /Second batch failed/
  )

  assert.ok(requestCount > 1)
  assert.deepEqual(readGuestCollection(storage), { items, error: '' })
})
