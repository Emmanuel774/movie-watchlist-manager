import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, COLLECTION_URL } from '../api.js'
import { useAuth } from '../auth/useAuth.js'
import { CollectionContext } from './collectionStore.js'
import {
  mergeGuestCollection as requestGuestCollectionMerge,
  readGuestCollection,
  writeGuestCollection,
} from './collectionStorage.js'

const getMetadata = (movie) => {
  const releaseDate = movie.release_date || ''
  const genres = Array.isArray(movie.genres)
    ? movie.genres.map((genre) => genre.name).join(', ')
    : Array.isArray(movie.genre_ids)
      ? movie.genre_ids
          .map((id) => ({
            28: 'Action',
            12: 'Adventure',
            16: 'Animation',
            35: 'Comedy',
            80: 'Crime',
            18: 'Drama',
            27: 'Horror',
            9648: 'Mystery',
            10749: 'Romance',
            878: 'Science Fiction',
            53: 'Thriller',
          })[id])
          .filter(Boolean)
          .join(', ')
      : movie.genre || ''

  return {
    tmdbId: Number(movie.tmdbId ?? movie.id),
    title: movie.title || '',
    posterPath: movie.posterPath || movie.poster_path || '',
    releaseYear: Number(releaseDate.slice(0, 4) || movie.releaseYear) || null,
    genre: genres,
    overview: movie.overview || '',
  }
}

const normalizeCollectionItem = (movie, current, changes = {}) => ({
  ...getMetadata(movie),
  isFavorite: Boolean(current?.isFavorite),
  isWatched: Boolean(current?.isWatched),
  note: current?.note || '',
  rating: current?.rating ?? null,
  ...changes,
})

export function CollectionProvider({ children }) {
  const { user } = useAuth()
  return (
    <CollectionStateProvider key={user?.id || 'guest'} user={user}>
      {children}
    </CollectionStateProvider>
  )
}

function CollectionStateProvider({ children, user }) {
  const [items, setItems] = useState(() =>
    user ? [] : readGuestCollection().items
  )
  const [guestCount, setGuestCount] = useState(() => readGuestCollection().items.length)
  const [isLoading, setIsLoading] = useState(Boolean(user))
  const [error, setError] = useState(() =>
    user ? '' : readGuestCollection().error
  )
  const [mergePromptOpen, setMergePromptOpen] = useState(false)
  const [isMerging, setIsMerging] = useState(false)

  useEffect(() => {
    let isCurrent = true
    if (!user) return undefined

    const guestCollection = readGuestCollection()
    api.get(`${COLLECTION_URL}/me`)
      .then(({ data }) => {
        if (!isCurrent) return
        if (!Array.isArray(data?.items)) {
          throw new Error('The server returned invalid collection data.')
        }
        setItems(data.items)
        setGuestCount(guestCollection.items.length)
        setError(guestCollection.error)
        setMergePromptOpen(guestCollection.items.length > 0)
      })
      .catch((requestError) => {
        if (!isCurrent) return
        setError(
          requestError.response?.data?.message ||
            requestError.message ||
            'Unable to load your saved collection.'
        )
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false)
      })

    return () => {
      isCurrent = false
    }
  }, [user])

  const saveMovie = useCallback(async (movie, changes = {}) => {
    const tmdbId = Number(movie.tmdbId ?? movie.id)
    if (!Number.isSafeInteger(tmdbId) || tmdbId < 1) {
      throw new Error('A valid TMDB movie ID is required.')
    }
    const current = items.find((item) => item.tmdbId === tmdbId)
    const item = normalizeCollectionItem(movie, current, changes)

    if (user) {
      const { data } = await api.put(
        `${COLLECTION_URL}/me/items/${tmdbId}`,
        item
      )
      setItems((currentItems) => [
        ...currentItems.filter((entry) => entry.tmdbId !== tmdbId),
        data.item,
      ])
      return data.item
    }

    const nextItems = [
      ...items.filter((entry) => entry.tmdbId !== tmdbId),
      item,
    ]
    try {
      writeGuestCollection(nextItems)
      setItems(nextItems)
      setGuestCount(nextItems.length)
      setError('')
      return item
    } catch {
      setError('Your browser could not save this guest collection change.')
      throw new Error('Unable to save guest collection in this browser.')
    }
  }, [items, user])

  const removeMovie = useCallback(async (tmdbId) => {
    if (user) {
      await api.delete(`${COLLECTION_URL}/me/items/${tmdbId}`)
    } else {
      try {
        writeGuestCollection(items.filter((item) => item.tmdbId !== tmdbId))
        setGuestCount(items.filter((item) => item.tmdbId !== tmdbId).length)
      } catch {
        setError('Your browser could not update the guest collection.')
        throw new Error('Unable to update guest collection in this browser.')
      }
    }
    setItems((currentItems) => currentItems.filter((item) => item.tmdbId !== tmdbId))
  }, [items, user])

  const mergeGuestCollection = useCallback(async () => {
    const guestCollection = readGuestCollection()
    if (guestCollection.items.length === 0) {
      setMergePromptOpen(false)
      return
    }

    setIsMerging(true)
    setError('')
    try {
      const data = await requestGuestCollectionMerge({
        api,
        items: guestCollection.items,
        url: `${COLLECTION_URL}/me/merge`,
      })
      setItems(data.items)
      setGuestCount(0)
      setMergePromptOpen(false)
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          requestError.message ||
          'Unable to merge guest collection. Your guest data is still saved.'
      )
      throw requestError
    } finally {
      setIsMerging(false)
    }
  }, [])

  const dismissMergePrompt = useCallback(() => {
    setMergePromptOpen(false)
  }, [])

  const openMergePrompt = useCallback(() => {
    const count = readGuestCollection().items.length
    setGuestCount(count)
    if (count > 0) {
      setMergePromptOpen(true)
    }
  }, [])

  const value = useMemo(
    () => ({
      items,
      guestCount,
      isLoading,
      error,
      mergePromptOpen,
      isMerging,
      saveMovie,
      removeMovie,
      mergeGuestCollection,
      dismissMergePrompt,
      openMergePrompt,
    }),
    [
      items,
      guestCount,
      isLoading,
      error,
      mergePromptOpen,
      isMerging,
      saveMovie,
      removeMovie,
      mergeGuestCollection,
      dismissMergePrompt,
      openMergePrompt,
    ]
  )

  return (
    <CollectionContext.Provider value={value}>
      {children}
    </CollectionContext.Provider>
  )
}
