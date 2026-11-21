// Every tunable in one place. The debug GUI (key G) edits this object live,
// so feel is tuned, not guessed. Units: metres, seconds, radians.

export const MACH = 343

/**
 * The world is periodic: every pattern (dunes, riverbeds, rocks, mesas) repeats every REBASE metres,
 * so when the craft strays REBASE/2 from the origin everything is shifted back by REBASE and nothing
 * on screen changes. Keeps float32 precise forever at 2 km/s.
 */
export const REBASE = 72000

export const CFG = {
  speed: {
    /** (Unused since W became the throttle; Hunt's tools set it.) */
    cruiseMach: 1.7,
    /** Coasting drag off the throttle (1/s toward a stop). */
    coastK: 0.11,
    /** Afterburner target. The barrier sits at 6.0. */
    boostMach: 6.3,
    /** Air brake target. */
    brakeMach: 0.12,
    /** Approach rate toward the target, 1/s. Exponential, so the first second kicks hardest. */
    boostK: 0.62,
    cruiseK: 0.35,
    brakeK: 2.4,
    /** Instant m/s shove on pressing boost. */
    boostKick: 95,
    /** Start of a run. */
    launchMach: 0.35,
    /** Speed bled per second per unit of yaw rate (hard turns cost). */
    turnBleed: 0.05,
  },
  handling: {
    /** Max yaw rate at Mach 1 and Mach 6 (rad/s) — the AI's planning numbers. */
    yawLow: 1.35,
    yawHigh: 0.78,
    /** Yaw torque at full stick (rad/s²) and yaw damping (1/s): full stick settles at ~torque/damp. */
    steerTorque: 5.2,
    /** Extra steering authority at speed (×(1 + gain) by Mach 5). */
    steerGain: 0.75,
    yawDamp: 4.7,
    /** Weathervane torque pulling the nose back to the travel (needs grip). */
    alignK: 2.2,
    /** Grip: lateral acceleration = (gripK + gripQ·v)·v + gripLow, shaped by the slip curve. */
    gripK: 0.8,
    gripQ: 0.00034,
    gripLow: 60,
    /** Slip angle of peak grip (rad); grip left when fully sliding; slip that spins you out. */
    slipPeak: 0.16,
    slideFloor: 0.42,
    spinSlip: 1.15,
    /** Grip multiplier under the air brake (a trail-brake starts a drift). */
    driftBrakeGrip: 0.5,
    /** In the air: the share of grip and self-align the fins give (steering bends the path). */
    airControl: 0.4,
    /** Side-thruster strafe acceleration (m/s²). */
    strafe: 340,
    /** Lateral m/s added by a strafe tap (the dodge). */
    dodge: 170,
    hover: 3.1,
    /** Hover spring natural frequency (rad/s). */
    hoverW: 11,
  },
  camera: {
    fovBase: 68,
    /** Settings slider. */
    fovMax: 98,
    distBase: 10.5,
    distBoost: 2.5,
    height: 3.0,
    /** Heading lag (1/s): the whip on turns. */
    yawFollow: 6.5,
    rollFollow: 0.22,
    shakeMax: 0.055,
    /** Constant rumble trauma at Mach 6. */
    speedTrauma: 0.2,
    reduceShake: false,
  },
  post: {
    bloom: 0.5,
    bloomThreshold: 2.4,
    radialBlur: 0.06,
    aberration: 0.004,
    streaks: 1,
    grain: 0.035,
    exposure: 0.8,
  },
  combat: {
    lockCone: 0.32,
    lockTime: 0.42,
    lockRange: 7000,
    missileAccel: 2600,
    missileRelSpeed: 1150,
    missileTurn: 9,
    fireCooldown: 0.28,
    walkerAfterKills: 6,
    walkerAfterSeconds: 70,
  },
}
