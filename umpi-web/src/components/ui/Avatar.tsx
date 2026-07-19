import { useState } from 'react'

interface AvatarProps {
  src?: string | null
  name?: string | null
  size?: number
  className?: string
}

// Deterministic color from name string
function nameToColor(name: string): string {
  const colors = [
    'bg-primary-container',
    'bg-secondary',
    'bg-tertiary',
    'bg-error',
    'bg-secondary-container',
    'bg-primary',
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

function getInitials(name: string | null | undefined): string {
  if (!name) return 'U'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function Avatar({ src, name, size = 128, className = '' }: AvatarProps) {
  const [imgError, setImgError] = useState(false)
  const showImage = src && !imgError
  const initials = getInitials(name)
  const bgColor = nameToColor(name || 'U')

  const sizeClass = size <= 48 ? 'w-12 h-12 text-lg' :
    size <= 64 ? 'w-16 h-16 text-xl' :
    size <= 128 ? 'w-32 h-32 text-3xl' :
    'w-40 h-40 text-4xl'

  if (showImage) {
    return (
      <img
        className={`rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
        src={src}
        alt={name || 'Avatar'}
        onError={() => setImgError(true)}
      />
    )
  }

  return (
    <div
      className={`rounded-full flex items-center justify-center font-bold text-white ${sizeClass} ${bgColor} ${className}`}
      style={{ width: size, height: size }}
    >
      {initials}
    </div>
  )
}
