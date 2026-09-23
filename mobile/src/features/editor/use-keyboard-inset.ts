import { useEffect, useRef, useState, type RefObject } from "react";
import { Keyboard, LayoutAnimation, Platform, type KeyboardEvent, type View } from "react-native";

/**
 * How far the keyboard overlaps the bottom of `ref`'s view, in px.
 *
 * Measured rather than assumed: the overlap is (view bottom in the window) −
 * (keyboard top on screen). If the platform already resized the window for
 * the keyboard (Android adjustResize on older configs) the view's bottom is
 * above the keyboard and this is 0; with edge-to-edge (Expo 57 / Android 15)
 * or on iOS, where nothing resizes, it is the real overlap. One code path,
 * correct either way — unlike KeyboardAvoidingView's per-platform `behavior`.
 *
 * `ref` must be a view whose frame does NOT change with the inset (pad a
 * child, not the measured view itself).
 */
export function useKeyboardInset(ref: RefObject<View | null>): { inset: number; visible: boolean } {
  const [state, setState] = useState({ inset: 0, visible: false });
  const lastTop = useRef<number | null>(null);

  useEffect(() => {
    const ios = Platform.OS === "ios";
    const measure = (keyboardTop: number | null, e?: KeyboardEvent) => {
      if (keyboardTop === null) {
        if (ios && e) LayoutAnimation.configureNext(LayoutAnimation.create(e.duration || 250, "keyboard", "opacity"));
        setState({ inset: 0, visible: false });
        return;
      }
      ref.current?.measureInWindow((_x, y, _w, h) => {
        const overlap = Math.max(0, Math.round(y + h - keyboardTop));
        if (ios && e) LayoutAnimation.configureNext(LayoutAnimation.create(e.duration || 250, "keyboard", "opacity"));
        setState({ inset: overlap, visible: true });
      });
    };
    const onShow = (e: KeyboardEvent) => {
      const top = e.endCoordinates.screenY;
      lastTop.current = top;
      // iOS reports a hide as a frame change that ends off-screen.
      if (e.endCoordinates.height <= 0) measure(null, e);
      else measure(top, e);
    };
    const onHide = (e: KeyboardEvent) => {
      lastTop.current = null;
      measure(null, e);
    };
    const subs = [
      Keyboard.addListener(ios ? "keyboardWillChangeFrame" : "keyboardDidShow", onShow),
      Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", onHide),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [ref]);

  return state;
}
