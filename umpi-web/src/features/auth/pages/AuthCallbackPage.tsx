import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState('');

  // 🚀 CANDADO MÁGICO: Evita que React ejecute la función dos veces seguidas
  const isProcessing = useRef(false);

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
          isProcessing.current = true; // Cerramos el candado inmediatamente
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            setError(error.message);
            return;
          }
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
          isProcessing.current = true; // Cerramos el candado inmediatamente
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) {
            setError(error.message);
            return;
          }
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
