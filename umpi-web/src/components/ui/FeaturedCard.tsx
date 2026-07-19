import { Link } from 'react-router-dom'
import type { Listing } from '../../types'
import { formatPrice } from '../../lib/utils'

interface FeaturedCardProps {
  listing: Listing
}

export default function FeaturedCard({ listing }: FeaturedCardProps) {
  return (
    <Link
      to={`/producto/${listing.id}`}
      className="flex-none w-[280px] bg-surface rounded-[16px] shadow-[0_4px_12px_rgba(0,0,0,0.08)] overflow-hidden group hover:shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition-shadow duration-300"
    >
      <div className="relative h-[160px] w-full bg-surface-container-low">
        <img
          loading="lazy"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          src={listing.images?.[0] || 'https://via.placeholder.com/400x300?text=Sin+imagen'}
          alt={listing.title}
        />
        <div className="absolute top-3 left-3 bg-amber-500 text-white px-2 py-0.5 rounded-full text-[11px] font-bold shadow-md flex items-center gap-1">
          <span className="material-symbols-outlined text-[12px] material-symbols-filled">star</span>
          Destacado
        </div>
        <button className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/80 backdrop-blur-md flex items-center justify-center text-text-secondary hover:text-error-red transition-colors z-10">
          <span className="material-symbols-outlined text-[20px]">favorite</span>
        </button>
      </div>
      <div className="p-4 flex flex-col gap-2">
        <div className="font-price-highlight text-price-highlight text-on-surface text-[20px]">
          {formatPrice(listing.price)}
        </div>
        <h3 className="font-body-base text-body-base text-on-surface line-clamp-2 leading-tight">
          {listing.title}
        </h3>
        <div className="flex items-center text-text-muted font-small-subtext text-small-subtext mt-1">
          <span className="material-symbols-outlined text-[14px] mr-1">location_on</span>
          {listing.location || 'Sin ubicación'}
        </div>
      </div>
    </Link>
  )
}
