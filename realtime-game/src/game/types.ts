// RealtimeGame/realtime-game/src/game/types.ts

export const GAME_WIDTH = 600;
export const GAME_HEIGHT = 800;
export const TICK_RATE = 60; // Run at 60 logic ticks per second
export const STEP_TIME = 1 / TICK_RATE; 

export type EntityType = "paddle" | "ball";

export interface Vector2 {
  x: number;
  y: number;
}

export interface Entity {
  id: string;
  type: EntityType;
  position: Vector2;
  velocity: Vector2;
  width: number;
  height: number;
  color: number;
}

export interface GameState {
  tick: number; // Current Logic Tick
  seed: number; // Master Seed for this match
  rounds: number; // Counter for how many times ball was reset
  entities: Record<string, Entity>;
  score: {
    player: number;
    opponent: number;
  };
}

export interface ClientInput {
  tick: number; // Input applied for this specific tick
  left: boolean;
  right: boolean;
}

export interface MatchInitData {
  role: "p1" | "p2";
  roomId: string;
  serverTime: number; // To calculate offset
  seed: number; // The master seed sent from server
}

