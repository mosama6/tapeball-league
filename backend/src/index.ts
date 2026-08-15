import http from "node:http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import { config } from "./config.js";
import { api } from "./routes.js";
import { setIo } from "./ws.js";

const app = express();
app.use(cors({ origin: config.origins, credentials: true }));
app.use(express.json({ limit: "8mb" }));
app.use("/api", api);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message ?? "Server error" });
});

process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection", err);
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: config.origins, methods: ["GET", "POST"] }
});
setIo(io);

io.on("connection", (socket) => {
  socket.on("join:live", () => socket.join("live"));
  socket.on("join:match", (matchId: string) => socket.join(`match:${matchId}`));
  socket.on("leave:match", (matchId: string) => socket.leave(`match:${matchId}`));
  socket.on("join:tournament", (id: string) => socket.join(`tournament:${id}`));
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`Wolfpack Tape Ball League API on http://0.0.0.0:${config.port}`);
});
