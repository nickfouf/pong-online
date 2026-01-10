import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import { GameEngine } from "./engine";
import { GameState, ClientInput, TICK_RATE } from "./types"; 

const app = express();
app.use(express.static("site"));
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

const PORT = Number(process.env.PORT) || 3000;

interface GameRoom {
  id: string;
  p1: string; 
  p2: string; 
  state: GameState; 
  p1Input: ClientInput | undefined;
  p2Input: ClientInput | undefined;
  gameLoop: NodeJS.Timeout | null;
}

const rooms = new Map<string, GameRoom>();
const engine = new GameEngine();

let waitingPlayer: string | null = null;

io.on("connection", (socket: Socket) => {
  console.log(`User connected: ${socket.id}`);

    socket.on("find-match", () => {
        if (waitingPlayer && waitingPlayer !== socket.id) {
            const roomId = `room_${waitingPlayer}_${socket.id}`;
            const p1 = waitingPlayer;
            const p2 = socket.id;
            waitingPlayer = null;

            // --- FIX: ADD PLAYERS TO THE SOCKET.IO ROOM ---
            const p1Socket = io.sockets.sockets.get(p1);
            const p2Socket = socket; // Current socket is p2

            if (p1Socket) p1Socket.join(roomId);
            p2Socket.join(roomId);
            // ----------------------------------------------

            const matchSeed = Math.floor(Math.random() * 2000000000);
            const initialState = engine.createInitialState(matchSeed);

      const room: GameRoom = {
        id: roomId,
        p1, 
        p2,
        state: initialState,
        p1Input: undefined,
        p2Input: undefined,
        gameLoop: null
      };

      rooms.set(roomId, room);

      const MS_PER_TICK = 1000 / TICK_RATE;
      const matchStartTime = Date.now();

      room.gameLoop = setInterval(() => {
        const now = Date.now();
        const expectedTick = Math.floor((now - matchStartTime) / MS_PER_TICK);
        let loopCount = 0;

        while (room.state.tick < expectedTick && loopCount < 50) {
            engine.step(room.state, room.p1Input, room.p2Input);
            loopCount++;
        }

        // Broadcast authoritative state
        io.to(roomId).emit("server-tick", room.state);

      }, MS_PER_TICK);

      io.to(p1).emit("match-start", { role: "p1", roomId, serverTime: matchStartTime, seed: matchSeed });
      io.to(p2).emit("match-start", { role: "p2", roomId, serverTime: matchStartTime, seed: matchSeed });

      console.log(`Match started: ${roomId}`);

    } else {
      waitingPlayer = socket.id;
      console.log(`User ${socket.id} joined waiting room.`);
    }
  });

  // --- DEBUGGING INPUT ---
  socket.on("player-input", (data: { roomId: string, input: ClientInput }) => {
    const room = rooms.get(data.roomId);
    if (!room) return;

    // Log the first few inputs to verify connection
    if (Math.random() < 0.05) { // Don't spam logs, just 5% of inputs
        console.log(`Rx Input Room ${data.roomId.substring(0,8)} from ${socket.id === room.p1 ? "P1" : "P2"}: T:${data.input.tick} X:${data.input.targetX}`);
    }

    if (socket.id === room.p1) {
        room.p1Input = data.input;
    } else {
        room.p2Input = data.input;
    }
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
    if (waitingPlayer === socket.id) waitingPlayer = null;

    for (const [id, room] of rooms) {
      if (room.p1 === socket.id || room.p2 === socket.id) {
        if (room.gameLoop) clearInterval(room.gameLoop);
        rooms.delete(id);
        io.to(room.p1).emit("game-over", "Opponent disconnected");
        io.to(room.p2).emit("game-over", "Opponent disconnected");
      }
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});