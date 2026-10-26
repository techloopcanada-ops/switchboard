// Expo config plugin: cap CMake object paths so React Native codegen builds fit inside Windows' 260-character
// path limit. Without it, ninja fails with "mkdir(...): No such file or directory" on deep codegen paths.
// The Android Gradle plugin passes -DCMAKE_OBJECT_PATH_MAX=1024; app-level cmake arguments override it.
const { withAppBuildGradle } = require('expo/config-plugins');

const LINE = '        externalNativeBuild { cmake { arguments "-DCMAKE_OBJECT_PATH_MAX=240" } }';

module.exports = function withCmakeObjectPathMax(config) {
  return withAppBuildGradle(config, (c) => {
    if (!c.modResults.contents.includes('CMAKE_OBJECT_PATH_MAX')) {
      c.modResults.contents = c.modResults.contents.replace(/^(\s*defaultConfig\s*\{)/m, `$1\n${LINE}`);
    }
    return c;
  });
};
