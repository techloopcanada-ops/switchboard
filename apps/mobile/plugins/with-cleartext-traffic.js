// Expo config plugin: allow plain-HTTP connections. The phone talks to the Switchboard daemon over the local
// network or Tailscale by IP address, where there is no certificate, and Android blocks cleartext by default
// on API 28+. The bearer token still protects the API; Tailscale encrypts the link end to end.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withCleartextTraffic(config) {
  return withAndroidManifest(config, (c) => {
    const application = c.modResults.manifest.application?.[0];
    if (application) {
      application.$ = { ...(application.$ || {}), 'android:usesCleartextTraffic': 'true' };
    }
    return c;
  });
};
