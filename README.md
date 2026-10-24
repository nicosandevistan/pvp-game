# ⚡ PvP Math Duel

Real-time multiplayer mental math game. Two players race to answer the same question — first to 10 correct answers wins.

## Stack

- **Node.js + Express** — serves the static frontend
- **Socket.io** — real-time WebSocket communication
- **No database** — all state lives in memory

## Run locally

```bash
npm install
npm start
# open http://localhost:3000 in two tabs
```

## Deploy to Render (free)

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Settings:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Environment:** Node
5. Deploy — get a public URL, share it with a friend

## How it works

```
Player A connects → joins queue
Player B connects → joins queue → server pairs them → game room created
Both get the same question → first correct answer scores a point
First to 10 points wins
```
