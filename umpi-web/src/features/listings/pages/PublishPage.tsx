/**
 * PublishPage — Form for creating new listings.
 *
 * OPTIMIZATIONS:
 * - useMemo: filtered categories (avoids re-filtering on every render)
 * - useCallback: submit handler and input change handlers (stable references)
 * - CharacterCounter: pure component, no unnecessary re-renders
 * - maxLength: prevents exceeding limits at the input level
 *
 * CHARACTER LIMITS:
 * - Title: 100 characters
 * - Description: 500 characters
 */

import { useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabase'
import Navbar from '../../../components/layout/Navbar'
import Footer from '../../../components/layout/Footer'
import { useAuth } from '../../../contexts/AuthContext'
import { useCategories } from '../../../hooks/useCategories'
import { useCities } from '../../../hooks/useCities'
import Select from '../../../components/ui/Select'
import CharacterCounter from '../../../components/ui/CharacterCounter'

// ── Constants ─────────────────────────────────────────────────────────────────

const TITLE_MAX = 100
const DESCRIPTION_MAX = 500

// ── Component ─────────────────────────────────────────────────────────────────

export default function PublishPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { session } = useAuth()
  const { data: categories } = useCategories()
  const { data: cities } = useCities()

  // ── Form state ────────────────────────────────────────────────────────────
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [cityId, setCityId] = useState('')
  const [condition, setCondition] = useState<'new' | 'used'>('new')

  // ── Memoized derived data ─────────────────────────────────────────────────
  // Categories with "/" in name — only computed when categories change
  const filteredCategories = useMemo(
    () =>
      categories
        ?.filter((cat) => cat.name.includes('/'))
        .map((cat) => ({ value: cat.id, label: cat.name })) || [],
    [categories]
  )

  // City options — only computed when cities change
  const cityOptions = useMemo(
    () => cities?.map((city) => ({ value: city.id, label: city.name })) || [],
    [cities]
  )

  // ── Mutation ──────────────────────────────────────────────────────────────
  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!session?.user?.id) throw new Error('Debes iniciar sesión')

      const { data, error } = await supabase
        .from('listings')
        .insert({
          user_id: session.user.id,
          title: title.trim(),
          description: description.trim(),
          price: price ? parseFloat(price) : null,
          category_id: categoryId || null,
          city_id: cityId || null,
          status: 'active',
          images: [],
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['listings'] })
      navigate('/perfil')
    },
  })

  // ── Stable callbacks (prevent child re-renders) ───────────────────────────
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      publishMutation.mutate()
    },
    [publishMutation]
  )

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      // Prevent exceeding max length
      if (e.target.value.length <= TITLE_MAX) {
        setTitle(e.target.value)
      }
    },
    []
  )

  const handleDescriptionChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      // Prevent exceeding max length
      if (e.target.value.length <= DESCRIPTION_MAX) {
        setDescription(e.target.value)
      }
    },
    []
  )

  // ── Not logged in state ───────────────────────────────────────────────────
  if (!session) {
    return (
      <div className="bg-surface-container-low min-h-screen pb-24 md:pb-8 font-body-base">
        <Navbar />
        <main className="max-w-4xl mx-auto px-margin-mobile md:px-margin-desktop mt-8 mb-20">
          <div className="text-center py-xxl">
            <p className="text-text-secondary text-lg mb-4">Debes iniciar sesión para publicar</p>
            <button
              onClick={() => navigate('/login')}
              className="bg-primary-container text-white px-6 py-3 rounded-[14px] font-label-bold hover:bg-primary-dark transition-colors"
            >
              Iniciar Sesión
            </button>
          </div>
        </main>
        <Footer />
      </div>
    )
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <div className="bg-surface-container-low min-h-screen pb-24 md:pb-8 font-body-base">
      <Navbar />

      <main className="max-w-4xl mx-auto px-margin-mobile md:px-margin-desktop mt-8 mb-20">
        <div className="mb-8">
          <h2 className="font-title-lg text-title-lg text-on-surface">Publicar Aviso</h2>
          <p className="font-body-base text-body-base text-text-secondary mt-2">
            Completá los datos de tu producto o servicio para que miles de vecinos lo vean.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Photos Section */}
          <section className="bg-surface rounded-xl shadow-[0_4px_12px_rgba(0,0,0,0.03)] p-6 md:p-8 border border-border-light/50">
            <h3 className="font-section-title text-section-title text-on-surface mb-4">
              Fotos del producto
            </h3>
            <div className="border-2 border-dashed border-border-light rounded-xl p-8 flex flex-col items-center justify-center text-center bg-surface-container-low hover:bg-bg-peach-soft/50 transition-colors cursor-pointer group">
              <div className="w-16 h-16 rounded-full bg-bg-peach-soft flex items-center justify-center text-primary-container mb-4 group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-3xl">add_a_photo</span>
              </div>
              <p className="font-body-base text-body-base text-on-surface font-medium">
                Arrastrá tus fotos acá o hacé clic para buscar
              </p>
              <p className="font-small-subtext text-small-subtext text-text-secondary mt-2">
                Formato JPG, PNG o WEBP. Máximo 10MB por foto. (0/10)
              </p>
            </div>
          </section>

          {/* Info Section */}
          <section className="bg-surface rounded-xl shadow-[0_4px_12px_rgba(0,0,0,0.03)] p-6 md:p-8 border border-border-light/50 space-y-6">
            <h3 className="font-section-title text-section-title text-on-surface mb-4">
              Información principal
            </h3>

            {/* Title with character counter */}
            <div className="space-y-2">
              <label className="font-label-bold text-label-bold text-on-surface block">
                Título del aviso
              </label>
              <input
                className="w-full bg-surface border border-border-light rounded-[14px] px-[14px] py-3 focus:ring-2 focus:ring-primary-container focus:border-primary-container font-body-base text-body-base outline-none transition-all"
                placeholder="Ej: Bicicleta de paseo Rodado 26 casi nueva"
                type="text"
                value={title}
                onChange={handleTitleChange}
                maxLength={TITLE_MAX}
                required
              />
              <CharacterCounter current={title.length} max={TITLE_MAX} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Select
                label="Categoría"
                value={categoryId}
                onChange={setCategoryId}
                placeholder="Seleccioná una categoría"
                options={filteredCategories}
              />

              <div className="space-y-2">
                <label className="font-label-bold text-label-bold text-on-surface block">
                  Condición
                </label>
                <div className="flex gap-4">
                  <label className="flex-1 cursor-pointer">
                    <input
                      className="peer sr-only"
                      name="condicion"
                      type="radio"
                      value="new"
                      checked={condition === 'new'}
                      onChange={(e) => setCondition(e.target.value as 'new' | 'used')}
                    />
                    <div className="w-full text-center py-3 rounded-[14px] border border-border-light peer-checked:bg-bg-peach-soft peer-checked:border-primary-container peer-checked:text-primary-container font-body-base text-body-base transition-colors">
                      Nuevo
                    </div>
                  </label>
                  <label className="flex-1 cursor-pointer">
                    <input
                      className="peer sr-only"
                      name="condicion"
                      type="radio"
                      value="used"
                      checked={condition === 'used'}
                      onChange={(e) => setCondition(e.target.value as 'new' | 'used')}
                    />
                    <div className="w-full text-center py-3 rounded-[14px] border border-border-light peer-checked:bg-bg-peach-soft peer-checked:border-primary-container peer-checked:text-primary-container font-body-base text-body-base transition-colors">
                      Usado
                    </div>
                  </label>
                </div>
              </div>
            </div>

            {/* Description with character counter */}
            <div className="space-y-2">
              <label className="font-label-bold text-label-bold text-on-surface block">
                Descripción
              </label>
              <textarea
                className="w-full bg-surface border border-border-light rounded-[14px] px-[14px] py-3 focus:ring-2 focus:ring-primary-container focus:border-primary-container font-body-base text-body-base outline-none transition-all resize-none"
                placeholder="Describí el producto con el mayor detalle posible. Estado, tiempo de uso, motivos de venta..."
                rows={5}
                value={description}
                onChange={handleDescriptionChange}
                maxLength={DESCRIPTION_MAX}
                required
              />
              <CharacterCounter current={description.length} max={DESCRIPTION_MAX} />
            </div>
          </section>

          {/* Price and Location */}
          <section className="bg-surface rounded-xl shadow-[0_4px_12px_rgba(0,0,0,0.03)] p-6 md:p-8 border border-border-light/50 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="font-label-bold text-label-bold text-on-surface block">
                Precio (ARS)
              </label>
              <div className="relative">
                <span className="absolute left-[14px] top-1/2 -translate-y-1/2 font-body-base text-text-secondary">
                  $
                </span>
                <input
                  className="w-full bg-surface border border-border-light rounded-[14px] pl-8 pr-[14px] py-3 focus:ring-2 focus:ring-primary-container focus:border-primary-container font-price-highlight text-price-highlight outline-none transition-all"
                  placeholder="0"
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
            </div>

            <Select
              label="Ubicación"
              value={cityId}
              onChange={setCityId}
              placeholder="Seleccioná tu ciudad"
              options={cityOptions}
            />
          </section>

          {/* Actions */}
          <div className="pt-4">
            <button
              type="submit"
              disabled={publishMutation.isPending}
              className="w-full py-3 rounded-[14px] bg-primary-container text-on-primary font-label-bold text-label-bold hover:bg-primary-dark transition-colors shadow-sm h-[56px] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {publishMutation.isPending ? (
                'Publicando...'
              ) : (
                <>
                  <span className="material-symbols-outlined text-[20px]">send</span>
                  Publicar Aviso
                </>
              )}
            </button>
          </div>

          {publishMutation.error && (
            <div className="text-error-red text-sm text-center">
              Error al publicar: {publishMutation.error.message}
            </div>
          )}
        </form>
      </main>

      <Footer />
    </div>
  )
}
