# ============================================================
#  Dockerfile — ה-Worker (המוח) לאירוח בענן (Railway/Render)
#  כולל Chromium שדרוש ל-whatsapp-web.js
# ============================================================
FROM node:20-slim

# Chromium + פונטים + תעודות (apt מושך אוטומטית את שאר התלויות של Chromium)
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# puppeteer לא יוריד Chromium משלו — נשתמש במותקן במערכת
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app
COPY worker/package*.json ./
RUN npm install --omit=dev
COPY worker/src ./src

# שרת ה-QR/סטטוס מאזין על PORT שהענן מקצה
EXPOSE 3000
CMD ["node", "src/index.js"]
