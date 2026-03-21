# Stage 1: Build the frontend (React)
FROM node:24-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

COPY frontend ./
RUN npm run build

# Stage 2: Build the backend (Node.js)
FROM node:24-alpine AS backend-builder

WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json* ./
RUN npm ci

COPY backend ./
RUN npm run build

# Stage 3: Final Runner (production-only)
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy frontend static files
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Copy only compiled backend + production dependencies
COPY --from=backend-builder /app/backend/dist /app/backend/dist
COPY --from=backend-builder /app/backend/package.json /app/backend/package.json
COPY --from=backend-builder /app/backend/package-lock.json* /app/backend/

WORKDIR /app/backend
RUN npm ci --omit=dev

WORKDIR /app

# Copy root package.json for startup script
COPY package.json /app/package.json

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
