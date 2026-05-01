FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY node_modules ./node_modules
COPY . .
RUN mkdir -p data backups
EXPOSE 4000
CMD ["node", "index.js"]
