SHELL := /usr/bin/env bash
export PATH := $(HOME)/.local/bin:$(PATH)

UV ?= uv
FRONTEND_PM := $(shell command -v pnpm >/dev/null 2>&1 && echo pnpm || echo npm)

.PHONY: help install dev build test test-backend test-frontend lint lint-backend lint-frontend

help:
	@echo "Personal Multi-Source RSS Reader — Available targets:"
	@echo "  make install        Install backend (uv) and frontend ($(FRONTEND_PM)) dependencies"
	@echo "  make dev            Launch backend + frontend locally via ./start.sh"
	@echo "  make build          Build production frontend bundle (frontend/dist)"
	@echo "  make test           Run backend (pytest) and frontend (vitest) test suites"
	@echo "  make lint           Run ruff + mypy (backend) and eslint + tsc (frontend)"

install:
	@echo "==> Installing backend dependencies (uv)..."
	cd backend && $(UV) sync --all-extras
	@echo "==> Installing frontend dependencies ($(FRONTEND_PM))..."
	cd frontend && $(FRONTEND_PM) install

dev:
	./start.sh

build:
	@echo "==> Building frontend production bundle..."
	cd frontend && $(FRONTEND_PM) run build

test: test-backend test-frontend

test-backend:
	@echo "==> Running backend tests (pytest)..."
	cd backend && $(UV) run pytest

test-frontend:
	@echo "==> Running frontend tests (vitest)..."
	cd frontend && $(FRONTEND_PM) run test

lint: lint-backend lint-frontend

lint-backend:
	@echo "==> Running backend static analysis (ruff + mypy)..."
	cd backend && $(UV) run ruff check .
	cd backend && $(UV) run mypy app

lint-frontend:
	@echo "==> Running frontend static analysis (eslint + tsc)..."
	cd frontend && $(FRONTEND_PM) run lint
	cd frontend && $(FRONTEND_PM) run typecheck
