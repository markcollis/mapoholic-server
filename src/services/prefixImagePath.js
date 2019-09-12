require('dotenv').config(); // import environment variables from .env file

// images will not be accessible if this environment variable is not defined
const prefix = process.env.IMAGE_URI || '';

const prefixImagePath = (imagePath) => {
  if (!imagePath || imagePath === '') return '';
  return `${prefix}/${imagePath}`;
};

module.exports = {
  prefixImagePath,
};
