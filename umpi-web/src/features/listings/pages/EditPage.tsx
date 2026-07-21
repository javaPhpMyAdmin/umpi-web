/**
 * EditPage — Form for editing existing listings with photo management.
 *
 * Photo limits by subscription:
 * - Sin plan: 3 fotos
 * - Estándar: 10 fotos
 * - Premium: 20 fotos
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabase'
import { uploadImage, deleteImage } from '../../../lib/upload'
import Navbar from '../../../components/layout/Navbar'
import Footer from '../../../components/layout/Footer'
import { useAuth } from '../../../contexts/AuthContext'
import { useCategories } from '../../../hooks/useCategories'
import { useCities } from '../../../hooks/useCities'
import Select from '../../../components/ui/Select'
import CharacterCounter from '../../../components/ui/CharacterCounter'
import ProfilePageSkeleton from '../../../components/ui/skeletons/ProfilePageSkeleton'

const TITLE_MAX = 100
const DESCRIPTION_MAX = 500

// Default limits when plan data isn't available yet
const DEFAULT_LIMITS: Record<string, number> = {
  premium: 20,
  estandar: 10,
}

function getMaxImages(subscriptionType: string | null | undefined, planMaxImages: number | null): number {
  if (planMaxImages != null && planMaxImages > 0) return planMaxImages
  if (!subscriptionType) return 3
  return DEFAULT_LIMITS[subscriptionType] ?? 3
}

export default function EditPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { session, profile } = useAuth()
  const { data: categories } = useCategories()
  const { data: cities } = useCities()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState('')

  // ── Form state ────────────────────────────────────────────────────────────
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [cityId, setCityId] = useState('')
  const [condition, setCondition] = useState<'new' | 'used'>('new')

  // ── Photo state ───────────────────────────────────────────────────────────
  const [existingImages, setExistingImages] = useState<string[]>([]) // URLs already in DB
  const [newImages, setNewImages] = useState<File[]>([]) // Files picked but not yet uploaded
  const [newImagePreviews, setNewImagePreviews] = useState<string[]>([]) // Object URLs for previews
  const [removedImages, setRemovedImages] = useState<string[]>([]) // URLs to delete from storage
  const previewsRef = useRef<string[]>([]) // Always-current previews for cleanup

  // Keep ref in sync with state
  useEffect(() => {
    previewsRef.current = newImagePreviews
  }, [newImagePreviews])

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      previewsRef.current.forEach(URL.revokeObjectURL)
    }
  }, [])
  const { data: userPlan } = useQuery({
    queryKey: ['subscription-plan', profile?.subscription_type],
    queryFn: async () => {
      if (!profile?.subscription_type) return null
      const { data } = await supabase
        .from('subscription_plans')
        .select('max_images')
        .eq('slug', profile.subscription_type)
        .single()
      return data
    },
    enabled: !!profile?.subscription_type,
  })

  const maxImages = getMaxImages(profile?.subscription_type, userPlan?.max_images)
  const totalImages = existingImages.length + newImages.length
  const canAddMore = totalImages < maxImages

  // ── Load existing listing ─────────────────────────────────────────────────
  useEffect(() => {
    if (!id || !session?.user?.id) return

    const loadListing = async () => {
      const { data, error: fetchError } = await supabase
        .from('listings')
        .select('*')
        .eq('id', id)
        .eq('user_id', session.user.id)
        .single()

      if (fetchError || !data) {
        setError('Aviso no encontrado o sin permisos')
        setLoading(false)
        return
      }

      setTitle(data.title || '')
      setDescription(data.description || '')
      setPrice(data.price?.toString() || '')
      setCategoryId(data.category_id || '')
      setCityId(data.city_id || '')
      setCondition(data.condition || 'new')
      setExistingImages(data.images || [])
      setLoading(false)
    }

    loadListing()
  }, [id, session?.user?.id])

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      newImagePreviews.forEach(URL.revokeObjectURL)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  useEffect(() => {
    if (!categorySupportsCondition) setCondition('new')
  }, [categorySupportsCondition])

  // ── Photo handlers ────────────────────────────────────────────────────────
  const handlePickImages = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files) return

      const availableSlots = maxImages - totalImages
      const filesToAdd = Array.from(files).slice(0, availableSlots)

      // Validate each file
      const validFiles: File[] = []
      for (const file of filesToAdd) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
          continue
        }
        if (file.size > 10 * 1024 * 1024) {
          continue
        }
        validFiles.push(file)
      }

      if (validFiles.length > 0) {
        const previews = validFiles.map((f) => URL.createObjectURL(f))
        setNewImages((prev) => [...prev, ...validFiles])
        setNewImagePreviews((prev) => [...prev, ...previews])
      }

      // Reset input so same file can be picked again
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    [maxImages, totalImages]
  )

  const handleRemoveExisting = useCallback((index: number) => {
    setExistingImages((prev) => {
      const removed = prev[index]
      setRemovedImages((r) => [...r, removed])
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  const handleRemoveNew = useCallback(
    (index: number) => {
      URL.revokeObjectURL(newImagePreviews[index])
      setNewImages((prev) => prev.filter((_, i) => i !== index))
      setNewImagePreviews((prev) => prev.filter((_, i) => i !== index))
    },
    [newImagePreviews]
  )

  // ── Mutation ──────────────────────────────────────────────────────────────
  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!session?.user?.id || !id) throw new Error('Debes iniciar sesión')
      // 1. Delete removed images from storage (fire-and-forget for speed)
      for (const url of removedImages) {
        deleteImage(url).catch(console.error)
      }

      // 2. Upload new images
      const uploadedUrls: string[] = []
      for (let i = 0; i < newImages.length; i++) {
        setUploadProgress(`Subiendo foto ${i + 1}/${newImages.length}...`)
        try {
          const url = await uploadImage(newImages[i], session.user.id)
          uploadedUrls.push(url)
        } catch (err) {
          console.error('Error uploading image:', err)
          // Continue with other images
        }
      }

      setUploadProgress('')

      // 3. Merge: remaining existing + newly uploaded
      const finalImages = [...existingImages, ...uploadedUrls]

      // 4. Update listing
      const { data, error } = await supabase
        .from('listings')
        .update({
          title: title.trim(),
          description: description.trim(),
          price: price ? parseFloat(price) : null,
          category_id: categoryId || null,
          city_id: cityId || null,
          condition: categorySupportsCondition ? condition : null,
          images: finalImages,
        })
        .eq('id', id)
        .eq('user_id', session.user.id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['listings'] })
      queryClient.invalidateQueries({ queryKey: ['listings', 'user', session?.user?.id] })
      navigate('/perfil')
    },
  })

  // ── Stable callbacks ──────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      updateMutation.mutate()
    },
    [updateMutation]
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

  // ── Loading state ─────────────────────────────────────────────────────────
  if (!session) {
    return (
      <div className="bg-surface-container-low min-h-screen pb-24 md:pb-8 font-body-base">
        <Navbar />
        <main className="max-w-4xl mx-auto px-margin-mobile md:px-margin-desktop mt-8 mb-20">
          <div className="text-center py-xxl">
            <p className="text-text-secondary text-lg mb-4">Debes iniciar sesión para editar</p>
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

  if (loading) {
    return <ProfilePageSkeleton />
  }

  if (error) {
    return (
      <div className="bg-surface-container-low min-h-screen pb-24 md:pb-8 font-body-base">
        <Navbar />
        <main className="max-w-4xl mx-auto px-margin-mobile md:px-margin-desktop mt-8 mb-20">
          <div className="text-center py-xxl">
            <span className="material-symbols-outlined text-6xl text-error mb-4">error</span>
            <p className="text-text-secondary text-lg mb-4">{error}</p>
            <button
              onClick={() => navigate('/perfil')}
              className="bg-primary-container text-white px-6 py-3 rounded-[14px] font-label-bold hover:bg-primary-dark transition-colors"
            >
              Volver al perfil
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
          <h2 className="font-title-lg text-title-lg text-on-surface">Editar Aviso</h2>
          <p className="font-body-base text-body-base text-text-secondary mt-2">
            Actualizá los datos y fotos de tu aviso.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Photos Section */}
          <section className="bg-surface rounded-xl shadow-[0_4px_12px_rgba(0,0,0,0.03)] p-6 md:p-8 border border-border-light/50">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-section-title text-section-title text-on-surface">
                Fotos del producto
              </h3>
              <span className="font-small-subtext text-small-subtext text-text-secondary">
                {totalImages}/{maxImages}
              </span>
            </div>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={handlePickImages}
            />

            {/* Image grid */}
            {totalImages > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 mb-4">
                {/* Existing images */}
                {existingImages.map((url, i) => (
                  <div key={`existing-${i}`} className="relative aspect-square rounded-xl overflow-hidden group">
                    <img
                      src={url}
                      alt={`Foto ${i + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveExisting(i)}
                      className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-error text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                    {i === 0 && (
                      <div className="absolute bottom-1.5 left-1.5 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                        Principal
                      </div>
                    )}
                  </div>
                ))}

                {/* New images (picked but not uploaded) */}
                {newImagePreviews.map((url, i) => (
                  <div key={`new-${i}`} className="relative aspect-square rounded-xl overflow-hidden group">
                    <img
                      src={url}
                      alt={`Nueva foto ${i + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveNew(i)}
                      className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-error text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                    <div className="absolute bottom-1.5 left-1.5 bg-primary-container text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                      Nueva
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add button */}
            {canAddMore && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-border-light rounded-xl p-6 flex flex-col items-center justify-center text-center bg-surface-container-low hover:bg-bg-peach-soft/50 transition-colors cursor-pointer group"
              >
                <div className="w-12 h-12 rounded-full bg-bg-peach-soft flex items-center justify-center text-primary-container mb-2 group-hover:scale-110 transition-transform">
                  <span className="material-symbols-outlined text-2xl">add_a_photo</span>
                </div>
                <p className="font-body-base text-body-base text-on-surface font-medium">
                  Agregar fotos
                </p>
                <p className="font-small-subtext text-small-subtext text-text-secondary mt-1">
                  JPG, PNG o WEBP. Máximo 10MB por foto. ({totalImages}/{maxImages})
                </p>
              </button>
            )}

            {!canAddMore && totalImages > 0 && (
              <p className="text-center font-small-subtext text-small-subtext text-text-muted mt-3">
                Límite de fotos alcanzado ({maxImages}). Para agregar más, upgradeá tu plan.
              </p>
            )}
          </section>

          {/* Info Section */}
          <section className="bg-surface rounded-xl shadow-[0_4px_12px_rgba(0,0,0,0.03)] p-6 md:p-8 border border-border-light/50 space-y-6">
            <h3 className="font-section-title text-section-title text-on-surface mb-4">
              Información del aviso
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
                placeholder="Describí el producto con el mayor detalle posible."
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
          <div className="pt-4 flex gap-4">
            <button
              type="button"
              onClick={() => navigate('/perfil')}
              className="flex-1 py-3 rounded-[14px] border border-border-light text-text-secondary font-label-bold text-label-bold hover:bg-surface-container-low transition-colors h-[56px] flex items-center justify-center"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="flex-[2] py-3 rounded-[14px] bg-primary-container text-on-primary font-label-bold text-label-bold hover:bg-primary-dark transition-colors shadow-sm h-[56px] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {updateMutation.isPending ? (
                uploadProgress || 'Guardando...'
              ) : (
                <>
                  <span className="material-symbols-outlined text-[20px]">save</span>
                  Guardar Cambios
                </>
              )}
            </button>
          </div>

          {updateMutation.error && (
            <div className="text-error-red text-sm text-center">
              Error al guardar: {updateMutation.error.message}
            </div>
          )}
        </form>
      </main>

      <Footer />
    </div>
  )
}
