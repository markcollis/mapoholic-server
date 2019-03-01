#!/bin/bash

rm -rf dist && mkdir dist
npx babel src --out-dir dist --presets=@babel/preset-env --ignore "src/node_modules/**/*.js"
cp src/package.json dist
cd dist && yarn install --production --modules-folder node_modules
