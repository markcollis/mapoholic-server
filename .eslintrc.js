module.exports = {
  "extends": "airbnb",
  "rules": {
    "react/jsx-filename-extension": [1, {"extensions": [".js", ".jsx"]}],
    "arrow-body-style": [0]
  },
  "env": {
    "browser": true,
    "node": true,
    "jest": true
  },
  "settings": {
    "import/resolver": {
      "node": {
        "paths": ["src"]
      }
    }
  }
};
