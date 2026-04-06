# 🎲 DnD Orchestrator

Una herramienta de escritorio para directores de juego de D&D. Guión interactivo, soundboard con hotkeys, proyección de mapas con niebla de guerra, tracker de iniciativa, notas, fichas de personaje y control de Spotify — todo en una sola ventana.

---

## Instalación

### Windows
Descargá el instalador desde [Releases](https://github.com/Santi2065/regalo-fio-dnd/releases/latest):

```
DnD Orchestrator_*_x64-setup.exe
```

Ejecutalo y seguí los pasos. Windows puede mostrar una advertencia de SmartScreen — hacé click en **"Más información" → "Ejecutar de todas formas"**.

> **Requisito:** Windows 10 o superior. WebView2 se instala automáticamente si no está.

### Linux (Debian / Ubuntu)
```bash
sudo dpkg -i "DnD Orchestrator_*_amd64.deb"
```

O sin instalación con el AppImage:
```bash
chmod +x "DnD Orchestrator_*.AppImage"
./"DnD Orchestrator_*.AppImage"
```

---

## Funcionalidades

### 📜 Guión
Escribí la sesión completa en **modo Prep** usando Markdown. Podés embeber *cues* de audio y proyección directamente en el texto arrastrando assets desde el panel lateral.

En **modo Live** el guión se convierte en un teleprompter interactivo: los cues aparecen como botones que ejecutan sonidos y proyectan imágenes mientras narrás.

**Sintaxis de cues:**
| Cue | Efecto |
|---|---|
| `%%sfx:id:Nombre%%` | Efecto de sonido (disparo único) |
| `%%ambient:id:Nombre%%` | Música de ambiente en loop (toggle on/off) |
| `%%project:id:Nombre%%` | Proyectar imagen o video en segundo monitor |

### 🔊 Soundboard
16 celdas de audio configurables. Arrastrá cualquier archivo de audio a una celda para asignarlo.

- **Click izquierdo** → disparar como SFX
- **Click derecho** → editar (label, volumen, modo loop, hotkey, color)
- Los **hotkeys** funcionan en cualquier sección de la app, sin necesidad de tener el soundboard visible

### 🖥 Proyección
Abrí una ventana en el monitor del jugador y proyectá imágenes o videos con un click. Incluye **Niebla de Guerra** para revelar el mapa progresivamente durante la sesión: pintá con el mouse para descubrir zonas, con modos reveal/hide y botones para deshacer.

### ⚔ Iniciativa
Tracker de combate completo:
- Lista ordenada por iniciativa con indicador de turno activo
- Barra de HP visual (verde → ámbar → rojo según porcentaje)
- Edición rápida de HP con delta (`+5`, `-12`, etc.)
- Condiciones de D&D 5e: Prone, Stunned, Poisoned, Blinded, Frightened, y más
- Contador de rondas
- Soporte para múltiples tipos: Jugador, Enemigo, NPC

### 📝 Notas
Editor Markdown por sesión con preview en tiempo real. Soporta títulos, listas, negrita, cursiva, tablas y código. Guardado automático con Ctrl+S.

### 👤 Fichas de personaje
Importá imágenes (jpg, png, webp) o PDFs como fichas de personaje. Se organizan en una grilla con viewer lateral para consultarlas rápido durante la sesión.

### 🎵 Spotify
Controlá Spotify sin salir de la app. Requiere tener Spotify activo en el sistema.

- Mini reproductor persistente al pie de la ventana (progreso, controles, volumen)
- Panel completo con playlists y tracklist
- Búsqueda dentro de la playlist activa
- Control de volumen integrado

**Primera vez:** conectá tu cuenta desde la pestaña 🎵 → "Conectar con Spotify" y autorizá en el navegador.

### 🗃 Assets
Los archivos (audio, imágenes, video, fichas) pueden pertenecer a una sesión específica o a la **Biblioteca Global** (disponible en todas las sesiones). Podés cambiar el tipo de cualquier asset (ej: convertir una imagen en "Ficha de personaje") desde el panel de detalle.

---

## Atajos de teclado

| Atajo | Acción |
|---|---|
| `Ctrl + 1` | Ir a Guión |
| `Ctrl + 2` | Ir a Assets |
| `Ctrl + 3` | Ir a Fichas de personaje |
| `Ctrl + 4` | Panel: Soundboard |
| `Ctrl + 5` | Panel: Proyección |
| `Ctrl + 6` | Panel: Iniciativa |
| `Ctrl + 7` | Panel: Notas |
| `Ctrl + 8` | Panel: Spotify |
| `Ctrl + \` | Colapsar / expandir panel derecho |
| `Ctrl + S` | Guardar guión (modo Prep) |

Los hotkeys del soundboard se configuran por celda y disparan sonidos desde cualquier parte de la app.

---

## Desarrollo local

```bash
# 1. Clonar e instalar dependencias
git clone https://github.com/Santi2065/regalo-fio-dnd.git
cd regalo-fio-dnd
npm install

# 2. Variables de entorno
cp .env.example .env
# Editá .env con tu VITE_SPOTIFY_CLIENT_ID de Spotify for Developers

# 3. Modo desarrollo (hot reload)
npm run tauri dev

# 4. Build de producción
npm run tauri build
```

**Dependencias del sistema (Linux):**
```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev \
  patchelf libssl-dev pkg-config libasound2-dev
```

### Stack
| Capa | Tecnología |
|---|---|
| Framework desktop | [Tauri v2](https://tauri.app) (Rust + WebView) |
| Frontend | React 19 + TypeScript + Tailwind CSS v4 |
| Estado global | Zustand |
| Base de datos | SQLite via rusqlite (bundled) |
| Audio | rodio (mp3, wav, flac, ogg) |
| Spotify | Web API + PKCE OAuth (sin SDK, controla el cliente desktop) |

---

## Licencia

Proyecto personal. No destinado a distribución pública.
