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
 *
 * FEATURED TOGGLE:
 * - Users with an active plan can toggle "Destacar aviso" on publish
 * - Shows remaining featured credits for the current billing period
 * - Without a plan, shows a CTA to view plans
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabase'
import { uploadImage } from '../../../lib/upload'
import Navbar from '../../../components/layout/Navbar'
import Footer from '../../../components/layout/Footer'
import { useAuth } from '../../../contexts/AuthContext'
import { useCategories } from '../../../hooks/useCategories'
import { useCities } from '../../../hooks/useCities'
import { useFeaturedRemaining } from '../../../hooks/useFeaturedRemaining'
import Select from '../../../components/ui/Select'
import CharacterCounter from '../../../components/ui/CharacterCounter'

// ── Constants ─────────────────────────────────────────────────────────────────

const TITLE_MAX = 100
const DESCRIPTION_MAX = 500

// ── Component ─────────────────────────────────────────────────────────────────

export default function PublishPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { session, profile } = useAuth()
  const { data: categories } = useCategories()
  const { data: cities } = useCities()

  // ── Subscription & featured ──────────────────────────────────────────────
  const hasActivePlan =
    profile?.subscription_type != null &&
    profile.subscription_type !== '' &&
    profile.subscription_type !== 'none' &&
    // Trust subscription_type; only reject if expires_at exists and has passed
    (!profile.subscription_expires_at || new Date(profile.subscription_expires_at) > new Date())

  const { data: featured, isLoading: featuredLoading, error: featuredError } =
    useFeaturedRemaining(hasActivePlan ? profile?.subscription_type : undefined)

  const [featureToggle, setFeatureToggle] = useState(false)

  // ── Form state ────────────────────────────────────────────────────────────
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [cityId, setCityId] = useState('')
  const [condition, setCondition] = useState<'new' | 'used'>('new')
  const [cityError, setCityError] = useState(false)

  // ── Photo state ──────────────────────────────────────────────────────────
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadingRef = useRef(false)

  // Max images based on subscription plan (default 3 for free users)
  const maxImages = profile?.subscription_type === 'premium' ? 10 : profile?.subscription_type === 'standard' ? 10 : 3
  const atImageLimit = imageFiles.length >= maxImages

  // Revoke object URLs on unmount
  useEffect(() => {
    return () => {
      imagePreviews.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [imagePreviews])

  // ── Photo handlers ───────────────────────────────────────────────────────
  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const newFiles = Array.from(files).filter((f) => f.type.startsWith('image/'))
      if (newFiles.length === 0) return

      const totalAfter = imageFiles.length + newFiles.length
      const allowed = newFiles.slice(0, maxImages - imageFiles.length)
      if (totalAfter > maxImages && allowed.length === 0) return

      const newPreviews = allowed.map((f) => URL.createObjectURL(f))
      setImageFiles((prev) => [...prev, ...allowed])
      setImagePreviews((prev) => [...prev, ...newPreviews])
    },
    [imageFiles.length, maxImages]
  )

  const handleRemoveImage = useCallback((index: number) => {
    setImageFiles((prev) => prev.filter((_, i) => i !== index))
    setImagePreviews((prev) => {
      URL.revokeObjectURL(prev[index])
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)
      if (e.dataTransfer.files?.length) {
        handleFiles(e.dataTransfer.files)
      }
    },
    [handleFiles]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) {
        handleFiles(e.target.files)
        e.target.value = ''
      }
    },
    [handleFiles]
  )

  // ── Memoized derived data ─────────────────────────────────────────────────
  const filteredCategories = useMemo(
    () =>
      categories
        ?.filter((cat) => cat.name.includes('/'))
        .map((cat) => ({ value: cat.id, label: cat.name })) || [],
    [categories]
  )

  const cityOptions = useMemo(
    () => cities?.map((city) => ({ value: city.id, label: city.name })) || [],
    [cities]
  )

  // Condition picker only for Autos/Motos and Celulares categories
  const selectedCategoryName = useMemo(() => {
    if (!categoryId || !categories) return null
    return categories.find((c) => c.id === categoryId)?.name ?? null
  }, [categoryId, categories])

  const categorySupportsCondition = useMemo(() => {
    if (!selectedCategoryName) return false
    const name = selectedCategoryName.toLowerCase()
    return name.startsWith('autos') || name.startsWith('celulares')
  }, [selectedCategoryName])

  // Reset condition when category no longer supports it
  useEffect(() => {
    if (!categorySupportsCondition) setCondition('new')
  }, [categorySupportsCondition])

  const canFeature = hasActivePlan && (featured?.remaining ?? 0) > 0
  const featuredExhausted = hasActivePlan && !featuredLoading && !featuredError && (featured?.remaining ?? 0) <= 0

  // ── Mutation ──────────────────────────────────────────────────────────────
  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!session?.user?.id) throw new Error('Debes iniciar sesión')
      if (uploadingRef.current) throw new Error('Ya hay una subida en curso')
      uploadingRef.current = true

      try {
        // Upload images first
        let imageUrls: string[] = []
        if (imageFiles.length > 0) {
          const results = await Promise.all(
            imageFiles.map((file) => uploadImage(file, session.user.id))
          )
          imageUrls = results.filter((url): url is string => url !== null)
        }

        const { data: listingData, error } = await supabase
          .from('listings')
          .insert({
            user_id: session.user.id,
            title: title.trim(),
            description: description.trim(),
            price: price ? parseFloat(price) : null,
            category_id: categoryId || null,
            city_id: cityId || null,
            condition: categorySupportsCondition ? condition : null,
            status: 'active',
            images: imageUrls,
          })
          .select('id')
          .single()

        if (error) throw error
        return listingData
      } finally {
        uploadingRef.current = false
      }
    },
    onSuccess: async (listingData) => {
      queryClient.invalidateQueries({ queryKey: ['listings'] })

      // Feature the listing if toggle was on
      if (featureToggle && canFeature && listingData?.id) {
        const { error: rpcError } = await supabase.rpc('feature_listing', {
          p_listing_id: listingData.id,
        })

        if (rpcError) {
          // Listing was created but feature failed — still navigate, show warning
          console.error('Feature RPC error:', rpcError)
        }

        // Refresh featured remaining count
        queryClient.invalidateQueries({ queryKey: ['featured-remaining'] })
      }

      navigate('/perfil')
    },
  })

  // ── Stable callbacks ──────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (!cityId) {
        setCityError(true)
        return
      }
      setCityError(false)
      publishMutation.mutate()
    },
    [publishMutation, cityId]
  )

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.value.length <= TITLE_MAX) {
        setTitle(e.target.value)
      }
    },
    []
  )

  const handleDescriptionChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
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

            {/* Preview grid */}
            {imagePreviews.length > 0 && (
              <div className="flex flex-wrap gap-3 mb-4">
                {imagePreviews.map((preview, i) => (
                  <div key={preview} className="relative group w-[100px] h-[100px] md:w-[120px] md:h-[120px] rounded-xl overflow-hidden border border-border-light">
                    <img src={preview} alt={`Vista previa ${i + 1}`} className="w-full h-full object-cover" />
                    {i === 0 && (
                      <span className="absolute top-1 left-1 bg-primary-container text-white text-[10px] font-bold px-2 py-0.5 rounded-full">Principal</span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveImage(i)}
                      className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Drop zone / file picker */}
            {!atImageLimit ? (
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center transition-colors cursor-pointer group ${
                  isDragOver
                    ? 'border-primary-container bg-primary-container/5'
                    : 'border-border-light hover:bg-bg-peach-soft/50'
                }`}
              >
                <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform ${
                  isDragOver ? 'bg-primary-container/10' : 'bg-bg-peach-soft'
                }`}>
                  <span className={`material-symbols-outlined text-3xl ${isDragOver ? 'text-primary-container' : 'text-primary-container'}`}>add_a_photo</span>
                </div>
                <p className="font-body-base text-body-base text-on-surface font-medium">
                  {isDragOver ? 'Soltá las fotos acá' : 'Arrastrá tus fotos acá o hacé clic para buscar'}
                </p>
                <p className="font-small-subtext text-small-subtext text-text-secondary mt-2">
                  Formato JPG, PNG o WEBP. Máximo 10MB por foto. ({imageFiles.length}/{maxImages})
                </p>
              </div>
            ) : (
              <div className="border-2 border-dashed border-border-light rounded-xl p-6 text-center bg-surface-container-low">
                <p className="text-text-secondary text-sm">
                  Alcanzaste el límite de fotos ({imageFiles.length}/{maxImages})
                </p>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={handleFileInputChange}
              className="hidden"
            />
          </section>

          {/* Info Section */}
          <section className="bg-surface rounded-xl shadow-[0_4px_12px_rgba(0,0,0,0.03)] p-6 md:p-8 border border-border-light/50 space-y-6">
            <h3 className="font-section-title text-section-title text-on-surface mb-4">
              Información principal
            </h3>

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

              {categorySupportsCondition && (
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
              )}
            </div>

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
              onChange={(v) => { setCityId(v); setCityError(false) }}
              placeholder="Seleccioná tu ciudad"
              options={cityOptions}
            />
            {cityError && (
              <p className="text-error-red text-sm mt-1">Seleccioná una ciudad para publicar</p>
            )}
          </section>

          {/* Featured Toggle Section */}
          {hasActivePlan ? (
            <section className="bg-surface rounded-xl shadow-[0_4px_12px_rgba(0,0,0,0.03)] p-6 md:p-8 border border-border-light/50">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-section-title text-section-title text-on-surface">
                    Destacar aviso
                  </h3>
                  <p className="font-small-subtext text-small-subtext text-text-secondary mt-1">
                    Tu aviso aparecerá primero en los resultados
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={featureToggle}
                  disabled={featuredExhausted}
                  onClick={() => setFeatureToggle(!featureToggle)}
                  className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    featureToggle ? 'bg-primary-container' : 'bg-border-light'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                      featureToggle ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="mt-3">
                {featuredLoading ? (
                  <p className="font-small-subtext text-small-subtext text-text-muted">
                    Cargando...
                  </p>
                ) : featuredError ? (
                  <p className="font-small-subtext text-small-subtext text-error">
                    Error al cargar tus destacados
                  </p>
                ) : canFeature ? (
                  <p className="font-small-subtext text-small-subtext text-text-secondary">
                    Te{(featured?.remaining ?? 0) === 1 ? ' queda' : ' quedan'}{' '}
                    <span className="font-label-bold text-label-bold text-on-surface">
                      {featured?.remaining}
                    </span>{' '}
                    destacado{(featured?.remaining ?? 0) !== 1 ? 's' : ''} de{' '}
                    {featured?.maxFeatured} este período
                  </p>
                ) : (
                  <p className="font-small-subtext text-small-subtext text-error">
                    Agotaste tus destacados de este período
                  </p>
                )}
              </div>
            </section>
          ) : (
            <section className="bg-bg-peach-soft rounded-xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <p className="font-body-base text-body-base text-primary-dark">
                Suscribite a un plan para destacar tus avisos
              </p>
              <Link
                to="/planes"
                className="h-[40px] px-lg rounded-[14px] bg-primary-container text-white font-label-bold text-label-bold hover:bg-primary-dark transition-colors flex items-center justify-center shrink-0"
              >
                Ver Planes
              </Link>
            </section>
          )}

          {/* Actions */}
          <div className="pt-4">
            <button
              type="submit"
              disabled={publishMutation.isPending || uploadingRef.current}
              className="w-full py-3 rounded-[14px] bg-primary-container text-on-primary font-label-bold text-label-bold hover:bg-primary-dark transition-colors shadow-sm h-[56px] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {publishMutation.isPending ? (
                imageFiles.length > 0 ? 'Subiendo fotos...' : 'Publicando...'
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
