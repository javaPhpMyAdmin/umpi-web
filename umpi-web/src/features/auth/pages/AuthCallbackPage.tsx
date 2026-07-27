import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';

/**
 * AuthCallbackPage — handles Google OAuth + Magic Link callbacks.
 * After session is established, ensures a profile exists in `profiles`
 * (important for Google users who don't go through registerMutation).
 */
export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState('');

  // CANDADO: Evita que React ejecute la función dos veces seguidas
  const isProcessing = useRef(false);

  // Ensures profile exists after OAuth login (Google users need this)
  const ensureProfile = async (userId: string) => {
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (!existing) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const fullName =
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email?.split('@')[0] ||
        'Usuario';
      const avatarUrl = user.user_metadata?.avatar_url || null;

      await supabase.from('profiles').upsert({
        id: userId,
        full_name: fullName,
        avatar_url: avatarUrl,
        // Fallback: set trial directly in case the DB trigger isn't created yet
        subscription_status: 'trial',
        trial_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
    }
  };

  useEffect(() => {
    const handleCallback = async () => {
      if (isProcessing.current) return;

      try {
        // 🚀 VERIFICACIÓN PREVENTIVA: Si la primera ejecución ya te logueó,
        // la segunda ejecución se entera acá y te manda al inicio de una.
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session) {
          navigate('/');
          return;
        }

        // PKCE flow: exchange code for session
        const code = searchParams.get('code');
        if (code) {
          isProcessing.current = true;
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            setError(error.message);
            return;
          }
          // Ensure profile exists (handles Google OAuth new users)
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) await ensureProfile(session.user.id);
          navigate('/');
          return;
        }

        // Implicit flow: session in URL hash
        const hashParams = new URLSearchParams(
          window.location.hash.substring(1),
        );
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');

        if (accessToken && refreshToken) {
          isProcessing.current = true;
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) {
            setError(error.message);
            return;
          }
          // Ensure profile exists (handles Google OAuth new users)
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) await ensureProfile(session.user.id);
          navigate('/');
          return;
        }

        // No params: redirect to login
        navigate('/login');
      } catch (err) {
        setError(
          'Ocurrió un error inesperado al procesar el inicio de sesión.',
        );
      }
    };

    void handleCallback();
  }, [navigate, searchParams]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-bold mb-2">Error de autenticación</h1>
          <p className="text-gray-600 mb-4">{error}</p>
          <a href="/login" className="text-blue-600 hover:underline">
            Volver al login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
        <p className="text-gray-600">Procesando autenticación...</p>
      </div>
    </div>
  );
}

// export default function AuthCallbackPage() {
//   const navigate = useNavigate()
//   const [searchParams] = useSearchParams()
//   const [error, setError] = useState('')

//   useEffect(() => {
//     const handleCallback = async () => {
//       // PKCE flow: exchange code for session
//       const code = searchParams.get('code')
//       if (code) {
//         const { error } = await supabase.auth.exchangeCodeForSession(code)
//         if (error) {
//           setError(error.message)
//           return
//         }
//         navigate('/')
//         return
//       }

//       // Implicit flow: session in URL hash
//       const hashParams = new URLSearchParams(window.location.hash.substring(1))
//       const accessToken = hashParams.get('access_token')
//       const refreshToken = hashParams.get('refresh_token')
//       if (accessToken && refreshToken) {
//         const { error } = await supabase.auth.setSession({
//           access_token: accessToken,
//           refresh_token: refreshToken,
//         })
//         if (error) {
//           setError(error.message)
//           return
//         }
//         navigate('/')
//         return
//       }

//       // No params: redirect to login
//       navigate('/login')
//     }

//     handleCallback()
//   }, [navigate, searchParams])

//   if (error) {
//     return (
//       <div className="min-h-screen flex items-center justify-center">
//         <div className="text-center">
//           <h1 className="text-xl font-bold mb-2">Error de autenticacion</h1>
//           <p className="text-gray-600 mb-4">{error}</p>
//           <a href="/login" className="text-blue-600 hover:underline">Volver al login</a>
//         </div>
//       </div>
//     )
//   }

//   return (
//     <div className="min-h-screen flex items-center justify-center">
//       <div className="text-center">
//         <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
//         <p className="text-gray-600">Procesando autenticacion...</p>
//       </div>
//     </div>
//   )
// }
