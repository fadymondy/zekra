import { Platform } from "react-native";

import { hasTurboModule } from "./native";

// Google's NATIVE sheet (@react-native-google-signin/google-signin) — an
// optional upgrade. The default Google sign-in is the server's browser flow
// (browser-flow.ts), which needs no client ids in the app. This path is used
// only when the build is configured for it (below) AND the server accepts its
// ID tokens (providers: google.native). It returns an ID token;
// POST /api/auth/google/token verifies it against the configured client ids
// (internal/account/oauth_google.go) and answers with the same bearer a
// password sign-in gets.
//
// The WEB client id is what makes Google put an ID token in the response, and
// it is the token's audience on both platforms — so it must be the API's
// OAUTH_GOOGLE_CLIENT_ID (or listed in OAUTH_GOOGLE_AUDIENCES). The iOS client
// id is the app's own OAuth client on iOS; its reversed form is the URL scheme
// app.config.js registers (GOOGLE_IOS_URL_SCHEME).
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

/** The SDK is configured for this build, and its native module is in the binary. */
export function googleSdkAvailable(): boolean {
  if (Platform.OS === "web" || !WEB_CLIENT_ID) return false;
  if (Platform.OS === "ios" && !IOS_CLIENT_ID) return false;
  return hasTurboModule("RNGoogleSignin");
}

type Lib = typeof import("@react-native-google-signin/google-signin");
let lib: Lib | null = null;

function load(): Lib {
  if (!lib) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    lib = require("@react-native-google-signin/google-signin") as Lib;
    lib.GoogleSignin.configure({
      webClientId: WEB_CLIENT_ID,
      ...(Platform.OS === "ios" && IOS_CLIENT_ID ? { iosClientId: IOS_CLIENT_ID } : {}),
    });
  }
  return lib;
}

/** Google's sheet -> an ID token. null when the user closed the sheet. */
export async function googleIdToken(): Promise<string | null> {
  if (!googleSdkAvailable()) throw new Error("Google sign-in is not available in this build");
  const { GoogleSignin, isCancelledResponse, isErrorWithCode, statusCodes } = load();
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // Forget the SDK's remembered account so the picker always shows —
    // otherwise "sign out, then sign in with another account" reuses the first.
    await GoogleSignin.signOut().catch(() => {});
    const res = await GoogleSignin.signIn();
    if (isCancelledResponse(res)) return null;
    if (!res.data.idToken) throw new Error("Google returned no ID token");
    return res.data.idToken;
  } catch (error) {
    if (isErrorWithCode(error) && (error.code === statusCodes.SIGN_IN_CANCELLED || error.code === statusCodes.IN_PROGRESS)) return null;
    throw error;
  }
}
