# Umpi — Promo Video (HyperFrames)

Video promocional de 15 segundos para Umpi, construido con [HyperFrames](https://github.com/heygen-com/hyperframes).

## Estructura del video

| Tiempo | Escena | Contenido |
|--------|--------|-----------|
| 0-3s | Título | Logo Umpi + tagline con reveal animado |
| 3-8s | Features | Tres tarjetas: Destacados, Planes, Publicar |
| 8-12s | Publicar | Flujo de publicación + mock de celular |
| 12-15s | Final | Logo + URL + CTA |

## Requisitos

- **Node.js 22+** (HyperFrames lo requiere). Si usás nvm: `nvm install 22 && nvm use 22`
- pnpm

## Instalación

```bash
cd umpi-video
pnpm install
```

## Vista previa (sin HyperFrames)

Podés abrir el HTML directamente en el navegador:

```bash
open composition/index.html
```

Esto muestra la composición animada. Para reproducirla, abrí la consola del navegador y ejecutá:

```js
window.__timelines['umpi-promo'].play()
```

## Vista previa (con HyperFrames Studio)

```bash
pnpm preview
```

Abre `http://localhost:3000` en el navegador.

## Renderizar a MP4

```bash
pnpm render
```

Esto genera `renders/umpi-promo.mp4` (1920×1080, 30fps, 15s).

## Personalización

- **Colores:** Editar variables CSS en `:root` dentro de `composition/index.html`
- **Duración:** Cambiar `data-duration` en `#stage` y ajustar los tiempos del timeline GSAP
- **Contenido:** Modificar texto, iconos y tarjetas directamente en el HTML
- **Animaciones:** Ajustar parámetros de `gsap.timeline()` al final del archivo

## Paleta de colores

| Variable | Color | Uso |
|----------|-------|-----|
| `--bg` | `#0a0a0a` | Fondo principal |
| `--primary` | `#FF6B35` | Acento Umpi (naranja) |
| `--cyan` | `#00f5d4` | Acento tech (cian) |
| `--ink` | `#ffffff` | Texto principal |
| `--surface` | `#141414` | Superficies / tarjetas |

## Tech stack

- **HyperFrames** — Composición de video HTML
- **GSAP 3.12** — Animaciones timeline
- **Plus Jakarta Sans** — Tipografía (Google Fonts)
- **Material Symbols** — Iconos
