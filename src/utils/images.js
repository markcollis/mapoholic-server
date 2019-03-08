const multer = require('multer'); // support for image upload
const logger = require('./logger');

// multer setup for uploading profile images and maps
const storage = multer.diskStorage({
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
const uploadImage = multer({
  storage,
  limits: {
    fileSize: 1000000, // 1MB limit for profile pics should be plenty!
  },
  // fileFilter(req, file, cb) {
  //   if (!file.mimetype.match(/image\/(jpeg|png)/)) {
  //   // if (!file.originalname.toLowerCase().match(/\.jpg|jpeg|png/)) {
  //     return cb(new Error('Needs to be a JPEG or PNG image.'));
  //   }
  //   return cb(undefined, true);
  // },
});
const uploadMap = multer({
  storage,
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

module.exports = {
  uploadImage,
  uploadMap,
  errorHandler,
};
