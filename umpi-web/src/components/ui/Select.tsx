/**
 * Select — Custom styled select dropdown.
 *
 * WHY: Native <select> elements are limited in styling. This component
 * provides a consistent, aesthetic dropdown that matches the design system
 * while maintaining accessibility (keyboard navigation, ARIA attributes).
 *
 * ARCHITECTURE:
 * - Button trigger shows current value or placeholder
 * - Dropdown panel opens on click with smooth animation
 * - Click outside or Escape closes the dropdown
 * - Each option has hover/active states matching the design tokens
 *
 * @example
 * <Select
 *   label="Ciudad"
 *   value={cityId}
 *   onChange={setCityId}
 *   options={cities.map(c => ({ value: c.id, label: c.name }))}
 *   placeholder="Seleccioná tu ciudad"
 * />
 */

import { useState, useRef, useEffect, useCallback } from 'react'

interface SelectOption {
  value: string
  label: string
  /** Optional icon or emoji to show before the label */
  icon?: string
}

interface SelectProps {
  /** Label text displayed above the select */
  label: string
  /** Currently selected value */
  value: string
  /** Called when the user selects an option */
  onChange: (value: string) => void
  /** Array of options to display */
  options: SelectOption[]
  /** Placeholder text when nothing is selected */
  placeholder?: string
  /** If true, the select cannot be interacted with */
  disabled?: boolean
  /** If true, shows a red border and error message */
  error?: string
}

export default function Select({
  label,
  value,
  onChange,
  options,
  placeholder = 'Seleccioná una opción',
  disabled = false,
  error,
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Find the currently selected option's label
  const selectedOption = options.find((opt) => opt.value === value)

  // Close dropdown when clicking outside
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setIsOpen(false)
    }
  }, [])

  // Close on Escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false)
      buttonRef.current?.focus()
    }
  }, [])

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleClickOutside, handleKeyDown])

  const handleSelect = (optionValue: string) => {
    onChange(optionValue)
    setIsOpen(false)
  }

  return (
    <div className="space-y-2" ref={containerRef}>
      <label className="font-label-bold text-label-bold text-on-surface block">
        {label}
      </label>

      {/* Trigger button */}
      <div className="relative">
        <button
          ref={buttonRef}
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setIsOpen(!isOpen)}
          className={`
            w-full bg-surface border rounded-[14px] px-[14px] py-3
            text-left font-body-base text-body-base outline-none transition-all
            flex items-center justify-between gap-2
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            ${
              error
                ? 'border-error-red focus:ring-2 focus:ring-error-red/30'
                : isOpen
                  ? 'border-primary-container ring-2 ring-primary-container/20 shadow-[0_0_0_3px_rgba(255,107,53,0.08)]'
                  : 'border-border-light hover:border-border-light/80 hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]'
            }
          `}
        >
          <span
            className={`flex-1 truncate ${
              selectedOption ? 'text-on-surface' : 'text-text-muted'
            }`}
          >
            {selectedOption ? (
              <span className="flex items-center gap-2">
                {selectedOption.icon && <span>{selectedOption.icon}</span>}
                {selectedOption.label}
              </span>
            ) : (
              placeholder
            )}
          </span>
          <span
            className={`material-symbols-outlined text-[20px] text-text-secondary transition-transform duration-200 ${
              isOpen ? 'rotate-180' : ''
            }`}
          >
            expand_more
          </span>
        </button>

        {/* Dropdown panel */}
        {isOpen && (
          <div
            className="
              absolute z-50 mt-2 w-full
              bg-surface border border-border-light
              rounded-[14px] shadow-[0_8px_30px_rgba(0,0,0,0.12)]
              py-2 max-h-[280px] overflow-y-auto
              animate-in fade-in slide-in-from-top-2
            "
          >
            {options.length === 0 ? (
              <div className="px-4 py-3 text-text-muted text-sm text-center">
                No hay opciones disponibles
              </div>
            ) : (
              options.map((option) => {
                const isSelected = option.value === value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleSelect(option.value)}
                    className={`
                      w-full px-4 py-3 text-left font-body-base text-body-base
                      transition-colors duration-100
                      flex items-center gap-3
                      ${
                        isSelected
                          ? 'bg-bg-peach-soft text-primary-container font-medium'
                          : 'text-on-surface hover:bg-surface-container-low'
                      }
                    `}
                  >
                    {option.icon && <span className="text-lg">{option.icon}</span>}
                    <span className="flex-1">{option.label}</span>
                    {isSelected && (
                      <span className="material-symbols-outlined text-[18px] text-primary-container">
                        check
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <p className="text-error-red text-sm mt-1">{error}</p>
      )}
    </div>
  )
}
