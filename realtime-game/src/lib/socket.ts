import { io, Socket } from "socket.io-client";
import { MatchInitData, ClientInput, GameState } from "../game/types";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || `${window.location.protocol}//${window.location.hostname}:${window.location.port}`;
export let socket: Socket;

export const initSocket = () => {
  if (socket) return;
  socket = io(SERVER_URL, { transports: ["websocket"], reconnection: true });
};

export const findMatch = () => {
  if (!socket) initSocket();
  socket.emit("find-match");
};

export const onMatchStart = (callback: (data: MatchInitData) => void) => {
  socket.on("match-start", callback);
};

export const onRemoteInput = (callback: (data: { 
    role: "p1" | "p2", 
    input: ClientInput,
    serverState: GameState 
}) => void) => {
  socket.on("remote-input", callback);
};

export const onSyncEvent = (callback: (data: { type: string, state: GameState }) => void) => {
  socket.on("sync-event", callback);
};

export const sendInput = (roomId: string, input: ClientInput) => {
  if (!socket) return;
  socket.emit("player-input", { roomId, input });
};

export const onGameOver = (callback: (reason: string) => void) => {
  socket.on("game-over", callback);
};

// --- NEW FUNCTION ---
export const onDisconnect = (callback: (reason: string) => void) => {
  socket.on("disconnect", callback);
};

