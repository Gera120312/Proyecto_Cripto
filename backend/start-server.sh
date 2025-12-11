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

echo "Iniciando CryptoStream Backend..."
echo ""

# Verificar si el archivo .env existe
if [ ! -f ".env" ]; then
    echo "Archivo .env no encontrado."
    echo "Creando .env desde .env.example..."
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "✓ Archivo .env creado"
    else
        echo "⚠ Advertencia: .env.example no encontrado"
    fi
    echo ""
fi

# Verificar si las claves ECDSA están en .env
if ! grep -q "ECDSA_PRIVATE_KEY=" .env || ! grep -q "ECDSA_PUBLIC_KEY=" .env; then
    echo "Claves ECDSA no encontradas en .env"
    echo "Generando nuevo par de claves..."
    echo ""
    node generate-keys.js
    echo ""
fi

# Verificar si las claves RSA están en .env
if ! grep -q "RSA_PRIVATE_KEY=" .env || ! grep -q "RSA_PUBLIC_KEY=" .env; then
    echo "Claves RSA no encontradas en .env"
    echo "Generando nuevo par de claves RSA..."
    echo ""
    node generate-rsa-keys.js
    echo ""
fi

echo "✓ Variables de entorno verificadas"
echo "Iniciando servidor Node.js..."
echo ""

npm start
