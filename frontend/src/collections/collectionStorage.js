export const GUEST_COLLECTION_STORAGE_KEY = 'noir.guestCollection'

export function readGuestCollection(storage = window.localStorage) {
  try {
    const value = storage.getItem(GUEST_COLLECTION_STORAGE_KEY)
    if (!value) return { items: [], error: '' }
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) {
      return { items: [], error: 'Saved guest collection data is invalid.' }
    }
    return { items: parsed, error: '' }
  } catch {
    return {
      items: [],
      error: 'Guest collection storage is unavailable in this browser.',
    }
  }
}

export function writeGuestCollection(items, storage = window.localStorage) {
  storage.setItem(GUEST_COLLECTION_STORAGE_KEY, JSON.stringify(items))
}

export async function mergeGuestCollection({
  api,
  items,
  url,
  storage = window.localStorage,
}) {
  const batches = []
  let batch = []
  for (const item of items) {
    const candidate = [...batch, item]
    const bytes = new TextEncoder().encode(JSON.stringify({ items: candidate })).length
    if (bytes > 70_000 && batch.length > 0) {
      batches.push(batch)
      batch = [item]
    } else {
      batch = candidate
    }
  }
  if (batch.length > 0) batches.push(batch)

  const mergedItems = new Map()
  let mergedCount = 0
  for (const itemBatch of batches) {
    const { data } = await api.post(url, { items: itemBatch })
    if (!Number.isInteger(data?.mergedCount) || !Array.isArray(data?.items)) {
      throw new Error('The server returned an invalid merge response.')
    }
    mergedCount += data.mergedCount
    for (const item of data.items) mergedItems.set(item.tmdbId, item)
  }
  storage.removeItem(GUEST_COLLECTION_STORAGE_KEY)
  return { mergedCount, items: [...mergedItems.values()] }
}
