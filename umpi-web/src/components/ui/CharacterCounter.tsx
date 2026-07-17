/**
 * CharacterCounter — Shows current/max character count for text inputs.
 *
 * WHY: Provides visual feedback to users about remaining characters.
 * Color transitions from neutral → warning → danger as limit approaches.
 *
 * PERFORMANCE: Pure component — only re-renders when value changes.
 * No internal state, no side effects.
 *
 * @example
 * <CharacterCounter current={title.length} max={100} />
 */

interface CharacterCounterProps {
  /** Current character count */
  current: number
  /** Maximum allowed characters */
  max: number
}

export default function CharacterCounter({ current, max }: CharacterCounterProps) {
  const remaining = max - current
  const ratio = current / max

  // Color transitions: green → amber → red
  const colorClass =
    ratio > 0.9
      ? 'text-error-red'
      : ratio > 0.7
        ? 'text-amber-600'
        : 'text-text-muted'

  return (
    <p className={`text-xs font-medium mt-1.5 ${colorClass}`}>
      {current}/{max}
      {remaining <= 10 && remaining > 0 && (
        <span className="ml-1">— quedan {remaining}</span>
      )}
      {remaining === 0 && (
        <span className="ml-1">— límite alcanzado</span>
      )}
    </p>
  )
}
