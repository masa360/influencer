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
# npx を挟まず node で直接起動する（Cloud Run の停止信号 SIGTERM を確実に受け取り、データを保存してから終了するため）
CMD ["node", "--import", "tsx", "server.ts"]
