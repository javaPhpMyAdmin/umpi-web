import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { Link, useSearchParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import type { SubscriptionPlan } from '../../../types'
import Navbar from '../../../components/layout/Navbar'
import Footer from '../../../components/layout/Footer'
import { formatPrice } from '../../../lib/utils'

function useSubscriptionPlans() {
  return useQuery({
    queryKey: ['subscription-plans'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('is_active', true)
        .order('listing_priority', { ascending: false })

      if (error) throw error
      return data as SubscriptionPlan[]
    },
  })
}

export default function PlansPage() {
  const { data: plans, isLoading } = useSubscriptionPlans()
  const { session, profile } = useAuth()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const [syncResult, setSyncResult] = useState<string | null>(null)

  // After MercadoPago redirect, sync subscription status
  useEffect(() => {
    const preapprovalId = searchParams.get('preapproval_id')
    if (preapprovalId && session) {
      supabase.functions.invoke('sync-subscription').then(({ error }) => {
        if (error) {
          console.error('sync-subscription error:', error)
        }
        // Always invalidate profile cache so UI reflects current state
        queryClient.invalidateQueries({ queryKey: ['auth'] })
        // Clean URL params so re-renders don't re-trigger sync
        window.history.replaceState({}, '', '/planes')
      })
    }
  }, [searchParams, session, queryClient])

  const hasActivePlan =
    profile?.subscription_type &&
    profile.subscription_type !== '' &&
    profile.subscription_type !== 'none' &&
    // Trust subscription_type; only reject if expires_at exists and has passed
    (!profile.subscription_expires_at || new Date(profile.subscription_expires_at) > new Date())

  // Trial logic
  const isInTrial =
    profile?.subscription_status === 'trial' &&
    profile?.trial_ends_at &&
    new Date(profile.trial_ends_at) > new Date()

  const trialDaysLeft = isInTrial
    ? Math.max(0, Math.ceil(
        (new Date(profile!.trial_ends_at!).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      ))
    : 0

  const createSubscription = useMutation({
    mutationFn: async (planId: string) => {
      const { data, error } = await supabase.functions.invoke('create-subscription', {
        body: {
          plan_id: planId,
          payer_email: 'test_user_906191175949745667@testuser.com',
          back_url: `${window.location.origin}/planes`,
        },
      })
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      if (data?.init_point) {
        window.location.href = data.init_point
      }
    },
  })

  const syncSubscription = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('sync-subscription')
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth'] })
      setSyncResult('¡Suscripción sincronizada! Recargá la página.')
    },
    onError: () => {
      setSyncResult('No se pudo sincronizar. Verificá que hayas completado el pago.')
    },
  })

  if (isLoading) {
    return (
      <div className="bg-background min-h-screen flex flex-col font-body-base text-body-base text-on-surface">
        <Navbar />
        <main className="flex-grow flex items-center justify-center">
          <div className="text-text-secondary">Cargando planes...</div>
        </main>
        <Footer />
      </div>
    )
  }

  return (
    <div className="bg-background min-h-screen flex flex-col font-body-base text-body-base text-on-surface">
      <Navbar />

      <main className="flex-grow flex flex-col pb-xxl">
        {/* Hero Section */}
        <section className="max-w-7xl mx-auto w-full px-margin-mobile md:px-margin-desktop pt-[64px] pb-xxl text-center">
          <h1 className="font-display-lg text-display-lg text-text-deep mb-lg">
            Impulsa tus publicaciones con Umpi
          </h1>
          <p className="font-header-md text-header-md text-text-secondary max-w-2xl mx-auto font-normal">
            Elige el plan que mejor se adapte a tus necesidades
          </p>
        </section>

        {/* Pricing Cards */}
        <section className="max-w-7xl mx-auto w-full px-margin-mobile md:px-margin-desktop mb-[80px] mt-xl">
          {/* Trial Banner */}
          {isInTrial && (
            <div className="bg-green-50 border border-green-200 rounded-[14px] p-lg mb-xl max-w-2xl mx-auto">
              <div className="flex items-center gap-3 mb-2">
                <span className="material-symbols-outlined text-green-600">celebration</span>
                <h3 className="font-label-bold text-label-bold text-green-800">
                  Estás en periodo de prueba
                </h3>
              </div>
              <p className="text-green-700 text-sm mb-3">
                Te quedan <strong>{trialDaysLeft}</strong> {trialDaysLeft === 1 ? 'día' : 'días'} de premium gratis
              </p>
              <div className="w-full bg-green-200 rounded-full h-2">
                <div
                  className="bg-green-600 h-2 rounded-full transition-all"
                  style={{ width: `${((30 - trialDaysLeft) / 30) * 100}%` }}
                />
              </div>
            </div>
          )}

          {plans && plans.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-xl md:gap-gutter max-w-4xl mx-auto">
              {[...plans].reverse().map((plan) => {
                const isPremium = plan.slug === 'premium'
                return (
                  <div
                    key={plan.id}
                    className={`bg-surface rounded-[16px] p-xl flex flex-col h-full relative ${
                      isPremium
                        ? 'shadow-card-featured border-[3px] border-gold-premium'
                        : 'shadow-card border-[3px] border-border-light'
                    }`}
                  >
                    {isPremium && (
                      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gold-premium text-white font-label-bold text-label-bold px-lg py-unit rounded-full">
                        Más Popular
                      </div>
                    )}
                    <div className="mb-lg pt-sm">
                      <h3 className="font-title-lg text-title-lg text-text-deep flex items-center gap-sm">
                        {plan.name}
                        {isPremium && (
                          <span className="material-symbols-outlined text-gold-premium material-symbols-filled text-[24px]">
                            stars
                          </span>
                        )}
                      </h3>
                      <p className="font-body-base text-body-base text-text-secondary mt-sm">
                        {isPremium ? 'Máximo rendimiento y soporte.' : 'Ideal para empezar a destacar.'}
                      </p>
                    </div>
                    <div className="mb-xxl">
                      {isInTrial && (
                        <span className="font-body-base text-body-base text-text-muted line-through mr-2">
                          {formatPrice(plan.price)}
                        </span>
                      )}
                      <span className={`font-display-lg text-display-lg ${isInTrial ? 'text-green-600' : 'text-text-deep'}`}>
                        {isInTrial ? 'Gratis' : formatPrice(plan.price)}
                      </span>
                      {!isInTrial && <span className="font-body-base text-body-base text-text-secondary">/mes</span>}
                    </div>
                    <ul className="flex flex-col gap-md mb-xxl flex-grow">
                      {plan.features.map((feature, i) => (
                        <li key={i} className="flex items-start gap-sm">
                          <span
                            className={`material-symbols-outlined text-[20px] mt-[2px] ${
                              isPremium ? 'text-primary-container' : 'text-secondary'
                            }`}
                          >
                            check_circle
                          </span>
                          <span className="font-body-base text-body-base text-text-deep">{feature}</span>
                        </li>
                      ))}
                    </ul>
                    {!session ? (
                      <Link
                        to="/login"
                        className={`w-full font-label-bold text-label-bold rounded-[14px] h-[56px] flex items-center justify-center transition-colors active:scale-95 duration-200 mt-auto ${
                          isPremium
                            ? 'bg-primary-container text-on-primary hover:opacity-90'
                            : 'bg-bg-peach-mid text-text-secondary hover:bg-[#FFD6BD]'
                        }`}
                      >
                        Iniciar sesión
                      </Link>
                    ) : isInTrial && isPremium ? (
                      <button
                        disabled
                        className="w-full font-label-bold text-label-bold rounded-[14px] h-[56px] bg-green-100 text-green-700 cursor-not-allowed mt-auto flex items-center justify-center gap-2"
                      >
                        <span className="material-symbols-outlined text-[20px]">check_circle</span>
                        Ya lo tenés gratis
                      </button>
                    ) : hasActivePlan ? (
                      <button
                        disabled
                        className="w-full font-label-bold text-label-bold rounded-[14px] h-[56px] bg-gray-300 text-gray-500 cursor-not-allowed mt-auto"
                      >
                        Plan activo
                      </button>
                    ) : (
                      <button
                        onClick={() => createSubscription.mutate(plan.id)}
                        disabled={createSubscription.isPending}
                        className={`w-full font-label-bold text-label-bold rounded-[14px] h-[56px] transition-colors active:scale-95 duration-200 mt-auto ${
                          isPremium
                            ? 'bg-primary-container text-on-primary hover:opacity-90'
                            : 'bg-bg-peach-mid text-text-secondary hover:bg-[#FFD6BD]'
                        } ${createSubscription.isPending ? 'opacity-50 cursor-wait' : ''}`}
                      >
                        {createSubscription.isPending ? 'Procesando...' : `Elegir ${plan.name}`}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center text-text-secondary">
              No hay planes disponibles en este momento.
            </div>
          )}
        </section>

        {createSubscription.isError && (
          <section className="max-w-7xl mx-auto w-full px-margin-mobile md:px-margin-desktop -mt-[48px]">
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-[14px] p-lg text-center max-w-md mx-auto">
              No se pudo procesar la suscripción. Intentá de nuevo más tarde.
            </div>
          </section>
        )}

        {session && !hasActivePlan && (
          <section className="max-w-7xl mx-auto w-full px-margin-mobile md:px-margin-desktop mt-lg text-center">
            <button
              onClick={() => { setSyncResult(null); syncSubscription.mutate() }}
              disabled={syncSubscription.isPending}
              className="text-sm text-text-secondary underline hover:text-text-deep transition-colors disabled:opacity-50"
            >
              {syncSubscription.isPending ? 'Sincronizando...' : 'Ya pagué, verificar mi suscripción'}
            </button>
            {syncResult && (
              <p className={`mt-sm text-sm ${syncResult.includes('¡') ? 'text-green-600' : 'text-red-600'}`}>
                {syncResult}
              </p>
            )}
          </section>
        )}
      </main>

      <Footer />
    </div>
  )
}
