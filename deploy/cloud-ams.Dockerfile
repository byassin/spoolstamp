FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY scripts/serve-cloud-ams.ts scripts/hosted-ams.ts scripts/cloud-ams.ts scripts/cloud-ams-errors.ts scripts/cloud-ams-network.ts scripts/ams-status-request.ts scripts/mqtt-limit.ts ./scripts/
COPY lib/ams.ts lib/cloud-ams.ts ./lib/
ENV NODE_ENV=production PORT=3100
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--experimental-strip-types", "scripts/serve-cloud-ams.ts"]
