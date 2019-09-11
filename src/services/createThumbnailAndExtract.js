const sharp = require('sharp');

const createThumbnailAndExtract = (fileLocation) => {
  const THUMBNAIL_SIZE = 200; // fit within square box of this dimension in pixels
  const EXTRACT_WIDTH = 600; // pixels
  const EXTRACT_HEIGHT = 100; // pixels
  const thumbnail = fileLocation.slice(0, -4).concat('-thumb').concat(fileLocation.slice(-4));
  const extract = fileLocation.slice(0, -4).concat('-extract').concat(fileLocation.slice(-4));
  sharp(fileLocation)
    .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'inside' })
    .toFile(thumbnail, (thumbErr) => {
      sharp.cache(false); // stops really confusing behaviour if changing repeatedly
      if (thumbErr) throw thumbErr;
    });
  sharp(fileLocation)
    .metadata()
    .then((metadata) => {
      const centreX = Math.floor(metadata.width / 2);
      const centreY = Math.floor(metadata.height / 2);
      // check to limit size of extract for small images
      // (although real maps are unlikely to be this small)
      const newWidth = Math.min(metadata.width, EXTRACT_WIDTH);
      const newHeight = Math.min(metadata.height, EXTRACT_HEIGHT);
      return sharp(fileLocation)
        .extract({
          left: centreX - Math.floor(newWidth / 2),
          top: centreY - Math.floor(newHeight / 2),
          width: newWidth,
          height: newHeight,
        })
        .toFile(extract, (extractErr) => {
          sharp.cache(false); // stops confusing behaviour if changing more than once!
          if (extractErr) throw extractErr;
        });
    });
};

module.exports = {
  createThumbnailAndExtract,
};
