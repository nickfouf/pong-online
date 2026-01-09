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

// Room Data
interface GameRoom {
  id: string;
  p1: string; // Socket ID
  p2: string; // Socket ID
  state: GameState; 
  // Store inputs so the server loop can use them
  p1Input: ClientInput | undefined;
  p2Input: ClientInput | undefined;
  // The Physics Loop
  gameLoop: NodeJS.Timeout | null;
}

const rooms = new Map<string, GameRoom>();
const engine = new GameEngine();

let waitingPlayer: string | null = null;

io.on("connection", (socket: Socket) => {
  console.log(`User connected: ${socket.id}`);

  // 1. Matchmaking
  socket.on("find-match", () => {
    if (waitingPlayer && waitingPlayer !== socket.id) {
      // Create Match
      const roomId = `room_${waitingPlayer}_${socket.id}`;
      const p1 = waitingPlayer;
      const p2 = socket.id;

      waitingPlayer = null;

      // --- GENERATE RANDOM SEED FOR THIS MATCH ---
      // A large random integer used as the master seed.
      const matchSeed = Math.floor(Math.random() * 2000000000);

      // Create deterministic initial state
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

      // --- START SERVER PHYSICS LOOP ---
      const MS_PER_TICK = 1000 / TICK_RATE;
      const matchStartTime = Date.now();

      room.gameLoop = setInterval(() => {
        const now = Date.now();
        
        // Calculate which tick we *should* be on based on total time elapsed
        const expectedTick = Math.floor((now - matchStartTime) / MS_PER_TICK);

        let loopCount = 0;
        const MAX_LOOPS = 50;

        while (room.state.tick < expectedTick && loopCount < MAX_LOOPS) {
            const prevScorePlayer = room.state.score.player;
            const prevScoreOpponent = room.state.score.opponent;

            // Run logic 
            engine.step(room.state, room.p1Input, room.p2Input);

            // Log tick index every 100 ticks
            if (room.state.tick % 100 === 0) {
              console.log(`Room ${roomId} - Tick: ${room.state.tick}`);
            }

            // SYNC ON SCORE: 
            if (room.state.score.player !== prevScorePlayer || 
                room.state.score.opponent !== prevScoreOpponent) {
                
                io.to(roomId).emit("sync-event", {
                    type: "score",
                    state: room.state
                });
            }

            loopCount++;
        }
      }, MS_PER_TICK);
      // ---------------------------------

      // Notify players to start. SEND THE SEED.
      io.to(p1).emit("match-start", { role: "p1", roomId, serverTime: matchStartTime, seed: matchSeed });
      io.to(p2).emit("match-start", { role: "p2", roomId, serverTime: matchStartTime, seed: matchSeed });

      console.log(`Match started: ${roomId} with Seed: ${matchSeed}`);

    } else {
      waitingPlayer = socket.id;
      console.log(`User ${socket.id} joined waiting room.`);
    }
  });

  // 2. Input Relay (Event Based + State Snapshot)
  socket.on("player-input", (data: { roomId: string, input: ClientInput }) => {
    const room = rooms.get(data.roomId);
    if (!room) return;

    // A. Update Server's Authoritative Inputs
    if (socket.id === room.p1) {
        room.p1Input = data.input;
    } else {
        room.p2Input = data.input;
    }

    // B. Determine Recipient
    const isP1 = socket.id === room.p1;
    const senderRole = isP1 ? "p1" : "p2";
    const recipientSocketId = isP1 ? room.p2 : room.p1;

    // C. Forward Input AND Current Server State
    io.to(recipientSocketId).emit("remote-input", { 
        role: senderRole, 
        input: data.input,
        serverState: room.state 
    });
  });

  // --- Manual Sync Request ---
  socket.on("request-sync", (roomId: string) => {
    const room = rooms.get(roomId);
    if (room) {
        socket.emit("sync-event", {
            type: "resync",
            state: room.state
        });
    }
  });

  // 3. Disconnect Handling
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

