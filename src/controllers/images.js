const fs = require('fs');
const multer = require('multer'); // support for image upload
const sharp = require('sharp'); // convert PNG to JPG
const logger = require('../services/logger');

// multer setup for uploading profile images and maps
const profileImageStorage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, 'images/upload');
  },
  filename(req, file, cb) {
    const fileTypes = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
    };
    if (!fileTypes[file.mimetype]) {
      cb(new Error('Needs to be a JPEG or PNG image.'));
    }
    const fileName = req.params.id.concat(fileTypes[file.mimetype]);
    cb(null, fileName);
  },
});
const mapImageStorage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, 'images/upload');
  },
  filename(req, file, cb) {
    const {
      userid,
      maptype,
      maptitle,
    } = req.params;
    // filter out special characters to avoid creating broken filenames
    // maptitle is URIComponent-encoded so that it can be used to populate the title field
    const title = (maptitle) ? maptitle.replace(/[`~!@#$%^&*()|+=?;:'",.<>{}\]\\/\s]/gi, '') : 'map';
    const fileTypes = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
    };
    if (!fileTypes[file.mimetype]) {
      cb(new Error('Needs to be a JPEG or PNG image.'));
    }
    const fileName = `${userid}-${title}-${maptype}${fileTypes[file.mimetype]}`;
    cb(null, fileName);
  },
});
const uploadImage = multer({
  storage: profileImageStorage,
  limits: {
    fileSize: 1000000, // 1MB limit for profile pics should be plenty!
  },
});
const uploadMap = multer({
  storage: mapImageStorage,
  limits: {
    fileSize: 5000000, // current collection of scanned maps varies from 1MB to 4MB
  },
});
/* eslint { no-unused-vars: 0 } */
const errorHandler = (err, req, res, next) => { // eslint exception needed for next
  if (err) {
    logger('error')(`Image upload error: ${err.message}.`);
    res.status(400).send({ error: err.message });
  }
};
const convertPNG = (req, res, next) => {
  if (!req.file) {
    logger('error')('Error: postMap request without image attached.');
    return res.status(400).send({ error: 'No map image file attached.' });
  }
  const { path } = req.file;
  if (path.slice(-3) === 'png') {
    // console.log('PNG file uploaded, want to convert it to JPG');
    const newPath = path.slice(0, -3).concat('jpg');
    return sharp(path).toFormat('jpeg').toFile(newPath).then((info) => {
      // console.log('File converted successfully');
      req.file.path = newPath; // point eventMap at new file
      fs.unlink(path, (deleteErr) => {
        // console.log('Error deleting PNG:', deleteErr);
        if (deleteErr) throw deleteErr;
      });
      return next();
    })
      .catch((conversionErr) => {
        // console.log('Error in file conversion:', conversionErr);
        throw conversionErr;
      });
  }
  return next();
};

module.exports = {
  uploadImage,
  uploadMap,
  convertPNG,
  errorHandler,
};
