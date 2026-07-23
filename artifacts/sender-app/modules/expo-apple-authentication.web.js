const AppleAuthenticationScope = { FULL_NAME: 0, EMAIL: 1 };

async function signInAsync() {
  throw new Error("Apple Sign-In is not available on web");
}

module.exports = { signInAsync, AppleAuthenticationScope };
