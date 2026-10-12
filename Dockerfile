# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
# VITE_PYRE_API_URL is passed as a build arg / env; empty defaults to demo mode.
ARG VITE_PYRE_API_URL=""
ENV VITE_PYRE_API_URL=$VITE_PYRE_API_URL
RUN npm run build

# ---- runtime ----
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
