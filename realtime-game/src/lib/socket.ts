import { io, Socket } from "socket.io-client";
import { MatchInitData, ClientInput, GameState } from "../game/types";

const SERVER_URL = window.location.protocol === "https:" ? "https://pong-online-rs91.onrender.com" : `${window.location.protocol}//${window.location.hostname}:${window.location.port}`;
export let socket: Socket;
console.log("Connecting to server at:", SERVER_URL);
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

// --- NEW: Receive Full State Updates ---
export const onServerTick = (callback: (state: GameState) => void) => {
  socket.on("server-tick", callback);
};

export const sendInput = (roomId: string, input: ClientInput) => {
  if (!socket) return;
  socket.emit("player-input", { roomId, input });
};

export const onGameOver = (callback: (reason: string) => void) => {
  socket.on("game-over", callback);
};

export const onDisconnect = (callback: (reason: string) => void) => {
  socket.on("disconnect", callback);
};

