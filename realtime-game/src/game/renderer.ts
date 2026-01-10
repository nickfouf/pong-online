import { Application, Container, Graphics, Text, TextStyle, FederatedPointerEvent, Assets, Sprite } from "pixi.js";
import { GameState, GAME_WIDTH, GAME_HEIGHT } from "./types";

export class GameRenderer {
  private app: Application;
  private gameContainer: Container;
  private uiContainer: Container;
  
  // Game Sprites
  private sprites: Map<string, Graphics> = new Map();
  private isMirrored: boolean = false;
  
  // Background Elements
  private bgSprite: Sprite | null = null;
  private targetBgAlpha: number = 0; // Control for fade in/out

  // UI Elements
  private debugText: Text;
  private menuContainer: Container | null = null;

  // Input State
  public pointerActive: boolean = false;
  public targetGameX: number = 0;

  constructor(app: Application) {
    this.app = app;

    // 1. Layer Setup
    this.gameContainer = new Container();
    this.uiContainer = new Container();
    
    // --- BACKGROUND LAYERS ---
    
    // Layer 0: Black Background Fill
    const bgFill = new Graphics()
        .rect(0, 0, GAME_WIDTH, GAME_HEIGHT)
        .fill(0x000000);
    this.gameContainer.addChild(bgFill);

    // Layer 1: Background Image (Inserted asynchronously later at index 1)
    
    // Layer 2: White Border
    // We add this now so it sits at index 1 initially. 
    // When the image loads, we will insert the image at index 1, pushing this to index 2.
    // This ensures the border is rendered OVER the background image.
    const bgBorder = new Graphics()
        .rect(0, 0, GAME_WIDTH, GAME_HEIGHT)
        .stroke({ width: 4, color: 0xFFFFFF });
    this.gameContainer.addChild(bgBorder);

    // Center pivot for easier scaling/rotation
    this.gameContainer.pivot.set(GAME_WIDTH / 2, GAME_HEIGHT / 2);

    this.loadBackground();

    this.app.stage.addChild(this.gameContainer);
    this.app.stage.addChild(this.uiContainer);

    // 2. Debug/Status Text
    const style = new TextStyle({
        fill: "#ffffff",
        fontSize: 16,
        fontFamily: "monospace"
    });
    this.debugText = new Text({ text: "", style });
    this.debugText.position.set(10, 10);
    this.uiContainer.addChild(this.debugText);

    // 3. Setup Pointer Interaction
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen; 
    
    this.app.stage.on('pointerdown', this.onPointerDown.bind(this));
    this.app.stage.on('pointermove', this.onPointerMove.bind(this));
    this.app.stage.on('pointerup', this.onPointerUp.bind(this));
    this.app.stage.on('pointerupoutside', this.onPointerUp.bind(this));

    // 4. Fade Animation Loop
    this.app.ticker.add(() => {
        if (this.bgSprite) {
            // Smoothly interpolate alpha towards target
            const speed = 0.02;
            if (Math.abs(this.bgSprite.alpha - this.targetBgAlpha) > 0.001) {
                if (this.bgSprite.alpha < this.targetBgAlpha) {
                    this.bgSprite.alpha = Math.min(this.targetBgAlpha, this.bgSprite.alpha + speed);
                } else {
                    this.bgSprite.alpha = Math.max(this.targetBgAlpha, this.bgSprite.alpha - speed);
                }
            } else {
                this.bgSprite.alpha = this.targetBgAlpha;
            }
        }
    });
  }

  private async loadBackground() {
    try {
        const texture = await Assets.load('/assets/background.png');
        this.bgSprite = new Sprite(texture);

        // Calculate Scale (Contain Object Fit)
        const scale = Math.min(GAME_WIDTH / texture.width, GAME_HEIGHT / texture.height);
        
        this.bgSprite.scale.set(scale);
        this.bgSprite.anchor.set(0.5); // Center origin
        this.bgSprite.x = GAME_WIDTH / 2;
        this.bgSprite.y = GAME_HEIGHT / 2;
        
        // Initial Alpha 0 (Hidden)
        this.bgSprite.alpha = 0;

        // Insert at Index 1 (Between Black Fill and White Border)
        // [0: Fill, 1: Border] -> [0: Fill, 1: Sprite, 2: Border]
        this.gameContainer.addChildAt(this.bgSprite, 1);

    } catch (e) {
        console.warn("Failed to load background image:", e);
    }
  }

  public setBackgroundActive(active: boolean) {
      this.targetBgAlpha = active ? 1 : 0;
  }

  private onPointerDown(e: FederatedPointerEvent) {
    this.pointerActive = true;
    this.updatePointerPos(e);
  }

  private onPointerMove(e: FederatedPointerEvent) {
    if (this.pointerActive) {
        this.updatePointerPos(e);
    }
  }

  private onPointerUp() {
    this.pointerActive = false;
  }

  private updatePointerPos(e: FederatedPointerEvent) {
    const local = this.gameContainer.toLocal(e.global);
    let x = local.x;

    if (this.isMirrored) {
        x = GAME_WIDTH - x;
    }

    this.targetGameX = Math.max(0, Math.min(GAME_WIDTH, x));
  }

  public setMirrored(mirrored: boolean) {
    this.isMirrored = mirrored;
  }

  // --- UI SCREENS ---

  public showStartScreen(onFindMatch: () => void) {
    this.clearUI();
    this.menuContainer = new Container();
    
    const title = new Text({
        text: "PONG DUEL",
        style: { fill: 0xFFFFFF, fontSize: 60, fontWeight: "bold" }
    });
    title.anchor.set(0.5);
    title.y = -100;
    this.menuContainer.addChild(title);

    const btn = this.createButton("FIND MATCH", 0x00ff00, () => {
        btn.alpha = 0.5;
        btn.eventMode = 'none'; 
        onFindMatch();
    });
    this.menuContainer.addChild(btn);

    this.uiContainer.addChild(this.menuContainer);
    this.resize();
  }

  public showSearching() {
    this.clearUI();
    this.menuContainer = new Container();

    const text = new Text({
        text: "SEARCHING FOR OPPONENT...",
        style: { fill: 0xAAAAAA, fontSize: 24 }
    });
    text.anchor.set(0.5);
    
    let tick = 0;
    this.app.ticker.add(() => {
        if(this.menuContainer && !this.menuContainer.destroyed) {
            tick += 0.05;
            text.alpha = 0.5 + Math.abs(Math.sin(tick)) * 0.5;
        }
    });

    this.menuContainer.addChild(text);
    this.uiContainer.addChild(this.menuContainer);
    this.resize();
  }

  public hideUI() {
    this.clearUI();
  }

  public showGameOver(reason: string, onRestart: () => void) {
    this.clearUI();
    this.menuContainer = new Container();

    // CHANGED: Use GAME_WIDTH to ensure the background width matches the game board exactly
    const bg = new Graphics()
        .rect(-GAME_WIDTH / 2, -200, GAME_WIDTH, 400)
        .fill({ color: 0x000000, alpha: 0.9 })
        .stroke({ width: 2, color: 0xFF0000 });
    this.menuContainer.addChild(bg);

    const title = new Text({
        text: "GAME OVER",
        style: { fill: 0xFF0000, fontSize: 50, fontWeight: 'bold' }
    });
    title.anchor.set(0.5);
    title.y = -80;
    this.menuContainer.addChild(title);

    const msg = new Text({
        text: reason,
        style: { fill: 0xFFFFFF, fontSize: 24, wordWrap: true, wordWrapWidth: 500 }
    });
    msg.anchor.set(0.5);
    msg.y = 0;
    this.menuContainer.addChild(msg);

    const btn = this.createButton("RELOAD", 0xFFFFFF, onRestart);
    btn.y = 100;
    this.menuContainer.addChild(btn);

    this.uiContainer.addChild(this.menuContainer);
    this.resize();
  }

  // --- HELPERS ---

  private clearUI() {
    if (this.menuContainer) {
        this.menuContainer.destroy({ children: true });
        this.menuContainer = null;
    }
  }

  private createButton(label: string, color: number, onClick: () => void): Container {
    const btn = new Container();
    btn.eventMode = 'static'; 
    btn.cursor = 'pointer';

    const bg = new Graphics()
        .roundRect(-100, -30, 200, 60, 10)
        .fill(color);
    
    const text = new Text({
        text: label,
        style: { fill: 0x000000, fontSize: 20, fontWeight: 'bold' }
    });
    text.anchor.set(0.5);

    btn.addChild(bg, text);

    btn.on('pointerdown', onClick);
    btn.on('pointerover', () => { bg.alpha = 0.8; });
    btn.on('pointerout', () => { bg.alpha = 1; });

    return btn;
  }

  // --- RENDERING & RESIZING ---

  public resize() {
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;

    this.app.stage.hitArea = this.app.screen;

    // Scale to fit
    const scale = Math.min(
        (screenW - 20) / GAME_WIDTH, 
        (screenH - 20) / GAME_HEIGHT
    );
    
    this.gameContainer.scale.set(scale);
    this.gameContainer.position.set(screenW / 2, screenH / 2);

    if (this.menuContainer) {
        // CHANGED: Apply scale to UI as well
        this.menuContainer.scale.set(scale);
        this.menuContainer.position.set(screenW / 2, screenH / 2);
    }
  }

  public render(state: GameState) {
    const activeIds = new Set<string>();

    Object.values(state.entities).forEach((entity) => {
      activeIds.add(entity.id);
      let sprite = this.sprites.get(entity.id);

      if (!sprite) {
        sprite = new Graphics();
        if (entity.type === 'ball') {
            sprite.circle(0, 0, entity.width / 2);
            sprite.fill(entity.color);
        } else {
            sprite.rect(0, 0, entity.width, entity.height);
            sprite.fill(entity.color);
        }
        this.gameContainer.addChild(sprite); 
        this.sprites.set(entity.id, sprite);
      }

      // Calculate Position
      let x = entity.position.x;
      let y = entity.position.y;

      if (this.isMirrored) {
        if (entity.type === 'ball') {
             const centerX = x + entity.width / 2;
             const centerY = y + entity.height / 2;
             sprite.position.set(GAME_WIDTH - centerX, GAME_HEIGHT - centerY);
        } else {
             sprite.position.set(
                 GAME_WIDTH - x - entity.width, 
                 GAME_HEIGHT - y - entity.height
             );
        }
      } else {
        if (entity.type === 'ball') {
            sprite.position.set(x + entity.width/2, y + entity.height/2);
        } else {
            sprite.position.set(x, y);
        }
      }
    });

    for (const [id, sprite] of this.sprites) {
      if (!activeIds.has(id)) {
        sprite.destroy();
        this.sprites.delete(id);
      }
    }

    this.debugText.text = `Tick: ${state.tick} | P1: ${state.score.player} | P2: ${state.score.opponent}`;
  }
}