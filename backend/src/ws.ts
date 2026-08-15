import { Server } from "socket.io";

let io: Server | null = null;

export function setIo(server: Server) {
  io = server;
}

export function emitMatch(matchId: string, payload: unknown) {
  io?.to(`match:${matchId}`).emit("match:update", payload);
  io?.to("live").emit("live:update", { matchId, snapshot: payload });
}

export function emitTournament(tournamentId: string, payload: unknown) {
  io?.to(`tournament:${tournamentId}`).emit("tournament:update", payload);
}
