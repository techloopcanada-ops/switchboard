// Extends app.json. Adds the Firebase client config for Android push notifications when the file is present,
// so builds without it (forks, fresh clones) still work. See docs/PUSH-SETUP.md.
const fs = require('node:fs');
const path = require('node:path');

module.exports = ({ config }) => {
  const candidate = process.env.GOOGLE_SERVICES_JSON || path.join(__dirname, 'google-services.json');
  if (fs.existsSync(candidate)) {
    config.android = { ...(config.android || {}), googleServicesFile: candidate };
  }
  return config;
};
