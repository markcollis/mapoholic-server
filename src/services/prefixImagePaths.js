require('dotenv').config(); // import environment variables from .env file

// images will not be accessible if this environment variable is not defined
const prefix = process.env.IMAGE_URI || '';

const prefixImagePath = (imagePath) => {
  if (!imagePath || imagePath === '') return '';
  return `${prefix}/${imagePath}`;
};

// prefix profile image path in a user record prior to responding


// prefix all image paths in an event record prior to responding
const prefixEventImagePaths = (eventRecord) => {
  return {
    ...eventRecord,
    runners: eventRecord.runners.map((runner) => {
      return {
        ...runner,
        user: (runner.user.profileImage)
          ? {
            ...runner.user,
            profileImage: prefixImagePath(runner.user.profileImage),
          }
          : { ...runner.user },
        comments: runner.comments.map((comment) => {
          return {
            ...comment,
            author: {
              ...comment.author,
              profileImage: prefixImagePath(comment.author.profileImage),
            },
          };
        }),
        maps: runner.maps.map((eachMap) => {
          return {
            ...eachMap,
            course: prefixImagePath(eachMap.course),
            route: prefixImagePath(eachMap.route),
            overlay: prefixImagePath(eachMap.overlay),
          };
        }),
      };
    }),
  };
};

module.exports = {
  prefixImagePath,
  prefixEventImagePaths,
};
