import type { Transition, Variants } from "framer-motion";

export const SOFT_SPRING: Transition = {
  type: "spring",
  stiffness: 320,
  damping: 32,
  mass: 0.8,
};

export const FADE_IN: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.18 } },
};

export const SLIDE_UP: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: SOFT_SPRING },
};

export const STAGGER_LIST: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04 } },
};

export const SHAKE: Variants = {
  rest: { x: 0 },
  shake: {
    x: [0, -8, 8, -6, 6, -3, 3, 0],
    transition: { duration: 0.45, ease: "easeInOut" },
  },
};

export const STATUS_CHANGE: Variants = {
  initial: { scale: 0.92, opacity: 0 },
  animate: { scale: 1, opacity: 1, transition: SOFT_SPRING },
  exit: { scale: 0.92, opacity: 0, transition: { duration: 0.12 } },
};
