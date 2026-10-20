import { useState } from 'react'
import { useCollection } from './useCollection.js'

export default function CollectionMergePrompt() {
  const {
    guestCount,
    mergePromptOpen,
    isMerging,
    error,
    mergeGuestCollection,
    dismissMergePrompt,
  } = useCollection()
  const [mergeError, setMergeError] = useState('')

  if (!mergePromptOpen) return null

  const confirmMerge = async () => {
    setMergeError('')
    try {
      await mergeGuestCollection()
    } catch (requestError) {
      setMergeError(
        requestError.response?.data?.message ||
          requestError.message ||
          'Merge failed. Your guest collection remains saved.'
      )
    }
  }

  return (
    <div className="collection-dialog-backdrop">
      <section
        className="collection-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="collection-merge-heading"
      >
        <p className="eyebrow">YOUR GUEST COLLECTION</p>
        <h2 id="collection-merge-heading">Bring your films with you?</h2>
        <p>
          We found {guestCount} movie{guestCount === 1 ? '' : 's'} saved on
          this device. Merge them into your account? Existing notes and ratings
          will be kept; watched and favourite states will be combined.
        </p>
        {(mergeError || error) && (
          <p className="form-error" role="alert">{mergeError || error}</p>
        )}
        <div className="collection-dialog-actions">
          <button
            className="featured-secondary-btn"
            type="button"
            onClick={dismissMergePrompt}
            disabled={isMerging}
          >
            Keep separate
          </button>
          <button
            className="featured-primary-btn"
            type="button"
            onClick={confirmMerge}
            disabled={isMerging}
          >
            {isMerging ? 'Merging…' : 'Merge collection'}
          </button>
        </div>
      </section>
    </div>
  )
}
