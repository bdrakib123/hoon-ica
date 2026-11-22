const path = require("path");

function dataDir() {
  return process.env.INSTA_DATA_DIR || process.cwd();
}

function dataPath(name) {
  return path.join(dataDir(), name);
}

module.exports = { dataDir, dataPath };
