import { Link } from 'react-router-dom'
import type { Listing } from '../../types'
import { formatPrice } from '../../lib/utils'

interface ProductCardProps {
  listing: Listing
}

export default function ProductCard({ listing }: ProductCardProps) {
  return (
    <Link
      to={`/producto/${listing.id}`}
      className="bg-surface rounded-[16px] shadow-[0_4px_12px_rgba(0,0,0,0.05)] overflow-hidden group hover:shadow-[0_6px_16px_rgba(0,0,0,0.08)] transition-shadow duration-300 flex flex-col h-full border border-surface-variant/50"
    >
      <div className="relative h-[140px] md:h-[180px] w-full bg-surface-container-low overflow-hidden">
        <img
          loading="lazy"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          src={listing.images?.[0] || 'https://via.placeholder.com/400x300?text=Sin+imagen'}
          alt={listing.title}
        />
        {listing.is_featured && (
          <div className="absolute top-2 left-2 flex items-center gap-1 bg-amber-500 text-white px-2 py-0.5 rounded-full text-[11px] font-bold shadow-md">
            <span className="material-symbols-outlined text-[12px] material-symbols-filled">star</span>
            Destacado
          </div>
        )}
        <button className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/80 backdrop-blur-md flex items-center justify-center text-text-secondary hover:text-error-red transition-colors z-10">
          <span className="material-symbols-outlined text-[18px]">favorite</span>
        </button>
      </div>
      <div className="p-3 md:p-4 flex flex-col gap-1 flex-1">
        <div className="font-price-highlight text-price-highlight text-primary-container text-[16px] md:text-[18px] mb-1">
          {formatPrice(listing.price)}
        </div>
        <h3 className="font-body-base text-body-base text-on-surface text-[13px] md:text-[14px] leading-snug line-clamp-2 mb-2 flex-1">
          {listing.title}
        </h3>
        <div className="flex items-center text-text-muted font-small-subtext text-small-subtext">
          <span className="material-symbols-outlined text-[12px] mr-1">location_on</span>
          <span className="truncate">{listing.location || 'Sin ubicación'}</span>
        </div>
      </div>
    </Link>
  )
}
