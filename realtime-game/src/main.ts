import { Application } from "pixi.js";
import { GameRenderer } from "./game/renderer";
import { GameEngine } from "./game/engine";
import { GameState, MatchInitData, ClientInput, TICK_RATE } from "./game/types";
import { 
    initSocket, 
    findMatch, 
    onMatchStart, 
    onRemoteInput, 
    onSyncEvent, 
    sendInput,
    onGameOver,
    onDisconnect
} from "./lib/socket";

// Fixed Step Constants
const MS_PER_TICK = 1000 / TICK_RATE;

(async () => {
  // --- PIXI SETUP ---
  const app = new Application();
  await app.init({ 
    background: "#222222", 
    resizeTo: window,
    antialias: true
  });
  
  // Attach canvas to DOM
  const container = document.getElementById("pixi-container");
  if (container) {
      container.appendChild(app.canvas);
  } else {
      document.body.appendChild(app.canvas);
  }

  // Init Systems
  const renderer = new GameRenderer(app);
  const engine = new GameEngine();

  // Handle Window Resize via Renderer
  window.addEventListener('resize', () => {
      renderer.resize();
  });
  renderer.resize();
  
  // --- CLIENT GAME STATE ---
  let myRole: "p1" | "p2" | null = null;
  let roomId: string | null = null;
  let gameActive = false;
  
  // The local simulation state
  let simulatedState: GameState | null = null;

  // Sync Data
  let virtualStartTime = 0;
  
  // Input Data
  const keys = { left: false, right: false };
  let currentP1Input: ClientInput | undefined;
  let currentP2Input: ClientInput | undefined;
  let lastSentInput: ClientInput | null = null;

  // --- SOCKET SETUP ---
  initSocket();

  // 1. Show Main Menu
  renderer.showStartScreen(() => {
      findMatch();
      renderer.showSearching();
  });

  onMatchStart((data: MatchInitData) => {
    console.log("Match Started:", data);
    myRole = data.role;
    roomId = data.roomId;
    gameActive = true;
    
    renderer.hideUI();
    renderer.setMirrored(myRole === 'p2');

    // INITIALIZE ENGINE WITH SERVER SEED
    simulatedState = engine.createInitialState(data.seed);

    // Reset local clock
    virtualStartTime = performance.now();
  });

  // LISTENER: Opponent Input + Resync
  onRemoteInput((data) => {
    if (data.role === "p1") currentP1Input = data.input;
    else currentP2Input = data.input;

    if (simulatedState) {
        // Snap critical state
        simulatedState.entities.ball = data.serverState.entities.ball;
        simulatedState.score = data.serverState.score;
        simulatedState.tick = data.serverState.tick;
        simulatedState.rounds = data.serverState.rounds;

        if (myRole === 'p1') simulatedState.entities.p2 = data.serverState.entities.p2;
        else simulatedState.entities.p1 = data.serverState.entities.p1;

        // Clock Correction
        virtualStartTime = performance.now() - (data.serverState.tick * MS_PER_TICK);
    }
  });

  // LISTENER: Score or Game Events
  onSyncEvent((data) => {
      if (simulatedState) {
          simulatedState.entities = data.state.entities;
          simulatedState.score = data.state.score;
          simulatedState.tick = data.state.tick;
          simulatedState.rounds = data.state.rounds;
          virtualStartTime = performance.now() - (data.state.tick * MS_PER_TICK);
      }
  });

  onGameOver((reason) => {
    gameActive = false;
    renderer.showGameOver(reason, () => {
        window.location.reload();
    });
  });

  onDisconnect((reason) => {
      if (gameActive) {
          gameActive = false;
          renderer.showGameOver(`You were disconnected (${reason})`, () => {
              window.location.reload();
          });
      }
  });

  // --- GAME LOOP ---
  app.ticker.add(() => {
    if (!gameActive || !simulatedState || !roomId || !myRole) return;

    const now = performance.now();
    const elapsed = now - virtualStartTime;
    const targetTick = Math.floor(elapsed / MS_PER_TICK);

    let loopCount = 0;
    while (simulatedState.tick < targetTick && loopCount < 200) {
        const currentTick = simulatedState.tick; 
        
        let wantsLogicLeft = false;
        let wantsLogicRight = false;
        let targetX: number | undefined = undefined;

        // 1. Pointer (Touch/Mouse) Input
        // If pointer is active, we send absolute position
        if (renderer.pointerActive) {
            targetX = renderer.targetGameX;
        } 
        // 2. Keyboard Input (Fallback)
        else {
            if (myRole === 'p1') {
                wantsLogicLeft = keys.left;
                wantsLogicRight = keys.right;
            } else {
                wantsLogicLeft = keys.right;
                wantsLogicRight = keys.left;
            }
        }

        const myInput: ClientInput = { 
            tick: currentTick, 
            left: wantsLogicLeft, 
            right: wantsLogicRight,
            targetX: targetX
        };

        // Check change (include targetX in check)
        const inputChanged = !lastSentInput || 
            lastSentInput.left !== myInput.left || 
            lastSentInput.right !== myInput.right ||
            lastSentInput.targetX !== myInput.targetX;

        if (inputChanged) {
            sendInput(roomId, myInput);
            lastSentInput = myInput;
        }

        if (myRole === 'p1') currentP1Input = myInput;
        if (myRole === 'p2') currentP2Input = myInput;

        engine.step(simulatedState, currentP1Input, currentP2Input);
        loopCount++;
    }

    renderer.render(simulatedState);
  });

  // --- INPUT LISTENERS ---
  const handleKey = (e: KeyboardEvent, state: boolean) => {
    if (e.repeat) return;
    if (e.key === "ArrowLeft") keys.left = state;
    if (e.key === "ArrowRight") keys.right = state;
  };

  window.addEventListener("keydown", (e) => handleKey(e, true));
  window.addEventListener("keyup", (e) => handleKey(e, false));

})();