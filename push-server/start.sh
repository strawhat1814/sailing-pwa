#!/bin/bash
set -e
cd "$(dirname "$0")"
npm install --omit=dev
exec node server.mjs