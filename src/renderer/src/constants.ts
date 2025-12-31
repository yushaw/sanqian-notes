/**
 * Application Constants
 *
 * Centralized location for all magic numbers and configuration constants.
 * This improves maintainability and makes it easier to adjust timing/thresholds.
 */

/**
 * Timing Constants (in milliseconds)
 */
export const TIMING = {
  /** Input focus delay after dialog opens */
  FOCUS_DELAY_MS: 100,

  /** Click outside listener registration delay */
  CLICK_OUTSIDE_DELAY_MS: 150,

  /** Chat panel enter animation duration (in seconds for framer-motion) */
  PANEL_ENTER_S: 0.2,

  /** Chat panel exit animation duration (in seconds for framer-motion) */
  PANEL_EXIT_S: 0.15,

  /** Session pill animation duration (in seconds for framer-motion) */
  SESSION_PILL_S: 0.2,

  /** Batch update delay for streaming text (reduce re-renders) */
  BATCH_UPDATE_DELAY_MS: 50,

  /** Typewriter effect delays (in milliseconds) */
  TYPEWRITER_DELAYS: {
    SLOW: 30,           // Natural typing speed (33 chars/sec)
    NORMAL: 20,         // Smooth streaming (50 chars/sec)
    FAST: 10,           // Reduce backlog (100 chars/sec)
    VERY_FAST: 5,       // Catch up (200 chars/sec)
  },

  /** Typewriter queue thresholds for adaptive speed */
  TYPEWRITER_THRESHOLDS: {
    VERY_FAST: 300,     // Queue length to trigger very fast mode
    FAST: 150,          // Queue length to trigger fast mode
    NORMAL: 50,         // Queue length to trigger normal mode
  },

  /** Stream timeout - auto-cleanup zombie streams after 5 minutes */
  STREAM_TIMEOUT_MS: 5 * 60 * 1000,

  /** Connection retry delay - exponential backoff base (doubles each retry) */
  RETRY_BASE_DELAY_MS: 1000,
} as const

/**
 * Retry Configuration
 */
export const RETRY = {
  /** Maximum number of connection retry attempts */
  MAX_ATTEMPTS: 3,
} as const

/**
 * Animation Easing Curves
 * For use with framer-motion
 */
export const EASING = {
  /** Standard ease-in-out curve */
  SMOOTH: [0.32, 0.72, 0, 1] as [number, number, number, number],

  /** Exit animation curve */
  EXIT: [0.32, 0, 0.67, 0] as [number, number, number, number],
} as const

/**
 * System Reminder Tag
 * Used for context injection into user messages (hidden from UI)
 */
export const SYSTEM_REMINDER_TAG = 'system_reminder'
