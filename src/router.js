// Export routing file that will be used in index.js
//   where app is the express instance.
const passport = require('passport');
const Authentication = require('./controllers/authentication');
const Users = require('./controllers/users');
const images = require('./utils/images');
const Clubs = require('./controllers/clubs');
const Events = require('./controllers/events');

require('./services/passport'); // passport config

// each route should have one of these three middleware options to set req.user
const requireAuth = passport.authenticate('jwt', { session: false }); // bearer token in header
const requireLogin = passport.authenticate('local', { session: false }); // request token
const publicRoute = (req, res, next) => { // anonymous access permitted, take care to limit response
  req.user = { role: 'anonymous' };
  next();
};

module.exports = (app) => {
  // *** /users routes ***  [User model]
  // create a user account, receive a token in return
  app.post('/users/', publicRoute, Authentication.signup);
  // log in to an existing user account, getting a token in return
  app.post('/users/login', requireLogin, Authentication.login);
  // reset password of specified user
  app.post('/users/:id/password', requireAuth, Authentication.passwordChange);
  // upload profile image for specified user
  app.post('/users/:id/profileImage', requireAuth, Users.validateProfileImagePermission,
    images.uploadImage.single('upload'), Users.postProfileImage, images.errorHandler);
  // retrieve a list of all users (ids) matching specified criteria
  app.get('/users', requireAuth, Users.getUserList);
  app.get('/users/public', publicRoute, Users.getUserList);
  // retrieve full details for the currently logged in user
  app.get('/users/me', requireAuth, Users.getLoggedInUser);
  // retrieve full details for the specified user
  app.get('/users/public/:id', publicRoute, Users.getUserById);
  app.get('/users/:id', requireAuth, Users.getUserById);
  // update the specified user (multiple amendment not supported)
  app.patch('/users/:id', requireAuth, Users.updateUser);
  // delete the specified user (multiple deletion not supported)
  app.delete('/users/:id', requireAuth, Users.deleteUser);
  // delete profile image of the specified user
  app.delete('/users/:id/profileImage', requireAuth, Users.deleteProfileImage);

  // *** /clubs routes ***  [Club model]
  // create a club
  // autopopulate Czech clubs from abbreviation
  app.post('/clubs', requireAuth, Clubs.createClub);
  // retrieve a list of all clubs (ids) matching specified criteria
  app.get('/clubs', publicRoute, Clubs.getClubList);
  // retrieve full details for the specified club
  app.get('/clubs/:id', publicRoute, Clubs.getClubById);
  // update the specified club (multiple amendment not supported)
  // try to populate ORIS if abbreviation changes and looks Czech
  app.patch('/clubs/:id', requireAuth, Clubs.updateClub);
  // delete the specified club (multiple deletion not supported)
  app.delete('/clubs/:id', requireAuth, Clubs.deleteClub);

  // *** /events routes ***  [OEvent and LinkedEvent models]
  // ids need to be more explicit as there are several types used

  // create an event (event level fields)
  app.post('/events', requireAuth, Events.createEvent);
  // create a new event linkage between the specified events
  app.post('/events/links', requireAuth, Events.createEventLink);
  // add user as a runner at the specified event (event.runners[] fields except maps)
  app.post('/events/:eventid/maps', requireAuth, Events.addEventRunner);
  // upload a scanned map to the specified event map document (maptitle for differentiation)
  // :mapid is the index in runners.maps, :maptype is either course or route
  // :maptitle is the label to use for each part of multi-part maps
  app.post('/events/:eventid/maps/:mapid/:maptype(course|route)/:maptitle', requireAuth,
    Events.validateMapUploadPermission, images.uploadMap.single('upload'),
    Events.postMap, images.errorHandler);
  // Post a new comment against the specified user's map in this event
  app.post('/events/:eventid/comments/:userid', requireAuth, Events.postComment);
  // create a new event using oris data *eventid is ORIS event id*
  // if a corresponding event is already in db, fill empty fields only
  // create runner fields for logged in user if found in ORIS (i.e. can use to add user to event)
  app.post('/events/oris/event/:oriseventid', requireAuth, Events.orisCreateEvent);
  // create a set of new events and auto-populate them based on the user's ORIS history
  app.post('/events/oris/user/:userid', requireAuth, Events.orisCreateUserEvents);

  // retrieve a list of all events (ids) matching specified criteria
  // [may include events without *maps* visible to current user, include number
  // of (visible) maps in returned list]
  app.get('/events', requireAuth, Events.getEventList);
  // retrieve a list of events as an anonymous browser
  app.get('/events/public', publicRoute, Events.getEventList);
  // retrieve a list of links between events matching specified criteria
  app.get('/events/links', publicRoute, Events.getEventLinks);
  // retrieve full details for the specified event
  // [including visible maps and basic info for linked events]
  app.get('/events/:eventid', requireAuth, Events.getEvent);
  // retrieve all visible details for the specified event as an anonymous browser
  app.get('/events/:eventid/public', publicRoute, Events.getEvent);

  // update the specified event (multiple amendment not supported)
  app.patch('/events/:eventid', requireAuth, Events.updateEvent);
  // update the specified runner and map data (multiple amendment not supported)
  app.patch('/events/:eventid/maps/:userid', requireAuth, Events.updateEventRunner);
  // update the specified link between events (multiple amendment not supported)
  app.patch('/events/links/:id', requireAuth, Events.updateEventLink);
  // edit the specified comment (multiple amendment not supported)
  app.patch('/events/:eventid/comments/:userid/:commentid', requireAuth, Events.updateComment);

  // delete the specified event (multiple delete not supported)
  // [will fail if other users have records attached to event, unless admin]
  app.delete('/events/:id', requireAuth, Events.deleteEvent);
  // delete the specified runner and map data (multiple amendment not supported)
  app.delete('/events/:eventid/maps/:userid', requireAuth, Events.deleteEventRunner);
  // delete the specified link between events (multiple amendment not supported)
  app.delete('/events/links/:id', requireAuth, Events.deleteEventLink);
  // delete the specified comment (multiple amendment not supported)
  app.delete('/events/:eventid/comments/:userid/:commentid', requireAuth, Events.deleteComment);


  //    *** to be deleted when others are complete ***
  app.get('/test', (req, res) => {
    res.send({ greeting: 'Hi there! No auth required here.' });
  });
  app.get('/', requireAuth, (req, res) => {
    res.send({ greeting: 'Hi there!' });
  });
  // add any other routes as required following the same pattern with
  // requireAuth and a callback for the desired action
  app.post('/login', requireLogin, Authentication.login); // => /users, front end to be changed
  app.post('/signup', Authentication.signup); // => /users, front end to be changed
};
