# Cloud Run などにデプロイするためのコンテナ定義
# 使い方は docs/SETUP_GUIDE.md の「STEP 4」を参照
FROM node:22-slim

WORKDIR /app

# 依存関係（tsx で TypeScript を直接実行するため devDependencies も入れる）
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# アプリ本体をコピーして画面をビルド
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
# 設定・受信ログの保存先。Cloud Run では永続ボリュームをここにマウントする
ENV DATA_DIR=/data

EXPOSE 8080
CMD ["npx", "tsx", "server.ts"]
