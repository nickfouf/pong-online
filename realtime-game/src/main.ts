import { Application } from "pixi.js";
import { GameRenderer } from "./game/renderer";
import { GameEngine } from "./game/engine";
import { GameState, MatchInitData, ClientInput, STEP_TIME } from "./game/types";
import {
    initSocket,
    findMatch,
    onMatchStart,
    onServerTick,
    sendInput,
    onGameOver,
    onDisconnect
} from "./lib/socket";

(async () => {
  const app = new Application();
  await app.init({
    background: "#222222",
    resizeTo: window,
    antialias: true
  });

  const container = document.getElementById("pixi-container");
  if (container) {
      container.appendChild(app.canvas);
  } else {
      document.body.appendChild(app.canvas);
  }

  const renderer = new GameRenderer(app);
  const engine = new GameEngine();

  window.addEventListener('resize', () => { renderer.resize(); });
  renderer.resize();

  let myRole: "p1" | "p2" | null = null;
  let roomId: string | null = null;
  let gameActive = false;
  
  let simulatedState: GameState | null = null;
  
  // CLIENT PREDICTION STATE
  let pendingInputs: ClientInput[] = [];
  let accumulator = 0; // For fixed time step loop

  const keys = { left: false, right: false };
  let lastSentInput: ClientInput | null = null;

  initSocket();

  renderer.showStartScreen(() => {
      findMatch();
      renderer.showSearching();
  });

  onMatchStart((data: MatchInitData) => {
    console.log("Match Started:", data);
    myRole = data.role;
    roomId = data.roomId;
    gameActive = true;
    
    // Reset prediction state
    pendingInputs = [];
    accumulator = 0;
    
    renderer.hideUI();
    renderer.setMirrored(myRole === 'p2');
    renderer.setBackgroundActive(true);
    simulatedState = engine.createInitialState(data.seed);
  });

  onServerTick((serverState: GameState) => {
    if (!simulatedState || !myRole) return;

    // 1. RECONCILIATION
    // Set our base state to exactly what the server says it is (Authoritative)
    simulatedState = engine.cloneState(serverState);

    // 2. Discard inputs that the server has definitively processed
    // (Inputs with a tick <= serverState.tick are already baked into serverState)
    pendingInputs = pendingInputs.filter(input => input.tick > serverState.tick);

    // 3. REPLAY PREDICTIONS
    // Re-apply all local inputs that the server hasn't seen yet
    // to bring our local state back to the "future"
    for (const input of pendingInputs) {
        const p1Input = myRole === 'p1' ? input : undefined;
        const p2Input = myRole === 'p2' ? input : undefined;
        
        // Note: We don't have the opponent's inputs for these future frames yet,
        // so they will momentarily stand still during replay until the next server update.
        // This is the trade-off for client-side prediction.
        engine.step(simulatedState, p1Input, p2Input);
    }
  });

  onGameOver((reason) => {
    gameActive = false;
    renderer.setBackgroundActive(false);
    renderer.showGameOver(reason, () => window.location.reload());
  });

  onDisconnect((reason) => {
      if (gameActive) {
          gameActive = false;
          renderer.setBackgroundActive(false);
          renderer.showGameOver(`Disconnected (${reason})`, () => window.location.reload());
      }
  });

  // GAME LOOP
  // Using ticker.add with deltaMS to create a Fixed Time Step loop
  // This ensures physics runs at 60Hz even if monitor is 144Hz or 30Hz
  app.ticker.add((ticker) => {
    if (!gameActive || !simulatedState || !roomId || !myRole) return;

    // Add time passed since last frame (in seconds)
    accumulator += ticker.deltaMS / 1000;

    // Consume accumulator in fixed chunks (STEP_TIME = 1/60)
    while (accumulator >= STEP_TIME) {
        
        // 1. INPUT GATHERING
        let wantsLogicLeft;
        let wantsLogicRight;
        let targetX: number | undefined = undefined;

        if (renderer.pointerActive) {
            targetX = renderer.targetGameX;
            wantsLogicLeft = false;
            wantsLogicRight = false;
        } else {
            if (myRole === 'p1') {
                wantsLogicLeft = keys.left;
                wantsLogicRight = keys.right;
            } else { 
                wantsLogicLeft = keys.right;
                wantsLogicRight = keys.left;
            }
        }

        const myInput: ClientInput = {
            tick: simulatedState.tick, // Apply to current tick
            left: wantsLogicLeft,
            right: wantsLogicRight,
            targetX: targetX
        };

        // 2. CLIENT PREDICTION (Apply locally immediately)
        const p1Input = myRole === 'p1' ? myInput : undefined;
        const p2Input = myRole === 'p2' ? myInput : undefined;
        
        engine.step(simulatedState, p1Input, p2Input);
        
        // 3. STORE HISTORY (For reconciliation later)
        pendingInputs.push(myInput);

        // 4. NETWORK SENDING
        // Only send if input changed to save bandwidth, or if targetX is active (mouse dragging)
        // We detect changes compared to the last thing we actually *sent* over the socket.
        const prevTargetX = lastSentInput?.targetX;
        const currTargetX = myInput.targetX;

        const inputChanged = !lastSentInput ||
            lastSentInput.left !== myInput.left ||
            lastSentInput.right !== myInput.right ||
            (prevTargetX === undefined && currTargetX !== undefined) ||
            (prevTargetX !== undefined && currTargetX === undefined) ||
            (prevTargetX !== undefined && currTargetX !== undefined && Math.abs(prevTargetX - currTargetX) > 1);

        if (inputChanged) {
            sendInput(roomId, myInput);
            lastSentInput = myInput;
        }

        // Decrease accumulator
        accumulator -= STEP_TIME;
    }

    // 5. RENDER
    // Render the interpolated state (or just the current snapped state)
    renderer.render(simulatedState);
  });

  const handleKey = (e: KeyboardEvent, state: boolean) => {
    if (e.repeat) return;
    if (e.key === "ArrowLeft") keys.left = state;
    if (e.key === "ArrowRight") keys.right = state;
  };

  window.addEventListener("keydown", (e) => handleKey(e, true));
  window.addEventListener("keyup", (e) => handleKey(e, false));

})();