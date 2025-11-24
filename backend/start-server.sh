#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Script de Inicio del Servidor CryptoStream
# ═══════════════════════════════════════════════════════════════════════════
# Este script configura el entorno y arranca el servidor backend.
#
# IMPORTANTE: Sistema de Claves ECDSA
# ────────────────────────────────────────────────────────────────────────────
# El servidor ahora usa criptografía asimétrica (ECDSA) para firmar y
# verificar tokens JWT, proporcionando mayor seguridad que claves simétricas.
#
# Si las claves NO EXISTEN, el script las generará automáticamente.
# ═══════════════════════════════════════════════════════════════════════════

echo "🚀 Iniciando CryptoStream Backend..."
echo ""

# Verificar si las claves ECDSA existen
if [ ! -f "keys/private.pem" ] || [ ! -f "keys/public.pem" ]; then
    echo "⚠️  Claves ECDSA no encontradas."
    echo "📦 Generando nuevo par de claves..."
    echo ""
    node generate-keys.js
    echo ""
fi

echo "✅ Claves ECDSA verificadas"
echo "🌐 Iniciando servidor Node.js..."
echo ""

npm start
