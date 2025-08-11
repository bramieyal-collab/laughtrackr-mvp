FROM node:20-slim AS build
WORKDIR /app
COPY web/package.json web/package-lock.json* web/yarn.lock* /app/
RUN npm install
COPY web /app
# Build static assets (Vite)
RUN npm run build

# Serve via Vite preview (simple for MVP)
FROM node:20-slim
WORKDIR /app
COPY --from=build /app /app
EXPOSE 5173
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "5173"]
