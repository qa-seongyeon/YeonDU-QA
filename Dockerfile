FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

COPY yeondu-qa/package.json ./
RUN npm install --omit=dev

COPY yeondu-qa/ .

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
