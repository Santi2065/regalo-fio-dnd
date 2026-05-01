# Auto-updater — setup inicial (1 sola vez)

La app v1.5+ se auto-actualiza cuando arranca. Para que eso funcione hay que firmar los releases con un par de claves. Esto se hace **una sola vez** y después es transparente.

Estos son los 4 pasos. Total ~5 minutos.

---

## 1. Generar el par de claves

Desde la raíz del repo:

```bash
npm run tauri signer generate -- -w src-tauri/.tauri-updater.key --ci
```

- `-w src-tauri/.tauri-updater.key`: dónde escribir la clave privada.
- `--ci`: crea la clave sin password (más simple para CI).

Esto crea dos archivos:

- `src-tauri/.tauri-updater.key` — **PRIVADA**, la que firma releases.
- `src-tauri/.tauri-updater.key.pub` — pública, va embebida en la app.

Ambos archivos están en `.gitignore`, **no se commitean**.

---

## 2. Pegar la clave pública en `tauri.conf.json`

Abrí `src-tauri/.tauri-updater.key.pub` y copiá su contenido (es una sola línea base64).

En `src-tauri/tauri.conf.json` reemplazá:

```json
"pubkey": "REPLACE_WITH_PUBKEY_FROM_TAURI_SIGNER_GENERATE",
```

por:

```json
"pubkey": "<el contenido del .pub>",
```

Commiteá ese cambio.

---

## 3. Subir la clave privada a GitHub Secrets

Abrí el repo en GitHub → **Settings → Secrets and variables → Actions → New repository secret**.

Creá estos dos secrets:

| Nombre | Valor |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | El contenido completo de `src-tauri/.tauri-updater.key` (es una sola línea). |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Vacío (string en blanco, dado que usamos `--ci`). |

Si usás `gh` desde la terminal:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < src-tauri/.tauri-updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --body ""
```

---

## 4. Hacer un release de prueba

Después de mergear v1.5:

```bash
git tag v1.5.0
git push origin v1.5.0
```

GitHub Actions va a:

1. Compilar para Windows + Linux.
2. Firmar los bundles con tu clave privada.
3. Subir el `.exe` / `.deb` al release.
4. Generar `latest.json` con la firma + URL del bundle.

Una vez publicado, instalá esa versión en una máquina, después subí un v1.5.1 con un cambio chiquito (un texto que diga "estoy en 1.5.1"), y al abrir la v1.5.0 tendría que aparecer el toast de update + descarga + modal "Reiniciar".

---

## Cómo rotar la clave

Si la clave se compromete o querés rotarla:

1. Repetí el paso 1 con un archivo nuevo.
2. Reemplazá la pubkey en `tauri.conf.json` y commiteá.
3. Sobreescribí los secrets en GitHub (paso 3).

**Cuidado**: la app vieja con la pubkey vieja **no va a poder auto-actualizarse a la versión nueva firmada con la clave nueva**. Los users tendrían que descargar el instalador manualmente una vez. Por eso conviene que la clave sea estable y solo rotarla si es necesario.

---

## Cómo se ve el flujo desde el lado del usuario

1. Abre la app v1.5.0.
2. A los 3 segundos, en background, se conecta a `https://github.com/Santi2065/regalo-fio-dnd/releases/latest/download/latest.json`.
3. Si la versión del manifest es mayor que la instalada, **descarga sola** y muestra un toast abajo a la derecha con barra de progreso.
4. Cuando termina la descarga + instalación, modal: *"v1.5.1 lista. Reiniciar ahora / Después"*.
5. Si elige "Después", queda un pill discreto en la esquina hasta que decida reiniciar (o cerrar la app).

Si no hay internet, o el server falla, o la firma no valida, **no aparece nada** — la app sigue funcionando normal. Los errores van a la consola para debug pero no molestan al usuario.
