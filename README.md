# TwoDrive-Backend

Servidor Express básico para manejo de archivos, usuarios, y compartición. Este README incluye una guía rápida y la configuración de CI/CD mínima.

## Requisitos
- Node.js 20+
- npm

## Ejecutar localmente
```bash
npm ci
npm start
```
La app arranca en `http://localhost:3001` (o el puerto definido en `PORT`).

## Variables de entorno
Crea un archivo `.env` (no se sube al repo) con tus credenciales. Ejemplos comunes:
```
PORT=3001
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=secret
DB_NAME=twodrive
JWT_SECRET=tu_secreto
```

## Ejecutar con Docker
Construir y correr (puedes mapear un volumen para `uploads/` si quieres persistencia):
```bash
# Construir imagen
docker build -t twodrive-backend:local .

# Ejecutar contenedor
docker run --rm -p 3001:3001 \
  -e PORT=3001 \
  --name twodrive twodrive-backend:local
```

Para usar variables de entorno desde un archivo `.env`:
```bash
docker run --rm -p 3001:3001 --env-file .env --name twodrive twodrive-backend:local
```

### Persistencia de `uploads/`
```bash
docker run --rm -p 3001:3001 \
  -v %cd%/uploads:/app/uploads \
  --env-file .env \
  --name twodrive twodrive-backend:local
```

## CI/CD (GitHub Actions)
- CI: `.github/workflows/ci.yml`
  - Corre en push/PR a `main`
  - Instala dependencias y ejecuta scripts básicos
- CD: `.github/workflows/cd.yml`
  - Construye y publica una imagen Docker en GitHub Container Registry (GHCR) en cada push a `main`
  - Tags: `latest` y `sha`

La imagen se publica como: `ghcr.io/<owner>/<repo>:latest`.

Permisos: el workflow ya declara `packages: write` y usa `GITHUB_TOKEN`. No necesitas secretos adicionales para GHCR.

## Notas
- El script de `test` ahora no falla por defecto (no hay pruebas todavía). Cuando agregues tests, actualiza `"test"` en `package.json`.
- El servidor ahora respeta la variable `PORT`.
