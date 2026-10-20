import { useContext } from 'react'
import { CollectionContext } from './collectionStore.js'

export function useCollection() {
  const context = useContext(CollectionContext)
  if (!context) {
    throw new Error('useCollection must be used inside CollectionProvider.')
  }
  return context
}
