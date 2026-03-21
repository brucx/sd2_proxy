# Stage 1: Build the frontend (React)
FROM node:24-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install

COPY frontend ./
RUN npm run build

# Stage 2: Build the backend (Node.js)
FROM node:24-alpine AS backend-builder

WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json* ./
RUN npm install

COPY backend ./
RUN npm run build

# Stage 3: Final Runner
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# The backend relies on relative paths to access the frontend build:
# `app.use('/*', serveStatic({ root: '../frontend/dist' }));`
# So we need to maintain the /app/backend and /app/frontend/dist structure.

# Copy frontend static files
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Copy backend built files and dependencies
COPY --from=backend-builder /app/backend /app/backend

# The startup command `cd backend && npm start` is defined in root package.json
# Or we can just run it directly from backend directory.
COPY package.json /app/package.json

WORKDIR /app

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
