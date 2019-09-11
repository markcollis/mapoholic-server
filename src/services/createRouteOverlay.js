// * consider using a worker pool library to avoid blocking server *
const fs = require('fs');
const { PNG } = require('pngjs'); // overlayData must be PNG for transparency
const JPEG = require('jpeg-js'); // inputs will be JPG

// want fs.readFile() to return a Promise
const readFileAsync = (filename) => {
  return new Promise((resolve, reject) => {
    fs.readFile(filename, (err, buffer) => {
      if (err) reject(err);
      else resolve(buffer);
    });
  });
};

// Are two pixels different or not? Need calculation to be simple
const isDifferent = (routeData, courseData, position, overlayThreshold) => {
  const diffR = Math.abs(routeData[position] - courseData[position]);
  const diffG = Math.abs(routeData[position + 1] - courseData[position + 1]);
  const diffB = Math.abs(routeData[position + 2] - courseData[position + 2]);
  const difference = diffR + diffG + diffG + diffB; // eye more sensitive to green
  if (difference > overlayThreshold) return true;
  return false;
};

// cut down version that returns an overlay (new PNG object)
// returns null rather than error if unable to produce one
const createRouteOverlay = async (routeFilename, courseFilename, overlayThreshold = 63) => {
  // const startTime = new Date().getTime();
  return Promise.all([readFileAsync(routeFilename), readFileAsync(courseFilename)])
    .then(([routeFile, courseFile]) => {
      // const readTime = new Date().getTime();
      // console.log('files read time:', (readTime - startTime) / 1000);
      const routeImg = JPEG.decode(routeFile);
      const courseImg = JPEG.decode(courseFile);
      const { width, height } = routeImg;
      const overlay = new PNG({ width, height });
      const routeData = routeImg.data;
      const courseData = courseImg.data;
      const overlayData = overlay.data;

      // validation: are images the same size?
      if (routeData.length !== courseData.length) {
        // console.log('No overlay, image sizes do not match.');
        return null;
      }

      // compare each pixel of one image against the other one
      let different = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const currentPosition = (y * width + x) * 4;
          if (isDifferent(routeData, courseData, currentPosition, overlayThreshold)) {
            overlayData[currentPosition] = routeData[currentPosition];
            overlayData[currentPosition + 1] = routeData[currentPosition + 1];
            overlayData[currentPosition + 2] = routeData[currentPosition + 2];
            overlayData[currentPosition + 3] = 255;
            different += 1;
          } else {
            overlayData[currentPosition + 3] = 0; // transparent, doesn't matter what RGB are
          }
        }
      }
      // const endTime = new Date().getTime();
      // console.log('different pixels:', different);
      // console.log('finish time:', (endTime - startTime) / 1000);
      if (different === 0) {
        // console.log('No overlay, images are identical.');
        return null;
      }
      return overlay;
    })
    .catch(() => {
      // .catch((err) => {
      // console.log('No overlay, error:', err.message);
      return null;
    });
};

module.exports = {
  createRouteOverlay,
};
