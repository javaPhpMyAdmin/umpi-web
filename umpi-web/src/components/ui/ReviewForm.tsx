import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useHasReviewed, useCreateReview, useReviews } from '../../hooks/useReviews'

interface ReviewFormProps {
  listingId: string
  sellerId: string
}

export default function ReviewForm({ listingId, sellerId }: ReviewFormProps) {
  const { session } = useAuth()
  const { data: hasReviewed = false, isLoading: hasReviewedLoading } = useHasReviewed(listingId)
  const { data: reviews = [], isLoading: reviewsLoading } = useReviews(listingId)
  const createReview = useCreateReview()
  const [hoveredStar, setHoveredStar] = useState(0)
  const [selectedStar, setSelectedStar] = useState(0)

  const isLoading = hasReviewedLoading || reviewsLoading

  // Not logged in
  if (!session?.user) {
    return (
      <div className="flex flex-col items-center gap-sm py-md">
        <p className="text-text-secondary text-body-sm">Iniciar sesión para calificar</p>
        <Link
          to="/login"
          className="text-primary-container text-label-bold hover:underline"
        >
          Iniciar sesión
        </Link>
      </div>
    )
  }

  // Seller trying to review their own listing
  if (session.user.id === sellerId) {
    return null
  }

  // Loading — skeleton while determining review state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center gap-xs py-md animate-pulse">
        <div className="h-4 w-48 bg-border-light rounded" />
        <div className="flex gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="w-5 h-5 bg-border-light rounded" />
          ))}
        </div>
      </div>
    )
  }

  // Already reviewed — show read-only stars
  if (hasReviewed) {
    const myReview = reviews.find(r => r.reviewer_id === session.user?.id)
    const myRating = myReview?.rating ?? 0
    return (
      <div className="flex flex-col items-center gap-xs py-md">
        <p className="text-text-secondary text-body-sm">Ya calificaste esta publicación</p>
        <div className="flex">
          {Array.from({ length: 5 }).map((_, i) => (
            <span key={i} className={`material-symbols-outlined text-[20px] ${i < myRating ? 'material-symbols-filled text-yellow-500' : 'text-text-muted'}`}>
              {i < myRating ? 'star' : 'star_outline'}
            </span>
          ))}
        </div>
      </div>
    )
  }

  // Can review — interactive 5-star picker
  return (
    <div className="flex flex-col items-center gap-sm py-md">
      <p className="text-text-secondary text-body-sm">¿Cómo fue tu experiencia?</p>
      <div
        className="flex"
        onMouseLeave={() => setHoveredStar(0)}
      >
        {Array.from({ length: 5 }).map((_, i) => {
          const starNumber = i + 1
          const isFilled = selectedStar > 0
            ? starNumber <= selectedStar
            : starNumber <= hoveredStar
          return (
            <button
              key={i}
              type="button"
              className={`material-symbols-outlined text-[28px] transition-colors cursor-pointer ${
                isFilled
                  ? 'material-symbols-filled text-yellow-500'
                  : 'text-text-muted hover:text-yellow-400'
              }`}
              onMouseEnter={() => { if (!selectedStar) setHoveredStar(starNumber) }}
              onClick={() => {
                if (selectedStar || createReview.isPending) return
                setSelectedStar(starNumber)
                createReview.mutate({ listingId, sellerId, rating: starNumber })
              }}
              disabled={createReview.isPending || selectedStar > 0}
              aria-label={`${starNumber} estrella${starNumber > 1 ? 's' : ''}`}
            >
              {isFilled ? 'star' : 'star_outline'}
            </button>
          )
        })}
      </div>
      {createReview.isPending && (
        <p className="text-text-muted text-body-sm">Enviando...</p>
      )}
      {createReview.isSuccess && (
        <p className="text-positive text-body-sm">¡Gracias por tu calificación!</p>
      )}
      {createReview.isError && (
        <p className="text-error text-body-sm">
          {createReview.error?.message || 'No se pudo guardar la calificación'}
        </p>
      )}
    </div>
  )
}
