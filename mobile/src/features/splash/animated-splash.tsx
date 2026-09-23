import { useEffect, useRef, useState } from "react";
import { StyleSheet, useColorScheme } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Rect } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";

import {
  BODY,
  breathOpacity,
  CELLS,
  cellRect,
  DOME,
  domeFrame,
  bodyFrame,
  EXIT_CAP_MS,
  exitFrame,
  GOLD,
  GROUND,
  INTRO_MS,
  MARK_SIZE,
  shouldExit,
  T,
  UNIT,
  VIEWBOX,
  VIOLET,
  type Cell,
} from "@/features/splash/splash-core";
import { useI18n } from "@/lib/i18n";

const AnimatedRect = Animated.createAnimatedComponent(Rect);

/** One lattice cell, driven by the intro clock, the breathing loop and nothing
 *  else. Its static props are the native splash's frame, so the first render
 *  already matches before any animated prop lands. */
function MarkCell({ cell, cascade, clock, phase, breath }: {
  cell: Cell;
  /** Index in the body cascade; -1 for the dome. */
  cascade: number;
  clock: SharedValue<number>;
  phase: SharedValue<number>;
  breath: SharedValue<number>;
}) {
  const lattice = CELLS.indexOf(cell);
  const animatedProps = useAnimatedProps(() => {
    const t = clock.value;
    const f = cascade < 0 ? domeFrame(t) : bodyFrame(cascade, t);
    const r = cellRect(cell, f);
    const wave = 1 - breath.value * (1 - breathOpacity(lattice, phase.value));
    return { x: r.x, y: r.y, width: r.width, height: r.height, opacity: f.opacity * wave };
  });
  return (
    <AnimatedRect
      x={cell.x}
      y={cell.y}
      width={UNIT}
      height={UNIT}
      fill={cell.gold ? GOLD : VIOLET}
      animatedProps={animatedProps}
    />
  );
}

/**
 * Launch splash (MH-372), rendered over the whole app by app/_layout.tsx.
 *
 * Handoff: the native splash (assets/splash-mark.png, 96pt wide, centred on
 * #f0ebe1 / #0b1429) is hidden as soon as JS runs; this overlay's first frame
 * is the same mark on the same ground at the same size and place. The system
 * appearance picks the ground, as it does for the native splash, so a stored
 * theme override never flashes the wrong colour here.
 *
 * Motion: the violet body re-seats cell by cell from the bottom row up, the
 * gold dome lifts and drops back with a small settle, then a Ben-Day flicker.
 * Once `ready` is true and the intro has played (or the ~1.4s cap is reached),
 * the mark grows slightly while the overlay fades, then `onDone()`. A slow
 * launch breathes gently until ready. Reduce Motion: no intro, a plain fade.
 */
export function AnimatedSplash({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const scheme = useColorScheme();
  const reduced = useReducedMotion();
  const { t } = useI18n();
  const clock = useSharedValue(0);
  const phase = useSharedValue(0);
  const breath = useSharedValue(0);
  const exit = useSharedValue(0);
  const [introDone, setIntroDone] = useState(reduced);
  const [capHit, setCapHit] = useState(false);
  const [exiting, setExiting] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;

  // The intro clock, plus the cap after which a ready app is never held.
  useEffect(() => {
    const cap = setTimeout(() => setCapHit(true), EXIT_CAP_MS);
    if (!reduced) {
      clock.value = withTiming(INTRO_MS, { duration: INTRO_MS, easing: Easing.linear }, (finished) => {
        if (finished) scheduleOnRN(setIntroDone, true);
      });
    }
    return () => clearTimeout(cap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Still waiting after the intro: breathe.
  useEffect(() => {
    if (!introDone || ready || reduced || exiting) return;
    phase.value = 0;
    phase.value = withRepeat(withTiming(1, { duration: T.breath, easing: Easing.linear }), -1, false);
    breath.value = withTiming(1, { duration: 400 });
  }, [introDone, ready, reduced, exiting, phase, breath]);

  useEffect(() => {
    if (exiting || !shouldExit(ready, introDone, capHit ? EXIT_CAP_MS : 0)) return;
    setExiting(true);
    const finish = () => done.current();
    breath.value = withTiming(0, { duration: T.exit });
    exit.value = withTiming(1, { duration: reduced ? 220 : T.exit, easing: Easing.linear }, (finished) => {
      if (finished) {
        cancelAnimation(phase);
        scheduleOnRN(finish);
      }
    });
  }, [ready, introDone, capHit, exiting, reduced, exit, breath, phase]);

  const overlay = useAnimatedStyle(() => ({ opacity: exitFrame(exit.value).opacity }));
  const mark = useAnimatedStyle(() => ({ transform: [{ scale: reduced ? 1 : exitFrame(exit.value).scale }] }));

  return (
    <Animated.View
      pointerEvents={exiting ? "none" : "auto"}
      accessibilityLabel={t("app.name")}
      accessibilityRole="image"
      style={[StyleSheet.absoluteFill, styles.ground, { backgroundColor: scheme === "dark" ? GROUND.dark : GROUND.light }, overlay]}
    >
      <Animated.View style={mark}>
        <Svg width={MARK_SIZE} height={MARK_SIZE} viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}>
          {BODY.map((cell, i) => (
            <MarkCell key={`${cell.col}-${cell.row}`} cell={cell} cascade={i} clock={clock} phase={phase} breath={breath} />
          ))}
          <MarkCell cell={DOME} cascade={-1} clock={clock} phase={phase} breath={breath} />
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  ground: { zIndex: 100, elevation: 100, alignItems: "center", justifyContent: "center" },
});
