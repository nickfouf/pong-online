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
  // We no longer need to store a setInterval ID because the loop checks 
  // if the room exists in the map to decide whether to continue.
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

            const p1Socket = io.sockets.sockets.get(p1);
            const p2Socket = socket; 

            if (p1Socket) p1Socket.join(roomId);
            p2Socket.join(roomId);

            const matchSeed = Math.floor(Math.random() * 2000000000);
            const initialState = engine.createInitialState(matchSeed);

            const room: GameRoom = {
                id: roomId,
                p1, 
                p2,
                state: initialState,
                p1Input: undefined,
                p2Input: undefined
            };

            rooms.set(roomId, room);

            // --- CHANGED: HIGH PRECISION RECURSIVE LOOP ---
            // This replaces setInterval with a more accurate game loop 
            // similar to requestAnimationFrame logic but for server time.
            
            const TICK_LENGTH_MS = 1000 / TICK_RATE;
            let previousTick = Date.now();

            const runGameLoop = () => {
                // 1. Stop condition: If room was deleted (game over), stop looping
                if (!rooms.has(roomId)) return;

                const now = Date.now();

                // 2. Fixed Time Step Logic
                // If the server lags, this 'while' loop runs multiple physics steps
                // to catch up, ensuring the simulation speed remains constant.
                while (previousTick + TICK_LENGTH_MS <= now) {
                    engine.step(room.state, room.p1Input, room.p2Input);
                    previousTick += TICK_LENGTH_MS;
                }

                // 3. Recursive Scheduling
                // Calculate time until next expected tick
                const timeUntilNext = (previousTick + TICK_LENGTH_MS) - Date.now();

                if (timeUntilNext > 1) {
                    // If we have plenty of time, use setTimeout to yield CPU
                    setTimeout(runGameLoop, timeUntilNext);
                } else {
                    // If we are late or due immediately, use setImmediate
                    // (Node's way of saying "do this as soon as possible")
                    setImmediate(runGameLoop);
                }
            };

            // Start the loop
            runGameLoop();
            // ----------------------------------------------

            const matchStartTime = Date.now();
            io.to(p1).emit("match-start", { role: "p1", roomId, serverTime: matchStartTime, seed: matchSeed });
            io.to(p2).emit("match-start", { role: "p2", roomId, serverTime: matchStartTime, seed: matchSeed });

            console.log(`Match started: ${roomId}`);

        } else {
            waitingPlayer = socket.id;
            console.log(`User ${socket.id} joined waiting room.`);
        }
    });

  socket.on("player-input", (data: { roomId: string, input: ClientInput }) => {
    const room = rooms.get(data.roomId);
    if (!room) return;

    if (Math.random() < 0.05) { 
        console.log(`Rx Input Room ${data.roomId.substring(0,8)} from ${socket.id === room.p1 ? "P1" : "P2"}: T:${data.input.tick} X:${data.input.targetX}`);
    }

    if (socket.id === room.p1) {
        room.p1Input = data.input;
    } else {
        room.p2Input = data.input;
    }

    // --- CHANGED: SEND STATE ON INPUT ---
    // We only broadcast the state when an input is processed.
    // The clients rely on local simulation for the ball in between these updates.
    io.to(data.roomId).emit("server-tick", room.state);
    // ------------------------------------
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
    if (waitingPlayer === socket.id) waitingPlayer = null;

    for (const [id, room] of rooms) {
      if (room.p1 === socket.id || room.p2 === socket.id) {
        // We just delete the room. The recursive loop checks rooms.has(id),
        // so it will automatically stop running on the next tick.
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