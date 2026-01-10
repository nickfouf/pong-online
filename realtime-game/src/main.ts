import { Application } from "pixi.js";
import { GameRenderer } from "./game/renderer";
import { GameEngine } from "./game/engine";
import { GameState, MatchInitData, ClientInput, TICK_RATE } from "./game/types";
import {
    initSocket,
    findMatch,
    onMatchStart,
    onServerTick,
    sendInput,
    onGameOver,
    onDisconnect
} from "./lib/socket";

const MS_PER_TICK = 1000 / TICK_RATE;

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
    renderer.hideUI();
    renderer.setMirrored(myRole === 'p2');
    renderer.setBackgroundActive(true);
    simulatedState = engine.createInitialState(data.seed);
  });

  onServerTick((state: GameState) => {
    if (!simulatedState) return;
    simulatedState.entities = state.entities;
    simulatedState.score = state.score;
    simulatedState.tick = state.tick;
    simulatedState.rounds = state.rounds;
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

  app.ticker.add(() => {
    if (!gameActive || !simulatedState || !roomId || !myRole) return;

    // 1. INPUT GATHERING
    let wantsLogicLeft = false;
    let wantsLogicRight = false;
    let targetX: number | undefined = undefined;

    // Priority: Touch/Mouse > Keyboard
    if (renderer.pointerActive) {
        targetX = renderer.targetGameX;
        // When pointer is active, keyboard inputs are ignored for paddle movement
        wantsLogicLeft = false;
        wantsLogicRight = false;
    }
    else {
        if (myRole === 'p1') {
            wantsLogicLeft = keys.left;
            wantsLogicRight = keys.right;
        } else { // P2 is mirrored, so left key moves right, right key moves left
            wantsLogicLeft = keys.right;
            wantsLogicRight = keys.left;
        }
    }

    const myInput: ClientInput = {
        tick: simulatedState.tick,
        left: wantsLogicLeft,
        right: wantsLogicRight,
        targetX: targetX
    };

    // 2. INPUT SENDING
    // We check if input changed to avoid spamming the socket,
    // and correctly handle the transition between targetX being defined/undefined.
    const prevTargetX = lastSentInput?.targetX;
    const currTargetX = myInput.targetX;

    const inputChanged = !lastSentInput ||
        lastSentInput.left !== myInput.left ||
        lastSentInput.right !== myInput.right ||
        (prevTargetX === undefined && currTargetX !== undefined) || // TargetX became defined
        (prevTargetX !== undefined && currTargetX === undefined) || // TargetX became undefined
        (prevTargetX !== undefined && currTargetX !== undefined && prevTargetX !== currTargetX); // Both defined and values changed

    if (inputChanged) {
        // --- DEBUG LOG ---
        // Open Browser Console (F12) to see this
        console.log("Sending Input:", myInput);

        sendInput(roomId, myInput);
        lastSentInput = myInput;
    }

    // 3. RENDER
    // We do NOT step the engine locally for paddles (passed undefined),
    // but we step for ball smoothing if we wanted (though currently overwritten by server tick)
    engine.step(simulatedState, undefined, undefined);
    renderer.render(simulatedState);
  });

  const handleKey = (e: KeyboardEvent, state: boolean) => {
    if (e.repeat) return;
    // Log key presses to ensure focus is correct
    if(state) console.log("Key Press:", e.key);

    if (e.key === "ArrowLeft") keys.left = state;
    if (e.key === "ArrowRight") keys.right = state;
  };

  window.addEventListener("keydown", (e) => handleKey(e, true));
  window.addEventListener("keyup", (e) => handleKey(e, false));

})();