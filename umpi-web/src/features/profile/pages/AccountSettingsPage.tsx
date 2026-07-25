/**
 * AccountSettingsPage — Edit profile name and city.
 *
 * WHY: Users need to update their personal info after registration.
 * Uses the same Select + useCities pattern from PublishPage for consistency.
 */

import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabase'
import Navbar from '../../../components/layout/Navbar'
import Footer from '../../../components/layout/Footer'
import Select from '../../../components/ui/Select'
import { useAuth } from '../../../contexts/AuthContext'
import { useCities } from '../../../hooks/useCities'

export default function AccountSettingsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { profile, isLoading: loadingAuth } = useAuth()
  const { data: cities } = useCities()

  const [fullName, setFullName] = useState('')
  const [cityName, setCityName] = useState('')
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

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
      if (!profile?.id) throw new Error('No hay perfil autenticado')

      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim() || null,
          location: cityName || null,
        })
        .eq('id', profile.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'profile'] })
      setFeedback({ type: 'success', message: 'Perfil actualizado correctamente' })
    },
    onError: (error) => {
      setFeedback({ type: 'error', message: `Error al guardar: ${error.message}` })
    },
  })

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
          {/* Full Name */}
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

          {/* City */}
          <Select
            label="Ciudad"
            value={cityName}
            onChange={setCityName}
            placeholder="Seleccioná tu ciudad"
            options={cityOptions}
          />

          {/* Feedback */}
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

          {/* Actions */}
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
