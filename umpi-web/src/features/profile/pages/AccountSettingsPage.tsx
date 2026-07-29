/**
 * AccountSettingsPage — Edit profile (name, city, avatar) and app preferences.
 *
 * WHY: Users need to update their personal info and preferences in one place.
 * Uses Select + useCities pattern from PublishPage for consistency.
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabase'
import { uploadAvatar } from '../../../lib/upload'
import Navbar from '../../../components/layout/Navbar'
import Footer from '../../../components/layout/Footer'
import Select from '../../../components/ui/Select'
import { useAuth } from '../../../contexts/AuthContext'
import { useCities } from '../../../hooks/useCities'
import { useTheme } from '../../../contexts/ThemeContext'

export default function AccountSettingsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { profile, isLoading: loadingAuth, session } = useAuth()
  const { data: cities } = useCities()
  const { toggleTheme, isDark } = useTheme()

  const [fullName, setFullName] = useState('')
  const [cityName, setCityName] = useState('')
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Pre-fill form with current profile data
  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || '')
      setCityName(profile.location || '')
    }
  }, [profile])

  const cityOptions = useMemo(
    () => cities?.map((city) => ({ value: city.name, label: city.name })) || [],
    [cities]
  )

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.id || !session?.user?.id) throw new Error('No hay perfil autenticado')

      let avatar_url = profile.avatar_url

      // Upload avatar if changed
      if (avatarFile) {
        avatar_url = await uploadAvatar(avatarFile, session.user.id)
      }

      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim() || null,
          location: cityName || null,
          avatar_url,
        })
        .eq('id', profile.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'profile'] })
      setAvatarFile(null)
      setFeedback({ type: 'success', message: 'Perfil actualizado correctamente' })
    },
    onError: (error) => {
      setFeedback({ type: 'error', message: `Error al guardar: ${error.message}` })
    },
  })

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate
    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']
    if (!ALLOWED.includes(file.type)) {
      setFeedback({ type: 'error', message: 'Formato no soportado. Usá JPG, PNG o WEBP.' })
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setFeedback({ type: 'error', message: 'La imagen supera los 5MB' })
      return
    }

    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
  }

  if (loadingAuth) {
    return (
      <div className="bg-background text-on-surface antialiased min-h-screen flex flex-col font-body-base">
        <Navbar />
        <main className="flex-grow flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-primary-container border-t-transparent rounded-full animate-spin" />
        </main>
        <Footer />
      </div>
    )
  }

  if (!profile) {
    navigate('/login')
    return null
  }

  return (
    <div className="bg-background text-on-surface antialiased min-h-screen flex flex-col font-body-base">
      <Navbar />

      <main className="flex-grow w-full max-w-2xl mx-auto px-margin-mobile md:px-margin-desktop py-xxl">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => navigate('/perfil')}
            className="w-10 h-10 rounded-full bg-surface border border-border-light flex items-center justify-center hover:bg-surface-container-low transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
          </button>
          <h1 className="font-title-lg text-title-lg text-on-surface">
            Configuración de Cuenta
          </h1>
        </div>

        {/* Form */}
        <div className="bg-surface rounded-xl shadow-card p-6 md:p-8 space-y-6">
          {/* ── Avatar ───────────────────────────────────────────── */}
          <div className="flex items-center gap-4">
            <div className="relative">
              {avatarPreview || profile.avatar_url ? (
                <img
                  src={avatarPreview || profile.avatar_url!}
                  alt="Avatar"
                  className="w-20 h-20 rounded-full object-cover border-2 border-border-light"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-primary-fixed-dim flex items-center justify-center">
                  <span className="material-symbols-outlined text-[36px] text-on-primary-fixed">
                    person
                  </span>
                </div>
              )}
              {avatarFile && (
                <span className="absolute -bottom-1 -right-1 w-5 h-5 bg-primary-container rounded-full flex items-center justify-center">
                  <span className="material-symbols-outlined text-[14px] text-white">edit</span>
                </span>
              )}
            </div>
            <div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="font-label-bold text-label-bold text-primary-container hover:underline"
              >
                {profile.avatar_url ? 'Cambiar foto' : 'Agregar foto'}
              </button>
              <p className="text-[12px] text-text-muted mt-0.5">JPG, PNG o WEBP. Máx 5MB.</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleAvatarSelect}
              />
            </div>
          </div>

          {/* ── Full Name ─────────────────────────────────────────── */}
          <div className="space-y-2">
            <label className="font-label-bold text-label-bold text-on-surface block">
              Nombre completo
            </label>
            <input
              className="w-full bg-surface border border-border-light rounded-[14px] px-[14px] py-3 focus:ring-2 focus:ring-primary-container focus:border-primary-container font-body-base text-body-base outline-none transition-all"
              placeholder="Tu nombre completo"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>

          {/* ── City ──────────────────────────────────────────────── */}
          <Select
            label="Ciudad"
            value={cityName}
            onChange={setCityName}
            placeholder="Seleccioná tu ciudad"
            options={cityOptions}
          />

          {/* ── Theme Toggle ────────────────────────────────────────── */}
          <div className="flex items-center justify-between py-4 border-t border-border-light">
            <div>
              <p className="font-label-bold text-label-bold text-on-surface">Modo oscuro</p>
              <p className="text-[13px] text-text-secondary mt-0.5">
                {isDark ? 'Activado' : 'Desactivado'}
              </p>
            </div>
            <button
              onClick={toggleTheme}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                isDark ? 'bg-primary-container' : 'bg-border-light'
              }`}
              aria-label="Alternar modo oscuro"
            >
              <span
                className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform flex items-center justify-center ${
                  isDark ? 'translate-x-6' : 'translate-x-0.5'
                }`}
              >
                <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  {isDark ? 'dark_mode' : 'light_mode'}
                </span>
              </span>
            </button>
          </div>

          {/* ── Feedback ──────────────────────────────────────────── */}
          {feedback && (
            <div
              className={`rounded-[14px] px-4 py-3 text-sm font-label-bold ${
                feedback.type === 'success'
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-error-container text-error border border-error/20'
              }`}
            >
              {feedback.message}
            </div>
          )}

          {/* ── Actions ───────────────────────────────────────────── */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => navigate('/perfil')}
              className="flex-1 h-[48px] rounded-[14px] border border-border-light text-text-secondary font-label-bold text-label-bold hover:bg-surface-container-low transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="flex-1 h-[48px] rounded-[14px] bg-primary-container text-on-primary font-label-bold text-label-bold hover:bg-primary-dark transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saveMutation.isPending ? (
                'Guardando...'
              ) : (
                <>
                  <span className="material-symbols-outlined text-[18px]">save</span>
                  Guardar
                </>
              )}
            </button>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
