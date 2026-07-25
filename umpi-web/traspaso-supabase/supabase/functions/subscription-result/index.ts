import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

serve(async (req) => {
  const url = new URL(req.url)
  // Forward all query params MP appended (status, preapproval_id, etc.)
  const params = url.searchParams.toString()
  const deepLink = `umpi://subscription/result${params ? '?' + params : ''}`

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Redirigiendo...</title>
  <script>
    window.location.href = '${deepLink}';
  </script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: #f5f5f5;
      color: #333;
      text-align: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
      max-width: 360px;
    }
    h1 { font-size: 20px; margin: 0 0 8px; }
    p { font-size: 14px; color: #666; margin: 0 0 20px; }
    a {
      display: inline-block;
      background: #FF6B35;
      color: white;
      text-decoration: none;
      padding: 12px 24px;
      border-radius: 12px;
      font-weight: 600;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>¡Suscripción exitosa!</h1>
    <p>Tu plan ya está activo. Redirigiendo a la aplicación...</p>
    <a href="${deepLink}">Volver a la aplicación</a>
  </div>
</body>
</html>`

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
})
