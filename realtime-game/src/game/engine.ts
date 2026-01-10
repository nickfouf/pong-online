import { GameState, Entity, ClientInput, GAME_WIDTH, GAME_HEIGHT, STEP_TIME, TICK_RATE } from "./types";

const PADDLE_WIDTH = 100;
const PADDLE_HEIGHT = 20;
const BALL_SIZE = 20;
const PADDLE_SPEED = 600; 
export const BALL_SPEED = 450; 

function splitmix64(x: bigint): bigint {
  x = BigInt(x);
  x += 0x9e3779b97f4a7c15n;
  x = (x ^ (x >> 30n)) * 0xbf58476d1ce4e5b9n;
  x = (x ^ (x >> 27n)) * 0x94d049bb133111ebn;
  return x ^ (x >> 31n);
}

function deterministicRandomInt(index: number, seed: number, min: number, max: number): number {
    const range = BigInt(max - min + 1);
    const input = BigInt(index) + (BigInt(seed) * 0x10000n);
    const h = splitmix64(input);
    const unsignedVal = h & 0xFFFFFFFFFFFFFFFFn;
    return Number(unsignedVal % range) + min;
}

function deterministicRandomFloat(index: number, seed: number): number {
  const input = BigInt(index) + (BigInt(seed) * 0x10000n);
  const h = splitmix64(input);
  const mask = 0x1FFFFFFFFFFFFFn;
  return Number(h & mask) / Number(mask);
}

export class GameEngine {

  public createInitialState(seed: number): GameState {
    return {
      tick: 0,
      seed: seed,
      rounds: 0,
      waitingTimer: TICK_RATE, // Start with 1 second delay
      width: GAME_WIDTH,
      entities: {
        p1: {
          id: "p1",
          type: "paddle",
          position: { x: GAME_WIDTH / 2 - PADDLE_WIDTH / 2, y: GAME_HEIGHT - 50 },
          velocity: { x: 0, y: 0 },
          width: PADDLE_WIDTH,
          height: PADDLE_HEIGHT,
          color: 0x00ff00,
        },
        p2: {
          id: "p2",
          type: "paddle",
          position: { x: GAME_WIDTH / 2 - PADDLE_WIDTH / 2, y: 30 },
          velocity: { x: 0, y: 0 },
          width: PADDLE_WIDTH,
          height: PADDLE_HEIGHT,
          color: 0xff0000,
        },
        ball: {
          id: "ball",
          type: "ball",
          position: { x: GAME_WIDTH / 2 - BALL_SIZE / 2, y: GAME_HEIGHT / 2 },
          velocity: { x: 0, y: 0 }, 
          width: BALL_SIZE,
          height: BALL_SIZE,
          color: 0xffffff,
        }
      },
      score: { player: 0, opponent: 0 },
    } as any;
  }

  public cloneState(state: GameState): GameState {
    const newState: GameState = {
        tick: state.tick,
        seed: state.seed,
        rounds: state.rounds,
        waitingTimer: state.waitingTimer,
        entities: {}, 
        score: { ...state.score },
    } as any;

    for (const id in state.entities) {
        const ent = state.entities[id];
        newState.entities[id] = {
            id: ent.id,
            type: ent.type,
            position: { x: ent.position.x, y: ent.position.y },
            velocity: { x: ent.velocity.x, y: ent.velocity.y },
            width: ent.width,
            height: ent.height,
            color: ent.color
        };
    }
    return newState;
  }

  public step(state: GameState, p1Input: ClientInput | undefined, p2Input: ClientInput | undefined): void {
    const p1 = state.entities["p1"];
    const p2 = state.entities["p2"];
    const ball = state.entities["ball"];

    state.tick++;

    // 1. Process Paddle Inputs
    this.processPaddle(p1, p1Input);
    this.processPaddle(p2, p2Input);

    // 2. Ball Logic
    if (state.waitingTimer > 0) {
        // --- WAITING PHASE ---
        state.waitingTimer--;

        if (state.waitingTimer === 0) {
            this.launchBall(state);
        }
    } else {
        // --- ACTIVE PHASE ---
        
        // Failsafe: Auto start if stopped and no timer
        if (ball.velocity.x === 0 && ball.velocity.y === 0) {
            this.resetBall(state); 
            return;
        }

        ball.position.x += ball.velocity.x * STEP_TIME;
        ball.position.y += ball.velocity.y * STEP_TIME;

        if (ball.position.x <= 0) {
            ball.position.x = 0;
            ball.velocity.x *= -1;
        } else if (ball.position.x + ball.width >= GAME_WIDTH) {
            ball.position.x = GAME_WIDTH - ball.width;
            ball.velocity.x *= -1;
        }

        if (ball.position.y <= 0) {
            state.score.player++;
            state.rounds++;
            this.resetBall(state);
        } else if (ball.position.y + ball.height >= GAME_HEIGHT) {
            state.score.opponent++;
            state.rounds++;
            this.resetBall(state);
        }

        this.checkPaddleCollision(ball, p1);
        this.checkPaddleCollision(ball, p2);
    }
  }

  private processPaddle(paddle: Entity, input: ClientInput | undefined) {
    if (!input) return;

    if (input.targetX !== undefined && input.targetX !== null && !isNaN(input.targetX)) {
        paddle.position.x = input.targetX - paddle.width / 2;
    } 
    else {
        if (input.left) paddle.position.x -= PADDLE_SPEED * STEP_TIME;
        if (input.right) paddle.position.x += PADDLE_SPEED * STEP_TIME;
    }

    paddle.position.x = Math.max(0, Math.min(GAME_WIDTH - paddle.width, paddle.position.x));
  }

  private checkPaddleCollision(ball: Entity, paddle: Entity) {
    if (
      ball.position.x < paddle.position.x + paddle.width &&
      ball.position.x + ball.width > paddle.position.x &&
      ball.position.y < paddle.position.y + paddle.height &&
      ball.position.y + ball.height > paddle.position.y
    ) {
      ball.velocity.y *= -1;
      
      const isBallAbove = ball.position.y + ball.height / 2 < paddle.position.y + paddle.height / 2;
      if (isBallAbove) {
          ball.position.y = paddle.position.y - ball.height;
      } else {
          ball.position.y = paddle.position.y + paddle.height;
      }
    }
  }

  private resetBall(state: GameState) {
    const ball = state.entities["ball"];
    ball.position.x = GAME_WIDTH / 2 - ball.width / 2;
    ball.position.y = GAME_HEIGHT / 2;
    ball.velocity.x = 0;
    ball.velocity.y = 0;
    
    // Set timer to wait 1 second
    state.waitingTimer = TICK_RATE;
  }

  private launchBall(state: GameState) {
    const ball = state.entities["ball"];

    const dirVal = deterministicRandomInt(state.rounds * 10, state.seed, 0, 1);
    const directionY = dirVal === 0 ? -1 : 1;
    const angleMod = deterministicRandomFloat(state.rounds * 10 + 1, state.seed); 
    const velocityX = (angleMod - 0.5) * 1.6 * BALL_SPEED;

    ball.velocity.y = directionY * BALL_SPEED;
    ball.velocity.x = velocityX;
  }
}

