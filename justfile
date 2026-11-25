# Personal Multi-Source RSS Reader — Task Runner (https://just.systems)

set shell := ["bash", "-euo", "pipefail", "-c"]
set dotenv-load

export PATH := env('HOME') + "/.local/bin:" + env('PATH')

uv := env('UV', 'uv')
frontend_pm := shell('command -v pnpm >/dev/null 2>&1 && echo pnpm || echo npm')
backend_host := env('BACKEND_HOST', '127.0.0.1')
backend_port := env('BACKEND_PORT', '8000')

# Show available recipes
[private]
@default:
    just --list --unsorted

# Install backend and frontend dependencies
[group('setup')]
install: install-backend install-frontend

# Install backend dependencies (including dev tools) via uv
[group('setup')]
[working-directory('backend')]
install-backend:
    {{ uv }} sync --group dev

# Install frontend dependencies via pnpm (or npm)
[group('setup')]
[working-directory('frontend')]
install-frontend:
    {{ frontend_pm }} install

# Launch backend and frontend locally via ./start.sh
[group('dev')]
dev:
    ./start.sh

# Start FastAPI backend dev server with hot reload
[group('dev')]
[working-directory('backend')]
dev-backend:
    {{ uv }} run uvicorn app.main:app --host {{ backend_host }} --port {{ backend_port }} --reload

# Start Vite frontend dev server
[group('dev')]
[working-directory('frontend')]
dev-frontend:
    {{ frontend_pm }} run dev

# Run backend and frontend linters and type checks
[group('quality')]
lint: lint-backend lint-frontend

# Run backend static analysis (ruff + mypy)
[group('quality')]
[working-directory('backend')]
lint-backend:
    {{ uv }} run ruff check .
    {{ uv }} run mypy app tests

# Run frontend static analysis (ESLint + TypeScript)
[group('quality')]
[working-directory('frontend')]
lint-frontend:
    {{ frontend_pm }} run lint
    {{ frontend_pm }} run typecheck

# Run backend and frontend unit test suites
[group('quality')]
test: test-backend test-frontend

# Run backend unit tests (pytest)
[group('quality')]
[working-directory('backend')]
test-backend *args:
    {{ uv }} run pytest {{ args }}

# Run frontend unit tests (vitest)
[group('quality')]
[working-directory('frontend')]
test-frontend:
    {{ frontend_pm }} run test

# Build production frontend bundle (frontend/dist)
[group('quality')]
[working-directory('frontend')]
build:
    {{ frontend_pm }} run build

# Run full quality gate (lint + test + build)
[group('quality')]
check: lint test build

# Remove build artifacts and tool caches (preserves SQLite database)
[group('maintenance')]
clean:
    rm -rf \
        frontend/dist \
        frontend/dist-ssr \
        frontend/coverage \
        frontend/.vite \
        backend/.pytest_cache \
        backend/.mypy_cache \
        backend/.ruff_cache \
        backend/.coverage \
        backend/htmlcov \
        .pytest_cache \
        .mypy_cache \
        .ruff_cache
    find backend -path 'backend/.venv' -prune -o -type d -name '__pycache__' -prune -exec rm -rf {} +
