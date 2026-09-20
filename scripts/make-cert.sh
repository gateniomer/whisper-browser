#!/usr/bin/env bash
# Generates a self-signed cert for local HTTPS so mobile browsers expose the
# microphone. Re-run this if your LAN IP changes.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p certs

IP="$(hostname -I | awk '{print $1}')"
echo "Generating self-signed cert for $IP"

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/key.pem -out certs/cert.pem -days 825 \
  -subj "/CN=$IP" \
  -addext "subjectAltName=IP:$IP,IP:127.0.0.1,DNS:localhost"

echo "Wrote certs/key.pem and certs/cert.pem"
