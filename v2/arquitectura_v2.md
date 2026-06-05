# Prospector AI 2.0 - Arquitectura y Plan de Implementación

## 🌟 Visión General
Prospector AI 2.0 es una reescritura total del sistema original enfocada en **escalabilidad, diseño premium, y anti-ban infalible**. 
Se abandona el uso de archivos JSON locales en favor de una base de datos relacional ultrarrápida (SQLite) y una interfaz moderna construida con **React, Vite y TailwindCSS**.

## 🛠 Stack Tecnológico

### Backend (El Motor)
- **Runtime:** Node.js + Express
- **Base de Datos:** SQLite (vía `better-sqlite3` para sincronía atómica de alta velocidad).
- **Control de WhatsApp:** `whatsapp-web.js` con soporte mejorado para Multi-dispositivo y reconexión automática anti-zombi.
- **Comunicación en Vivo:** `socket.io`

### Frontend (La Interfaz Visual)
- **Framework:** React 18 + Vite (Para una carga instantánea)
- **Estilos:** TailwindCSS + Framer Motion (Modo oscuro nativo, glassmorphism, micro-animaciones premium).
- **Navegación:** React Router DOM (Single Page Application real).
- **Iconografía:** Lucide React (Iconos nítidos y modernos).

## 🚀 Fase 1: Inicialización (Completada)
- [x] Creación de carpeta aislada `v2` para no interrumpir el bot actual.
- [x] Inicialización del backend e instalación de dependencias Node.js.
- [x] Inicialización del frontend React/Vite e instalación de TailwindCSS.

## ⚙️ Fase 2: Construcción del Backend Core (En proceso)
- [ ] Implementación de `database.js` (SQLite) con tablas relacionales (`prospects`, `campaigns`, `templates`).
- [ ] Reescritura de `whatsappManager.js` v2 con auto-gestión de memoria e IDs limpios (`@c.us`).
- [ ] Reescritura de `campaignManager.js` v2 con Workers y colas seguras.
- [ ] Creación de Controladores REST API estructurados.

## 🎨 Fase 3: Construcción del Frontend Premium
- [ ] Sistema de Autenticación Visual (Pantalla de inicio futurista).
- [ ] Dashboard con métricas globales en tiempo real.
- [ ] Gestor de Campañas (Drag & drop, multi-selección, barra de progreso interactiva).
- [ ] Visor de WhatsApp Integrado (Socket.io stream) mejorado estéticamente.

## 🛡 Fase 4: Despliegue y Migración
- [ ] Herramienta para importar los datos JSON viejos a la nueva base de datos SQLite.
- [ ] Reemplazo del sistema viejo.
