#!/bin/sh
set -e

# Apply any pending database migrations before the app starts.
# `migrate deploy` is the non-interactive, production-safe command: it only
# applies already-generated migrations and never prompts or resets.
echo "Running database migrations (prisma migrate deploy)..."
npx prisma migrate deploy

echo "Starting application..."
exec "$@"
