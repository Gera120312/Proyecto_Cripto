#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Script de Inicio del Servidor CryptoStream
# ═══════════════════════════════════════════════════════════════════════════
# Arquitectura Zero-Trust / E2EE (BYOK)
# ────────────────────────────────────────────────────────────────────────────
# El servidor es ciego: no genera ni mantiene llaves. No hay JWT ni claves
# ECDSA/RSA en backend. La autenticación es challenge-response y el cifrado
# de videos se realiza en el frontend.

echo "🚀 Iniciando CryptoStream Backend (Zero-Trust)..."
echo ""

npm start
