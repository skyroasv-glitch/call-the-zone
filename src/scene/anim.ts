/** Pitching rubber, feet from the plate. Release happens ~6.5 ft in front of it. */
export const RUBBER_Z = -60.5;

/** Wind-up duration, seconds, before the ball leaves the hand. */
export const WINDUP_SEC = 1.0;

/** Real flight is ~0.4s at 95mph — stretched a little so the pitch is readable. */
export const FLIGHT_SCALE = 1.45;

export interface AnimState {
  /** true from the moment the wind-up starts until the ball reaches the plate */
  active: boolean;
  /** 0..1 through the wind-up */
  windup: number;
  /** 0..1 along the flight; 0 until release */
  flight: number;
  /** ball has left the hand */
  released: boolean;
  /** 0..1 through the catcher's receive/follow-through after the plate */
  after: number;
}

export const idleAnim = (): AnimState => ({
  active: false, windup: 0, flight: 0, released: false, after: 0,
});

/** Frozen at the plate — what the player sees while deciding. */
export const settledAnim = (): AnimState => ({
  active: false, windup: 1, flight: 1, released: true, after: 1,
});
