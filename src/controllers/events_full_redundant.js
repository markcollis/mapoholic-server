const { ObjectID } = require('mongodb');
const mongoose = require('mongoose');
const sharp = require('sharp');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
// const { getQRData, calculateDistance, projectPoint } = require('../utils/parseQR');
const { getQRData, calculateDistance } = require('../utils/parseQR');
// const url = require('url');
// const User = require('../models/user');
const Club = require('../models/club');
const Event = require('../models/oevent');
const LinkedEvent = require('../models/linkedEvent');
const logger = require('../utils/logger');
const logReq = require('./logReq');
const {
  validateClubIds,
  validateEventIds,
  validateLinkedEventIds,
  validateUserId,
} = require('./validateIds');
const { getOrisClubData } = require('./clubs');

// POST routes
// create an event (event level fields)
const createEvent = (req, res) => {
  logReq(req);
  const creatorRole = req.user.role;
  const creatorId = req.user._id;
  const eventDate = req.body.date;
  const eventName = req.body.name;
  // simple validation checks
  if (creatorRole === 'guest') {
    logger('error')('Error creating event: Guest accounts can not create an event.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to create an event.' });
  }
  if (!eventDate || !eventName) {
    logger('error')('Error creating event: No name and/or date provided.');
    return res.status(400).send({ error: 'You must provide an event\'s name and date.' });
  }
  if (!eventDate.match(/[1|2][0-9]{3}-((0[13578]|1[02])-(0[1-9]|[12][0-9]|3[01])|(0[469]|11)-(0[1-9]|[12][0-9]|30)|02-(0[1-9]|[12][0-9]))/)) {
    logger('error')('Error creating event: Invalid date provided.');
    return res.status(400).send({ error: 'The date format required is a string of the form "YYYY-MM-DD".' });
  } // note: basic input validation, doesn't check for leap years so 2019-02-29 would pass
  // now check that the date/name combination doesn't already exist
  return Event.findOne({ date: eventDate, name: eventName }).then((existingEvent) => {
    if (existingEvent) {
      logger('error')(`Error creating event: The event ${eventName} on ${eventDate} already exists.`);
      return res.status(400).send({ error: `Error creating event: The event ${eventName} on ${eventDate} already exists.` });
    }
    const fieldsToCreate = { owner: creatorId };
    const validFields = [ // owner is creator
      'date',
      'name',
      'mapName',
      'locPlace',
      'locRegions', // []
      'locCountry',
      'locLat',
      'locLong',
      'orisId',
      'types', // []
      'tags', // []
      'website',
      'results',
    ];
    Object.keys(req.body).forEach((key) => {
      if (validFields.includes(key)) {
        fieldsToCreate[key] = req.body[key];
      }
    });
    // organisedBy and linkedTo need special treatment: array of ObjectIDs
    // note that these will REPLACE the existing array not add to it/edit it
    const checkClubIds = (req.body.organisedBy && Array.isArray(req.body.organisedBy))
      ? validateClubIds(req.body.organisedBy)
      : Promise.resolve(false);
    const checkLinkedEventIds = (req.body.linkedTo && Array.isArray(req.body.linkedTo))
      ? validateLinkedEventIds(req.body.linkedTo)
      : Promise.resolve(false);
    return Promise.all([checkClubIds, checkLinkedEventIds]).then(([clubIds, linkedEventIds]) => {
      if (clubIds) {
        fieldsToCreate.organisedBy = clubIds;
      }
      if (linkedEventIds) {
        fieldsToCreate.linkedTo = linkedEventIds;
      }
      const newEvent = new Event(fieldsToCreate);
      return newEvent.save()
        .then((savedEvent) => {
          // add event reference to linkedEvents if there are any
          LinkedEvent.updateMany({ _id: { $in: (linkedEventIds || []) } },
            { $addToSet: { includes: savedEvent._id } })
            .then(() => {
              logger('success')(`${savedEvent.name} on ${savedEvent.date} created by ${req.user.email}.`);
              return res.status(200).send(savedEvent);
            });
        });
    }).catch((err) => {
      logger('error')('Error creating event:', err.message);
      return res.status(400).send({ error: err.message });
    });
  });
};

// create a new event linkage between the specified events
const createEventLink = (req, res) => {
  logReq(req);
  const creatorRole = req.user.role;
  const eventLinkName = req.body.displayName;
  const eventLinkIncludes = req.body.includes;
  // simple validation checks
  if (creatorRole === 'guest') {
    logger('error')('Error creating event link: Guest accounts can not create an event link.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to create an event link.' });
  }
  if (!eventLinkName) {
    logger('error')('Error creating event link: No name provided.');
    return res.status(400).send({ error: 'You must provide a name for the event link.' });
  }
  return LinkedEvent.findOne({ displayName: eventLinkName }).then((existingLinkedEvent) => {
    if (existingLinkedEvent) {
      logger('error')(`Error creating event link: The event link ${eventLinkName} already exists.`);
      return res.status(400).send({ error: `Error creating event link: The event link ${eventLinkName} already exists.` });
    }
    const fieldsToCreate = { displayName: eventLinkName };
    // includes needs special treatment: array of ObjectIDs
    // note that these will REPLACE the existing array not add to it/edit it
    const checkEventIds = (eventLinkIncludes && Array.isArray(eventLinkIncludes))
      ? validateEventIds(eventLinkIncludes)
      : Promise.resolve(false);
    return checkEventIds.then((eventIds) => {
      if (!eventIds) {
        logger('error')('Error creating event link: No valid event IDs found.');
        return res.status(400).send({ error: 'Error creating event link: No valid event IDs found' });
      }
      fieldsToCreate.includes = eventIds;
      const newLinkedEvent = new LinkedEvent(fieldsToCreate);
      return newLinkedEvent.save((err, savedLinkedEvent) => {
        savedLinkedEvent
          .populate('includes', '_id name date')
          .execPopulate()
          .then(() => {
            // now add the linkedEvent reference to the events concerned
            Event.updateMany({ _id: { $in: eventIds } },
              { $addToSet: { linkedTo: savedLinkedEvent._id } },
              { new: true })
              .then(() => {
                logger('success')(`${savedLinkedEvent.displayName} created by ${req.user.email}.`);
                return res.status(200).send(savedLinkedEvent);
              });
          });
      });
    }).catch((err) => {
      logger('error')('Error creating event link:', err.message);
      return res.status(400).send({ error: err.message });
    });
  });
};

// add current user as a runner at the specified event
const addEventRunner = (req, res) => {
  logReq(req);
  const { eventid } = req.params;
  const requestorRole = req.user.role;
  const requestorId = req.user._id.toString();
  if (requestorRole === 'guest') {
    logger('error')('Error: Guest accounts are not allowed to edit events.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to edit events.' });
  }
  const requestorClubs = req.user.memberOf.map(club => club._id.toString());
  if (!ObjectID.isValid(eventid)) {
    logger('error')('Error adding runner to event: invalid ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  // now need to check database to identify existing runners
  return Event.findById(eventid).then((eventToAddRunnerTo) => {
    if (!eventToAddRunnerTo) {
      logger('error')('Error adding runner to event: no matching event found.');
      return res.status(404).send({ error: 'Event could not be found.' });
    }
    const runnerIds = (eventToAddRunnerTo.runners.length === 0)
      ? []
      : eventToAddRunnerTo.runners.map(runner => runner.user.toString());
    // console.log('runnerIds:', runnerIds);
    if (runnerIds.includes(requestorId)) {
      logger('error')('Error adding runner to event: runner already present.');
      return res.status(400).send({ error: 'Runner already present in event. Use PATCH to update.' });
    }
    const fieldsToCreateRunner = { user: requestorId };
    const validFields = [ // all except maps and comments which have their own POST routes
      'visibility',
      // course details from ORIS getEvent Data.Classes.Class_nnnn.
      'courseTitle', // ORIS Name
      'courseLength', // ORIS Distance (km)
      'courseClimb', // ORIS Climbing (m)
      'courseControls', // ORIS Controls
      'fullResults', // [] allowed to submit manually, front end might not support initially though
      // following can be obtained if ORIS hosts results via getEventResults&eventid&classid
      'time', // hhh:mm Data.Result_nnnnn.Time [UserID=orisId]
      'place', // Data.Result_nnnn.Place
      'timeBehind', // Data.Result_nnnn.Loss
      'fieldSize', // can work out from ORIS result set length
      'distanceRun', // actual km - from GPS (or some manual measurement of route length)
      'tags', // []
    ];
    Object.keys(req.body).forEach((key) => {
      if (validFields.includes(key)) {
        fieldsToCreateRunner[key] = req.body[key];
      }
    });
    // console.log('fieldsToCreateRunner:', fieldsToCreateRunner);
    return Event.findByIdAndUpdate(eventid, { $addToSet: { runners: fieldsToCreateRunner } },
      { new: true })
      .populate('owner', '_id displayName')
      .populate('organisedBy', '_id shortName')
      .populate('linkedTo', '_id displayName')
      .populate({
        path: 'runners.user',
        select: '_id displayName fullName regNumber orisId profileImage visibility',
        populate: { path: 'memberOf', select: '_id shortName' },
      })
      .populate({
        path: 'runners.comments.author',
        select: '_id displayName fullName regNumber',
      })
      .select('-active -__v')
      .then((updatedEvent) => {
        const filteredEvent = updatedEvent;
        if (updatedEvent.runners.length > 0) {
          const selectedRunners = updatedEvent.runners.map((runner) => {
            let canSee = false;
            if (requestorRole === 'admin') canSee = true;
            if (runner.visibility === 'public') canSee = true;
            if ((requestorRole === 'standard') || (requestorRole === 'guest')) {
              if (runner.visibility === 'all') canSee = true;
              if (requestorId === runner.user._id.toString()) canSee = true;
              if (runner.visibility === 'club') {
                const commonClubs = runner.user.memberOf.filter((clubId) => {
                  return requestorClubs.includes(clubId.toString());
                });
                // console.log('commonClubs', commonClubs);
                if (commonClubs.length > 0) canSee = true;
              }
            }
            if (canSee) return runner;
            return false;
          });
          filteredEvent.runners = selectedRunners.filter(runner => runner);
        }
        logger('success')(`Added ${req.user.email} as runner to ${updatedEvent.name} (${updatedEvent.date}).`);
        return res.status(200).send(updatedEvent);
      })
      .catch((err) => {
        logger('error')('Error adding runner to event:', err.message);
        return res.status(400).send({ error: err.message });
      });
  }).catch((err) => {
    logger('error')('Error adding runner to event:', err.message);
    return res.status(400).send({ error: err.message });
  });
};

// app.post('/events/:eventid/oris', requireAuth, Events.orisAddEventRunner);
// add current user as a new runner using ORIS data
const orisAddEventRunner = (req, res) => {
  logReq(req);
  const { eventid } = req.params;
  const requestorRole = req.user.role;
  const requestorId = req.user._id.toString();
  const requestorOrisId = req.user.orisId;
  if (requestorRole === 'guest') {
    logger('error')('Error: Guest accounts are not allowed to edit events.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to edit events.' });
  }
  if (!requestorOrisId || requestorOrisId === '') {
    logger('error')('Error: You do not have an ORIS user ID.');
    return res.status(400).send({ error: 'User does not have an ORIS ID so cannot be added as a runner.' });
  }
  if (!ObjectID.isValid(eventid)) {
    logger('error')('Error adding runner to event: invalid ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  // now need to check database to identify event and runners
  return Event.findById(eventid).then((eventToAddRunnerTo) => {
    if (!eventToAddRunnerTo) {
      logger('error')('Error updating event: no matching event found.');
      return res.status(404).send({ error: 'Event could not be found.' });
    }
    if (!eventToAddRunnerTo.orisId || eventToAddRunnerTo.orisId === '') {
      logger('error')('Error adding runner: event does not have ORIS ID.');
      return res.status(400).send({ error: 'Event does not have ORIS ID.' });
    }
    const runnerIds = (eventToAddRunnerTo.runners.length === 0)
      ? []
      : eventToAddRunnerTo.runners.map(runner => runner.user.toString());
    if (runnerIds.includes(requestorId)) {
      logger('error')('Error adding runner to event: runner already present.');
      return res.status(400).send({ error: 'Runner already present in event. Use PATCH to update.' });
    }
    const ORIS_API_GETEVENT = 'https://oris.orientacnisporty.cz/API/?format=json&method=getEvent';
    const ORIS_API_GETEVENTENTRIES = 'https://oris.orientacnisporty.cz/API/?format=json&method=getEventEntries';
    const ORIS_API_GETEVENTRESULTS = 'https://oris.orientacnisporty.cz/API/?format=json&method=getEventResults';
    const getOrisEventData = fetch(`${ORIS_API_GETEVENT}&id=${eventToAddRunnerTo.orisId}`)
      .then(response => response.json());
    const getOrisEntryData = fetch(`${ORIS_API_GETEVENTENTRIES}&eventid=${eventToAddRunnerTo.orisId}`)
      .then(response => response.json());
    const getOrisResultsData = fetch(`${ORIS_API_GETEVENTRESULTS}&eventid=${eventToAddRunnerTo.orisId}`)
      .then(response => response.json());
    return Promise.all([getOrisEventData, getOrisEntryData, getOrisResultsData])
      .then(([orisEventData, orisEntryData, orisResultsData]) => {
        // console.log('ORIS requests made');
        const runnerEntryData = orisEntryData.Data[Object.keys(orisEntryData.Data)
          .filter((entryKey) => {
            return orisEntryData.Data[entryKey].UserID === requestorOrisId;
          })];
        let runnerClassData = null;
        if (runnerEntryData && runnerEntryData.ClassID) {
          runnerClassData = orisEventData.Data.Classes[`Class_${runnerEntryData.ClassID}`];
        }
        // console.log('runnerClassData:', runnerClassData);
        let classResultsData = null;
        let runnerResultsData = null;
        if (orisResultsData && Object.keys(orisResultsData.Data).length > 0) {
          classResultsData = Object.keys(orisResultsData.Data)
            .filter((resultKey) => {
              return orisResultsData.Data[resultKey].ClassID === runnerEntryData.ClassID;
            })
            .map(resultKey => orisResultsData.Data[resultKey]);
          runnerResultsData = classResultsData.find((result) => {
            return result.UserID === requestorOrisId;
          });
        }
        // console.log('classResultsData:', classResultsData);
        // console.log('runnerResultsData:', runnerResultsData);
        req.body = { visibility: req.user.visibility };
        if (runnerClassData) {
          req.body.courseTitle = runnerClassData.Name;
          req.body.courseLength = runnerClassData.Distance;
          req.body.courseClimb = runnerClassData.Climbing;
          req.body.courseControls = runnerClassData.Controls;
        }
        if (runnerResultsData) {
          req.body.time = runnerResultsData.Time;
          req.body.place = runnerResultsData.Place;
          req.body.timeBehind = runnerResultsData.Loss;
          req.body.fieldSize = classResultsData.length;
          req.body.fullResults = classResultsData.map((runner) => {
            return {
              place: runner.Place,
              sort: runner.Sort,
              name: runner.Name,
              regNumber: runner.RegNo,
              clubShort: runner.RegNo.slice(0, 3),
              club: runner.ClubNameResults,
              time: runner.Time,
              loss: runner.Loss,
            };
          });
        }
        // console.log('req.body:', req.body);
        return addEventRunner(req, res);
      })
      .catch((orisErr) => {
        logger('error')(`ORIS API error: ${orisErr.message}.`);
        return res.status(400).send({ error: orisErr.message });
      });
  });
};

// app.post('/events/:eventid/comments/:userid', requireAuth, Events.postComment);
// Post a new comment against the specified user's map in this event
const postComment = (req, res) => {
  logReq(req);
  const { eventid, userid } = req.params;
  const commentText = req.body.text;
  if (!commentText) {
    logger('error')('Error posting comment: no comment content.');
    return res.status(400).send({ error: 'No comment content.' });
  }
  const authorId = req.user._id.toString();
  const authorRole = req.user.role;
  if (authorRole === 'guest') {
    logger('error')('Error: Guest accounts are not allowed to post comments.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to post comments.' });
  }
  if (!ObjectID.isValid(eventid)) {
    logger('error')('Error posting comment: invalid event ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  if (!ObjectID.isValid(userid)) {
    logger('error')('Error posting comment: invalid runner ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  // now need to check database to confirm that runner at event exists
  return Event.findById(eventid).then((eventToPostCommentTo) => {
    if (!eventToPostCommentTo) {
      logger('error')('Error posting comment: no matching event found.');
      return res.status(404).send({ error: 'Event could not be found.' });
    }
    const runnerIds = (eventToPostCommentTo.runners.length === 0)
      ? []
      : eventToPostCommentTo.runners.map(runner => runner.user.toString());
    // console.log('runnerIds:', runnerIds);
    if (!runnerIds.includes(userid)) {
      logger('error')('Error posting comment: runner not present.');
      return res.status(400).send({ error: 'Runner not found in event, so not possible to add comment.' });
    }
    // const setObject = Object.keys(fieldsToUpdateRunner).reduce((acc, cur) => {
    //   return Object.assign(acc, { [`runners.$.${cur}`]: fieldsToUpdateRunner[cur] });
    // }, {});
    // console.log('setObject:', setObject);
    // const now = new Date();
    const newComment = {
      author: authorId,
      text: commentText,
      // postedAt: now, (this is the default)
      // updatedAt: now, (this is the default)
    };
    return Event.findOneAndUpdate(
      { _id: eventid, 'runners.user': userid },
      { $push: { 'runners.$.comments': newComment } },
      // { $set: setObject },
      // { $pull: { runners: { user: userid } } },  // to delete instead of update - use below
      { new: true },
    )
      .populate('owner', '_id displayName')
      .populate('organisedBy', '_id shortName')
      .populate('linkedTo', '_id displayName')
      .populate({
        path: 'runners.user',
        select: '_id displayName fullName regNumber orisId profileImage visibility',
        populate: { path: 'memberOf', select: '_id shortName' },
      })
      .populate({
        path: 'runners.comments.author',
        select: '_id displayName fullName regNumber',
      })
      .select('-active -__v')
      .then((updatedEvent) => {
        logger('success')(`Posted comment in ${updatedEvent.name} (${updatedEvent.date}).`);
        // try returning just the relevant comments array
        const runnerToSend = updatedEvent.runners
          .find(runner => runner.user._id.toString() === userid);
        const commentsToSend = runnerToSend.comments;
        // console.log('commentsToSend', commentsToSend);
        return res.status(200).send(commentsToSend);
        // return res.status(200).send(updatedEvent);
      })
      .catch((err) => {
        logger('error')('Error posting comment:', err.message);
        return res.status(400).send({ error: err.message });
      });
  }).catch((err) => {
    logger('error')('Error posting comment:', err.message);
    return res.status(400).send({ error: err.message });
  });
};

// upload a scanned map to the specified event for user :userid
// :maptype is either course or route
// :maptitle is the label to use for each part of multi-part maps (default: '')
// app.post('/events/:eventid/maps/:userid/:maptype(course|route)/:maptitle'
const validateMapUploadPermission = (req, res, next) => {
  const allowedToUploadMap = ((req.user.role === 'admin')
  || (req.user.role === 'standard' && req.user._id.toString() === req.params.userid));
  if (!allowedToUploadMap) {
    logger('error')(`Error: ${req.user.email} not allowed to upload map for ${req.params.userid}.`);
    return res.status(401).send({ error: 'Not allowed to upload map for this user.' });
  }
  return next();
};
const postMap = (req, res) => {
  logReq(req);
  if (!req.file) {
    logger('error')('Error: postMap request without image attached.');
    return res.status(400).send({ error: 'No map image file attached.' });
  }
  const {
    eventid,
    userid,
    maptype,
    maptitle,
  } = req.params;
  const title = maptitle || '';
  // check that event and user ids are appropriate format
  if (!ObjectID.isValid(eventid) || !ObjectID.isValid(userid)) {
    logger('error')('Error uploading map: invalid ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  const newFileLocation = path.join('images', 'maps', eventid, req.file.path.split('/').pop());
  // first make sure that the eventid folder exists
  return fs.mkdir(path.join('images', 'maps', eventid), (mkdirErr) => {
    if (mkdirErr && mkdirErr.code !== 'EEXIST') throw mkdirErr;
    fs.rename(req.file.path, newFileLocation, (renameErr) => {
      if (renameErr) throw renameErr;
      fs.readFile(newFileLocation, (err, data) => {
        if (err) throw err;
        // create thumbnail and extract
        const thumbnailSize = 200; // fit within square box of this dimension in pixels
        const extractWidth = 600; // pixels
        const extractHeight = 100; // pixels
        const thumbnail = newFileLocation.slice(0, -4).concat('-thumb').concat(newFileLocation.slice(-4));
        const extract = newFileLocation.slice(0, -4).concat('-extract').concat(newFileLocation.slice(-4));
        sharp(newFileLocation)
          .resize(thumbnailSize, thumbnailSize, { fit: 'inside' })
          .toFile(thumbnail, (thumbErr) => {
            sharp.cache(false); // stops really confusing behaviour if changing more than once!
            if (thumbErr) throw err;
          });
        sharp(newFileLocation)
          .metadata()
          .then((metadata) => {
            const centreX = Math.floor(metadata.width / 2);
            const centreY = Math.floor(metadata.height / 2);
            // check to limit size of extract for small images
            // (although real maps are unlikely to be this small)
            const newWidth = Math.min(metadata.width, extractWidth);
            const newHeight = Math.min(metadata.height, extractHeight);
            return sharp(newFileLocation)
              .extract({
                left: centreX - Math.floor(newWidth / 2),
                top: centreY - Math.floor(newHeight / 2),
                width: newWidth,
                height: newHeight,
              })
              .toFile(extract, (extractErr) => {
                sharp.cache(false); // stops really confusing behaviour if changing more than once!
                if (extractErr) throw err;
              });
          });
        // const toPrint = data.toString('hex').match(/../g).join(' ').slice(0, 512);
        // console.log(toPrint);
        // const parsedQR = quickRouteParser.parse(data);
        // console.log(JSON.stringify(parsedQR, null, 2));
        const qRData = getQRData(data);
        let trackCoords = [];
        let trackDistance = 0;
        if (qRData.sessions) { // assume first session, first route for now
          trackCoords = qRData.sessions.sessionData[0].route[0].waypoints;
          trackDistance = calculateDistance(trackCoords[0], trackCoords[1]);
          for (let i = 0; i < trackCoords.length - 2; i += 1) {
            trackDistance += calculateDistance(trackCoords[i], trackCoords[i + 1]);
          }
          // const origin = qRData.sessions.sessionData[0].projectionOrigin;
          // const matrix0 = qRData.sessions.sessionData[0].handles[0].transformationMatrix;
          // const matrix1 = qRData.sessions.sessionData[0].handles[1].transformationMatrix;
          // const matrix2 = qRData.sessions.sessionData[0].handles[2].transformationMatrix;
          // const matrix3 = qRData.sessions.sessionData[0].handles[3].transformationMatrix;
          // const offsetX = qRData.locationSizePixels.x;
          // const offsetY = qRData.locationSizePixels.y;
          // console.log('origin:', origin);
          // console.log('matrix0:', matrix0);
          // console.log('matrix1:', matrix1);
          // console.log('matrix2:', matrix2);
          // console.log('matrix3:', matrix3);
          // for (let j = 0; j < 576; j += 25) {
          //   console.log('track point:', j, trackCoords[j]);
          //   const projectedPoint = projectPoint(origin, trackCoords[j]);
          //   console.log('projected point:', projectedPoint);
          //   const transformedPoint0 = projectPoint(origin, trackCoords[j], matrix0);
          //   const transformedPoint1 = projectPoint(origin, trackCoords[j], matrix1);
          //   const transformedPoint2 = projectPoint(origin, trackCoords[j], matrix2);
          //   const transformedPoint3 = projectPoint(origin, trackCoords[j], matrix3);
          //   // console.log('transformed point0:', transformedPoint);
          // const offsetPoint0 = [transformedPoint0[0] + offsetX, transformedPoint0[1] + offsetY];
          //   console.log('offset point 0:', offsetPoint0);
          // const offsetPoint1 = [transformedPoint1[0] + offsetX, transformedPoint1[1] + offsetY];
          //   console.log('offset point 1:', offsetPoint1);
          // const offsetPoint2 = [transformedPoint2[0] + offsetX, transformedPoint2[1] + offsetY];
          //   console.log('offset point 2:', offsetPoint2);
          // const offsetPoint3 = [transformedPoint3[0] + offsetX, transformedPoint3[1] + offsetY];
          //   console.log('offset point 3:', offsetPoint3);
          // }
          // const { mapCorners } = qRData;
          // console.log('nw corner', mapCorners.nw.lat, mapCorners.nw.long);
          // console.log('maps to', projectPoint(origin, [mapCorners.nw.lat, mapCorners.nw.long]));
          // const transformedPoint0 = projectPoint(origin, [mapCorners.nw.lat, mapCorners.nw.long],
          // matrix0);
          // const transformedPoint1 = projectPoint(origin, [mapCorners.nw.lat, mapCorners.nw.long],
          // matrix1);
          // const transformedPoint2 = projectPoint(origin, [mapCorners.nw.lat, mapCorners.nw.long],
          // matrix2);
          // const transformedPoint3 = projectPoint(origin, [mapCorners.nw.lat, mapCorners.nw.long],
          // matrix3);
          // const offsetPoint0 = [transformedPoint0[0] + offsetX, transformedPoint0[1] + offsetY];
          // console.log('offset point 0:', offsetPoint0);
          // const offsetPoint1 = [transformedPoint1[0] + offsetX, transformedPoint1[1] + offsetY];
          // console.log('offset point 1:', offsetPoint1);
          // const offsetPoint2 = [transformedPoint2[0] + offsetX, transformedPoint2[1] + offsetY];
          // console.log('offset point 2:', offsetPoint2);
          // const offsetPoint3 = [transformedPoint3[0] + offsetX, transformedPoint3[1] + offsetY];
          // console.log('offset point 3:', offsetPoint3);
          // console.log('se corner', mapCorners.se.lat, mapCorners.se.long);
          // console.log('maps to', projectPoint(origin, [mapCorners.se.lat, mapCorners.se.long]));
          // console.log('origin', origin);
          // console.log('maps to', projectPoint(origin, origin));
          // console.log('trackCoords:', trackCoords);
          // console.log('trackDistance:', trackDistance);
        }
        const trackDistanceK = Math.floor(trackDistance) / 1000;
        // console.log(JSON.stringify(qRData, null, 2));
        return Event.findById(eventid)
          .then((foundEvent) => {
            const newEvent = foundEvent;
            let runnerExists = false;
            const newRunners = foundEvent.runners.map((runner) => {
              if (runner.user.toString() === userid) {
                runnerExists = true;
                let mapExists = false;
                runner.maps.map((map) => {
                  const newMap = map;
                  if (newMap.title === title) {
                    mapExists = true;
                    newMap[maptype] = newFileLocation;
                    if (qRData.isGeocoded) {
                      newMap.isGeocoded = true;
                      newMap.geo = {
                        mapCentre: qRData.mapCentre,
                        mapCorners: qRData.mapCorners,
                        imageCorners: qRData.imageCorners,
                        locationSizePixels: qRData.locationSizePixels,
                        track: trackCoords,
                        distanceRun: trackDistanceK,
                      };
                    }
                  }
                  return newMap;
                });
                if (!mapExists) {
                  const mapToAdd = {
                    title,
                    [maptype]: newFileLocation,
                  };
                  if (qRData.isGeocoded) {
                    mapToAdd.isGeocoded = true;
                    mapToAdd.geo = {
                      mapCentre: qRData.mapCentre,
                      mapCorners: qRData.mapCorners,
                      imageCorners: qRData.imageCorners,
                      locationSizePixels: qRData.locationSizePixels,
                      track: trackCoords,
                      distanceRun: trackDistanceK,
                    };
                  }
                  runner.maps.push(mapToAdd);
                }
              }
              return runner;
            });
            if (!runnerExists) {
              const runnerToAdd = {
                user: userid,
                maps: {
                  title,
                  [maptype]: newFileLocation,
                },
              };
              if (qRData.isGeocoded) {
                runnerToAdd.maps.isGeocoded = true;
                runnerToAdd.maps.geo = {
                  mapCentre: qRData.mapCentre,
                  mapCorners: qRData.mapCorners,
                  imageCorners: qRData.imageCorners,
                  locationSizePixels: qRData.locationSizePixels,
                  track: trackCoords,
                  distanceRun: trackDistanceK,
                };
              }
              newRunners.push(runnerToAdd);
            }
            // console.log('runners:', foundEvent.runners);
            // console.log('newRunners:', newRunners);
            newEvent.runners = newRunners;
            if (qRData.isGeocoded) {
              if (!foundEvent.locCornerSW || foundEvent.locCornerSW.length === 0) {
                newEvent.locCornerSW = [qRData.mapCorners.sw.lat, qRData.mapCorners.sw.long];
              }
              if (!foundEvent.locCornerNE || foundEvent.locCornerNE.length === 0) {
                newEvent.locCornerNE = [qRData.mapCorners.ne.lat, qRData.mapCorners.ne.long];
              }
              if (!foundEvent.locLat || foundEvent.locLat === '') {
                newEvent.locLat = qRData.mapCentre.lat;
              }
              if (!foundEvent.locLong || foundEvent.locLong === '') {
                newEvent.locLong = qRData.mapCentre.long;
              }
            }
            return newEvent.save();
          })
          .then((updatedEvent) => {
            // console.log('updatedEvent:', updatedEvent);
            logger('success')(`Map added to ${updatedEvent.name} by ${req.user.email}.`);
            return res.status(200).send(updatedEvent);
          }).catch((updateEventErr) => {
            logger('error')('Error recording updated map references:', updateEventErr.message);
            return res.status(400).send({ error: updateEventErr.message });
          });
      });
    });
  });
};

// delete the specified map (multiple deletion not supported)
// app.delete('/events/:eventid/maps/:userid/:maptype(course|route)/:maptitle?'
const deleteMap = (req, res) => {
  logReq(req);
  const allowedToDeleteMap = ((req.user.role === 'admin')
  || (req.user.role === 'standard' && req.user._id.toString() === req.params.userid));
  if (!allowedToDeleteMap) {
    logger('error')(`Error: ${req.user.email} not allowed to delete map for ${req.params.userid}.`);
    return res.status(401).send({ error: 'Not allowed to delete map for this user.' });
  }
  const {
    eventid,
    userid,
    maptype,
    maptitle,
  } = req.params;
  const title = maptitle || '';
  // check that event and user ids are appropriate format
  if (!ObjectID.isValid(eventid) || !ObjectID.isValid(userid)) {
    logger('error')('Error deleting map: invalid ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  return Event.findById(eventid)
    .lean() // return normal object rather than mongoose object instance
    .then((foundEvent) => { // determine what changes need to be made
      const foundRunner = foundEvent.runners.find(runner => runner.user.toString() === userid);
      if (!foundRunner) throw new Error('Runner does not exist.');
      const foundMap = foundRunner.maps.find(map => map.title === title);
      if (!foundMap) throw new Error('Map does not exist.');
      const newMapsArray = [];
      const otherMapType = (maptype === 'course') ? 'route' : 'course';
      foundRunner.maps.forEach((map) => {
        // console.log('map:', map);
        if (map.title === title) {
          if (foundMap[otherMapType] && foundMap[otherMapType] !== '') {
            // console.log('*** only need to set map[maptype] to null ***');
            // const updatedMap = { ...map, [maptype]: null };
            // console.log('updatedMap:', updatedMap);
            newMapsArray.push({ ...map, [maptype]: null });
          } else {
            // console.log('*** need to delete whole map from array ***');
          }
        } else {
          newMapsArray.push(map);
        }
      });
      // console.log('newMapsArray:', newMapsArray);
      return Event.findOneAndUpdate(
        { _id: eventid, 'runners.user': userid }, // identify and reference runner
        { $set: { 'runners.$.maps': newMapsArray } }, // update map array
        { new: true }, // return updated event to provide as API response
      );
    })
    .then((updatedEvent) => {
      logger('success')(`Map deleted from ${updatedEvent.name} by ${req.user.email}.`);
      return res.status(200).send(updatedEvent);
    })
    .catch((updateEventErr) => {
      logger('error')('Error deleting map:', updateEventErr.message);
      return res.status(400).send({ error: updateEventErr.message });
    });
};

// create a new event using oris data *eventid is ORIS event id*
// if a corresponding event is already in db, fill empty fields only
const orisCreateEvent = (req, res) => {
  logReq(req);
  const ORIS_API_GETEVENT = 'https://oris.orientacnisporty.cz/API/?format=json&method=getEvent';
  fetch(`${ORIS_API_GETEVENT}&id=${req.params.oriseventid}`)
    .then(response => response.json())
    .then((orisEvent) => {
      const eventData = orisEvent.Data;
      // console.log('eventData:', eventData);
      if (eventData.Stages !== '0') {
        const includedEvents = [eventData.Stage1, eventData.Stage2, eventData.Stage3,
          eventData.Stage4, eventData.Stage5, eventData.Stage6, eventData.Stage7];
        logger('error')('Error creating event from ORIS: multi-stage event parent');
        return res.status(400).send({ error: `This ORIS event ID is the parent of a multi-stage event. The individual events are ${includedEvents}.` });
      }
      // ? later work once linkedEvent ready - add the following 'big picture' actions instead:
      // 1. if Stages !== "0" create a linkedEvent record *instead* and then the events within
      // it (Stage1, Stage2, ... Stage7 if not "0")
      // 2. if ParentID !== null, create a linkedEvent record from that parent then the siblings
      // ORIS Data.ParentID, Data.Stages, Data.Stage1-7 have relevant information
      // also Data.Level.ShortName = ET (multi-day wrapper)
      const disciplineAndSportToType = {
        SP: 'Sprint', // ORIS SP Sprint Sprint
        KT: 'Middle', // ORIS KT Middle Krátká trať
        KL: 'Long', // ORIS KL Long Klasická trať
        DT: 'Ultra-Long', // ORIS DT Ultra-Long Dlouhá trať
        ST: 'Relay', // ORIS ST Relay Štafety
        NOB: 'Night', // ORIS NOB Night Noční (not combined with distance in ORIS)
        TeO: 'TempO', // ORIS TeO TempO TempO
        MS: 'Mass start', // ORIS MS Mass start Hromadný start
        MTBO: 'MTBO', // ORIS MTBO MTBO
        LOB: 'SkiO', // ORIS LOB SkiO
        TRAIL: 'TrailO', // ORIS TRAIL TrailO
      };
      const disciplineType = disciplineAndSportToType[eventData.Discipline.ShortName];
      const sportType = disciplineAndSportToType[eventData.Sport.NameCZ];
      const typesToCreate = [];
      if (disciplineType) typesToCreate.push(disciplineType);
      if (sportType) typesToCreate.push(disciplineType);
      req.body = {
        date: eventData.Date,
        name: eventData.Name,
        orisId: eventData.ID,
        mapName: eventData.Map,
        locPlace: eventData.Place,
        locRegions: eventData.Region.split(', '),
        locCountry: 'CZE',
        locLat: parseFloat(eventData.GPSLat),
        locLong: parseFloat(eventData.GPSLon),
        types: typesToCreate,
        website: `https://oris.orientacnisporty.cz/Zavod?id=${eventData.ID}`,
        results: `https://oris.orientacnisporty.cz/Vysledky?id=${eventData.ID}`,
        // always a valid page, whether or not there are any results stored
      };
      // console.log('Documents:', eventData.Documents);
      // console.log('length:', eventData.Documents.length);
      if (Object.keys(eventData.Documents).length > 0) {
        Object.keys(eventData.Documents).forEach((documentRef) => {
          // console.log('documentRef:', documentRef);
          if (eventData.Documents[documentRef].SourceType.ID === '4') {
            req.body.results = eventData.Documents[documentRef].Url;
          }
        });
      }
      if (!['E', 'ET', 'S', 'OST'].includes(eventData.Level.ShortName)) {
        req.body.tags = [eventData.Level.NameCZ];
      }
      // check to see if clubs exist and, if so, get their id; otherwise create them
      const firstClub = eventData.Org1.Abbr;
      const secondClub = eventData.Org2.Abbr || false;
      return Club.find({ shortName: [firstClub, secondClub] }).then((foundClubs) => {
        // console.log('foundClubs:', foundClubs);
        const foundClubsAbbr = foundClubs.map(foundClub => foundClub.shortName);
        const foundClubsIds = foundClubs.map(foundClub => foundClub._id);
        // console.log('foundClubsAbbr', foundClubsAbbr, 'foundClubsIds', foundClubsIds);
        const clubOneNeeded = firstClub && !foundClubsAbbr.includes(firstClub);
        const clubTwoNeeded = secondClub && !foundClubsAbbr.includes(secondClub);
        const checkOrisOne = (clubOneNeeded) ? getOrisClubData(firstClub) : Promise.resolve(false);
        const checkOrisTwo = (clubTwoNeeded) ? getOrisClubData(secondClub) : Promise.resolve(false);
        Promise.all([checkOrisOne, checkOrisTwo]).then((orisData) => {
          // console.log('orisData:', orisData);
          const createClubs = orisData.map((clubData) => {
            if (!clubData) return Promise.resolve(false);
            // console.log('clubData:', clubData);
            const fieldsToCreate = {
              owner: req.user._id,
              shortName: clubData.Abbr,
              fullName: clubData.Name,
              orisId: clubData.ID,
              country: 'CZE',
              website: clubData.WWW,
            };
            const newClub = new Club(fieldsToCreate);
            return newClub.save().then(() => {
              logger('success')(`${newClub.shortName} created by ${req.user.email} alongside event.`);
              return newClub;
            });
          });
          Promise.all(createClubs).then((createdClubs) => {
            const createdClubsIds = createdClubs.map(createdClub => createdClub._id);
            // console.log('createdClubsIds', createdClubsIds);
            // console.log('foundClubsIds', foundClubsIds);
            req.body.organisedBy = createdClubsIds.concat(foundClubsIds);
            return createEvent(req, res);
          }).catch((err) => {
            logger('error')('Error creating club alongside event:', err.message);
            return res.status(400).send({ error: err.message });
          });
        });
      });
    })
    .catch((orisErr) => {
      logger('error')(`ORIS API error: ${orisErr.message}.`);
      return res.status(400).send({ error: orisErr.message });
    });
};

// create a set of new events and auto-populate them based on the user's ORIS history
const orisCreateUserEvents = (req, res) => {
  logReq(req);
  res.status(400).send('Not yet implemented');
};
// it may be unwise to ever implement this due to the volume of data this could populate
// automatically. See orisGetUserEvents for accessing a list of candidate ORIS events to add

// GET routes
// return a list of summary details of all events in ORIS associated with the current user
const orisGetUserEvents = (req, res) => {
  logReq(req);
  if (!req.user.orisId) {
    logger('error')(`Error: No ORIS userid identified for ${req.user.email}.`);
    return res.status(400).send({ error: 'You do not have an associated ORIS userid' });
  }
  let dateFilter = ''; // supports passthrough of date filtering, front end default could be 1yr?
  if (req.query.datefrom) {
    if (req.query.datefrom.match(/[1|2][0-9]{3}-((0[13578]|1[02])-(0[1-9]|[12][0-9]|3[01])|(0[469]|11)-(0[1-9]|[12][0-9]|30)|02-(0[1-9]|[12][0-9]))/)) {
      dateFilter = dateFilter.concat(`&datefrom=${req.query.datefrom}`);
    } // note: basic input validation, doesn't check for leap years so 2019-02-29 would pass
  }
  if (req.query.dateto) {
    if (req.query.dateto.match(/[1|2][0-9]{3}-((0[13578]|1[02])-(0[1-9]|[12][0-9]|3[01])|(0[469]|11)-(0[1-9]|[12][0-9]|30)|02-(0[1-9]|[12][0-9]))/)) {
      dateFilter = dateFilter.concat(`&dateto=${req.query.dateto}`);
    } // note: basic input validation, doesn't check for leap years so 2019-02-29 would pass
  }
  // console.log('dateFilter:', dateFilter);
  const ORIS_API_GETUSEREVENTENTRIES = 'https://oris.orientacnisporty.cz/API/?format=json&method=getUserEventEntries';
  return fetch(`${ORIS_API_GETUSEREVENTENTRIES}&userid=${req.user.orisId}${dateFilter}`)
    .then(response => response.json())
    .then((orisEventList) => {
      const eventsEntered = Object.keys(orisEventList.Data).map((entry) => {
        const eventDetails = {
          orisEntryId: orisEventList.Data[entry].ID,
          orisClassId: orisEventList.Data[entry].ClassID,
          orisEventId: orisEventList.Data[entry].EventID,
          date: orisEventList.Data[entry].EventDate,
          class: orisEventList.Data[entry].ClassDesc,
        };
        return eventDetails;
      });
      const ORIS_API_GETEVENT = 'https://oris.orientacnisporty.cz/API/?format=json&method=getEvent';
      const expandOrisDetails = eventsEntered.map((eachEvent) => {
        return fetch(`${ORIS_API_GETEVENT}&id=${eachEvent.orisEventId}`)
          .then(response => response.json())
          .then((orisEvent) => {
            const eventData = {
              orisEventId: orisEvent.Data.ID,
              date: orisEvent.Data.Date,
              name: orisEvent.Data.Name,
              place: orisEvent.Data.Place,
              organiser: orisEvent.Data.Org1.Abbr,
            };
            if (orisEvent.Data.Stages !== '0') {
              const includedEvents = [orisEvent.Data.Stage1, orisEvent.Data.Stage2,
                orisEvent.Data.Stage3, orisEvent.Data.Stage4, orisEvent.Data.Stage5,
                orisEvent.Data.Stage6, orisEvent.Data.Stage7];
              eventData.includedEvents = includedEvents.filter(el => el !== '0');
            }
            return eventData;
          });
      });
      Promise.all(expandOrisDetails).then((details) => {
        // console.log('details', details);
        for (let i = 0; i < eventsEntered.length; i += 1) {
          eventsEntered[i].name = details[i].name;
          eventsEntered[i].place = details[i].place;
          if (details[i].includedEvents) {
            eventsEntered[i].includedEvents = details[i].includedEvents;
          }
        }
        logger('success')(`Returned list of ${eventsEntered.length} event(s) entered by ${req.user.email} (${req.user.orisId}).`);
        res.status(200).send(eventsEntered);
      });
    })
    .catch((orisErr) => {
      logger('error')(`ORIS API error: ${orisErr.message}.`);
      return res.status(400).send({ error: orisErr.message });
    });
};

// retrieve a list of all events matching specified criteria
// [may include events without *maps* visible to current user, include number
// of (visible) maps in returned list]
const getEventList = (req, res) => {
  logReq(req);
  // set up requestor information for later filtering of runners
  const requestorRole = req.user.role;
  const requestorId = (requestorRole === 'anonymous')
    ? null
    : req.user._id.toString();
  const requestorClubs = (requestorRole === 'anonymous')
    ? null
    : req.user.memberOf.map(club => club._id.toString());
  const eventSearchCriteria = { active: true };
  // support basic filtering using query strings
  const validStringFilters = ['date', 'name', 'orisId', 'mapName', 'locName',
    'locPlace', 'locRegions', 'locCountry', 'types', 'tags', 'website', 'results'];
  const validIdFilters = ['owner', 'organisedBy', 'linkedTo', 'runners'];
  Object.keys(req.query).forEach((key) => {
    // console.log('filtering on', key, req.query[key]);
    if (validStringFilters.includes(key)) {
      eventSearchCriteria[key] = { $regex: new RegExp(req.query[key]) };
    }
    if (validIdFilters.includes(key)) {
      // needs custom treatment to avoid ObjectID cast error/return empty array if no such owner
      if (ObjectID.isValid(req.query[key])) {
        if (key === 'runners') {
          eventSearchCriteria.runners = { $elemMatch: { user: req.query.runners } };
        } else {
          eventSearchCriteria[key] = req.query[key];
        }
      }
    }
  });
  // locLat and locLong need a different approach (<, >) as they are numbers, not strings
  // query of the format ?lat=x-y / ?lat=x- / ?lat=-y for ranges sought
  if (req.query.locLat) {
    const lowLat = parseFloat(req.query.locLat.split('-')[0]) || 0;
    const highLat = parseFloat(req.query.locLat.split('-')[1]) || 90;
    // console.log('low', low, 'high', high);
    eventSearchCriteria.locLat = { $gt: lowLat, $lt: highLat };
  }
  if (req.query.locLong) {
    const lowLong = parseFloat(req.query.locLong.split('-')[0]) || -180;
    const highLong = parseFloat(req.query.locLong.split('-')[1]) || 180;
    // console.log('low', low, 'high', high);
    eventSearchCriteria.locLong = { $gt: lowLong, $lt: highLong };
  }
  // console.log('eventSearchCriteria:', JSON.stringify(eventSearchCriteria));
  Event.find(eventSearchCriteria)
    .populate('owner', '_id displayName')
    .populate('organisedBy', '_id shortName')
    .populate('linkedTo', '_id displayName')
    .populate('runners.user', '_id displayName memberOf active')
    .select('-active -__v')
    .then((events) => {
      // process to reduce level of detail and exclude non-visible runners
      const eventsSummary = events.map((foundEvent) => {
        const eventDetails = {
          _id: foundEvent._id,
          orisId: foundEvent.orisId,
          date: foundEvent.date,
          name: foundEvent.name,
          mapName: foundEvent.mapName,
          locPlace: foundEvent.locPlace,
          locCountry: foundEvent.locCountry,
          locLat: foundEvent.locLat,
          locLong: foundEvent.locLong,
          locCornerSW: foundEvent.locCornerSW,
          locCornerNE: foundEvent.locCornerNE,
          organisedBy: foundEvent.organisedBy,
          linkedTo: foundEvent.linkedTo,
          types: foundEvent.types,
          tags: foundEvent.tags,
        };
        if (foundEvent.runners.length > 0) {
          const selectedRunners = foundEvent.runners.map((runner) => {
            let canSee = false;
            if (requestorRole === 'admin' && runner.user.active) canSee = true;
            // deleted users remain in the runners array but should be ignored
            if (runner.visibility === 'public') canSee = true;
            if ((requestorRole === 'standard') || (requestorRole === 'guest')) {
              if (runner.visibility === 'all') canSee = true;
              if (requestorId === runner.user._id.toString()) canSee = true;
              if (runner.visibility === 'club') {
                const commonClubs = runner.user.memberOf.filter((clubId) => {
                  return requestorClubs.includes(clubId.toString());
                });
                // console.log('commonClubs', commonClubs);
                if (commonClubs.length > 0) canSee = true;
              }
            }
            if (canSee) {
              const mapFiles = [];
              runner.maps.forEach((map) => {
                const { course, route } = map;
                if (course && course !== '') {
                  mapFiles.push(course);
                } else if (route && route !== '') {
                  mapFiles.push(route);
                }
              });
              const extractName = (mapFiles.length > 0)
                ? mapFiles[0].slice(0, -4).concat('-extract').concat(mapFiles[0].slice(-4))
                : null;
              return {
                user: runner.user._id,
                displayName: runner.user.displayName,
                courseTitle: runner.user.courseTitle,
                numberMaps: runner.maps.length,
                mapExtract: extractName,
              };
            }
            return false;
          });
          eventDetails.runners = selectedRunners.filter(runner => runner);
          // eventDetails.totalRunners = eventDetails.runners.length;
        }
        return eventDetails;
      });
      logger('success')(`Returned list of ${eventsSummary.length} event(s).`);
      return res.status(200).send(eventsSummary);
    })
    .catch((err) => {
      logger('error')('Error getting list of events:', err.message);
      return res.status(400).send(err.message);
    });
};

// retrieve a list of links between events matching specified criteria
const getEventLinks = (req, res) => {
  logReq(req);
  const eventLinkSearchCriteria = {};
  if (req.query.displayName) { // filter by name
    eventLinkSearchCriteria.displayName = { $regex: new RegExp(req.query.displayName) };
  }
  if (req.query.includes) { // filter by event (to include this specific event)
    if (ObjectID.isValid(req.query.includes)) {
      eventLinkSearchCriteria.includes = req.query.includes;
    } else {
      eventLinkSearchCriteria.includes = null;
    }
  }
  LinkedEvent.find(eventLinkSearchCriteria)
    .populate('includes', '_id name date')
    .select('-__v')
    .then((linkedEvents) => {
      logger('success')(`Returned list of ${linkedEvents.length} event link(s).`);
      return res.status(200).send(linkedEvents);
    })
    .catch((err) => {
      logger('error')('Error getting list of event links:', err.message);
      return res.status(400).send(err.message);
    });
};

// retrieve full details for the specified event
// [including visible maps and basic info for linked events]
const getEvent = (req, res) => {
  logReq(req);
  // set up requestor information for later filtering of runners
  const requestorRole = req.user.role;
  const requestorId = (requestorRole === 'anonymous')
    ? null
    : req.user._id.toString();
  const requestorClubs = (requestorRole === 'anonymous')
    ? null
    : req.user.memberOf.map(club => club._id.toString());
  const { eventid } = req.params;
  if (!ObjectID.isValid(eventid)) {
    logger('error')('Error getting event details: invalid ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  return Event.findOne({ _id: eventid, active: true })
    .populate('owner', '_id displayName')
    .populate('organisedBy', '_id shortName')
    .populate('linkedTo', '_id displayName')
    .populate({
      path: 'runners.user',
      select: '_id active displayName fullName regNumber orisId profileImage visibility',
      populate: { path: 'memberOf', select: '_id shortName' },
    })
    .populate({
      path: 'runners.comments.author',
      select: '_id displayName fullName active profileImage',
    })
    .select('-active -__v')
    .then((foundEvent) => {
      if (!foundEvent) {
        logger('error')('Error getting event details: no event found.');
        return res.status(404).send({ error: 'No event found.' });
      }
      const filteredEvent = foundEvent;
      if (foundEvent.runners.length > 0) {
        const selectedRunners = foundEvent.runners.map((runner) => {
          let canSee = false;
          if (requestorRole === 'admin' && runner.user.active) canSee = true;
          if (runner.visibility === 'public') canSee = true;
          if ((requestorRole === 'standard') || (requestorRole === 'guest')) {
            if (runner.visibility === 'all') canSee = true;
            if (requestorId === runner.user._id.toString()) canSee = true;
            if (runner.visibility === 'club') {
              const commonClubs = runner.user.memberOf.filter((clubId) => {
                return requestorClubs.includes(clubId.toString());
              });
              // console.log('commonClubs', commonClubs);
              if (commonClubs.length > 0) canSee = true;
            }
          }
          if (canSee) return runner;
          return false;
        });
        filteredEvent.runners = selectedRunners.filter(runner => runner);
      }
      logger('success')(`Returned event details for ${foundEvent.name} (${foundEvent.date}).`);
      return res.status(200).send(filteredEvent);
    })
    .catch((err) => {
      logger('error')('Error getting event details:', err.message);
      return res.status(400).send({ error: err.message });
    });
};

// PATCH routes
// update the specified event (multiple amendment not supported)
const updateEvent = (req, res) => {
  logReq(req);
  const { eventid } = req.params;
  const requestorRole = req.user.role;
  const requestorId = req.user._id.toString();
  if (requestorRole === 'guest') {
    logger('error')('Error: Guest accounts are not allowed to edit events.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to edit events.' });
  }
  if (!ObjectID.isValid(eventid)) {
    logger('error')('Error updating event: invalid ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  if (req.body.date) { // check that the date is valid IF an updated one is provided
    if (!req.body.date.match(/[1|2][0-9]{3}-((0[13578]|1[02])-(0[1-9]|[12][0-9]|3[01])|(0[469]|11)-(0[1-9]|[12][0-9]|30)|02-(0[1-9]|[12][0-9]))/)) {
      logger('error')('Error updating event: Invalid date provided.');
      return res.status(400).send({ error: 'The date format required is a string of the form YYYY-MM-DD.' });
    } // note: basic input validation, doesn't check for leap years so 2019-02-29 would pass
  }
  // now check that the date/name combination doesn't already exist
  return Event.findOne({ date: req.body.date, name: req.body.name }).then((existingEvent) => {
    if (existingEvent && existingEvent._id.toString() !== eventid) {
      logger('error')(`Error updating event: The event ${req.body.name} on ${req.body.date} already exists.`);
      return res.status(400).send({ error: `Error updating event: The event ${req.body.name} on ${req.body.date} already exists.` });
    }
    // now need to check database to identify owner and runners
    return Event.findById(eventid).then((eventToUpdate) => {
      if (!eventToUpdate) {
        logger('error')('Error updating event: no matching event found.');
        return res.status(404).send({ error: 'Event could not be found.' });
      }
      const runnerIds = (eventToUpdate.runners.length === 0)
        ? []
        : eventToUpdate.runners.map(runner => runner.user);
      // console.log('runnerIds:', runnerIds);
      const currentLinkedEvents = (eventToUpdate.linkedTo.length === 0)
        ? []
        : eventToUpdate.linkedTo.map(linkedEvent => linkedEvent.toString());
      // console.log('currentLinkedEvents:', currentLinkedEvents);
      const allowedToUpdate = ((requestorRole === 'admin')
      || (requestorRole === 'standard' && requestorId === eventToUpdate.owner.toString())
      || (requestorRole === 'standard' && runnerIds.includes(requestorId)));
      // console.log('allowedToUpdate', allowedToUpdate);
      if (allowedToUpdate) {
        const fieldsToUpdate = { };
        const validFields = [
          // Note: it is not possible to add an ORIS event ID and auto-populate if
          // an event wasn't created from ORIS originally. If there is a demand for
          // this it would be using e.g. PATCH /event/:eventid/oris/:oriseventid
          // calling a new, different function. Not a priority for now.
          'date',
          'name',
          'mapName',
          'locPlace',
          'locRegions', // []
          'locCountry',
          'locLat',
          'locLong',
          'types', // []
          'tags', // []
          'website',
          'results',
        ];
        Object.keys(req.body).forEach((key) => {
          if (validFields.includes(key)) {
            fieldsToUpdate[key] = req.body[key];
          }
        });
        // organisedBy and linkedTo need special treatment: array of ObjectIDs
        // note that these will REPLACE the existing array not add to it/edit it
        const checkClubIds = (req.body.organisedBy && Array.isArray(req.body.organisedBy))
          ? validateClubIds(req.body.organisedBy)
          : Promise.resolve(false);
        const checkLinkedEventIds = (req.body.linkedTo && Array.isArray(req.body.linkedTo))
          ? validateLinkedEventIds(req.body.linkedTo)
          : Promise.resolve(false);
        // only admin users can change a club's owner, need to check that ID is really a user
        const checkOwnerId = (req.body.owner && requestorRole === 'admin')
          ? validateUserId(req.body.owner)
          : Promise.resolve(false);
        return Promise.all([checkClubIds, checkLinkedEventIds, checkOwnerId])
          .then(([clubIds, linkedEventIds, ownerId]) => {
            if (clubIds) {
              fieldsToUpdate.organisedBy = clubIds;
            }
            if (linkedEventIds) {
              fieldsToUpdate.linkedTo = linkedEventIds;
            }
            const newLinkedEvents = (linkedEventIds)
              ? linkedEventIds.map(el => el.toString())
              : eventToUpdate.linkedTo;
            // console.log('newLinkedEvents:', newLinkedEvents);
            const addedLinkedEventIds = newLinkedEvents
              .filter(id => !currentLinkedEvents.includes(id));
            const removedLinkedEventIds = currentLinkedEvents
              .filter(id => !newLinkedEvents.includes(id));
            // console.log('added:', addedLinkedEventIds, 'removed:', removedLinkedEventIds);
            if (ownerId) fieldsToUpdate.owner = req.body.owner;
            // console.log('fieldsToUpdate:', fieldsToUpdate);
            const numberOfFieldsToUpdate = Object.keys(fieldsToUpdate).length;
            // console.log('fields to be updated:', numberOfFieldsToUpdate);
            if (numberOfFieldsToUpdate === 0) {
              logger('error')('Update event error: no valid fields to update.');
              return res.status(400).send({ error: 'No valid fields to update.' });
            }
            return Event.findByIdAndUpdate(eventid, { $set: fieldsToUpdate }, { new: true })
              .populate('owner', '_id displayName')
              .populate('organisedBy', '_id shortName')
              .populate('linkedTo', '_id displayName')
              .populate({
                path: 'runners.user',
                select: '_id displayName fullName regNumber orisId profileImage visibility',
                populate: { path: 'memberOf', select: '_id shortName' },
              })
              .populate({
                path: 'runners.comments.author',
                select: '_id displayName fullName regNumber',
              })
              .select('-active -__v')
              .then((updatedEvent) => {
                // now change the Event references in relevant LinkedEvents
                LinkedEvent.updateMany({ _id: { $in: (addedLinkedEventIds || []) } },
                  { $addToSet: { includes: updatedEvent._id } })
                  .then(() => {
                    LinkedEvent.updateMany({ _id: { $in: (removedLinkedEventIds || []) } },
                      { $pull: { includes: updatedEvent._id } })
                      .then(() => {
                        logger('success')(`${updatedEvent.name} (${updatedEvent.date}) updated by ${req.user.email} (${numberOfFieldsToUpdate} field(s)).`);
                        return res.status(200).send(updatedEvent);
                      });
                  });
              })
              .catch((err) => {
                logger('error')('Error updating event:', err.message);
                return res.status(400).send({ error: err.message });
              });
          });
      }
      logger('error')(`Error: ${req.user.email} not allowed to update ${eventid}.`);
      return res.status(401).send({ error: 'Not allowed to update this event.' });
    });
  }).catch((err) => {
    logger('error')('Error updating event:', err.message);
    return res.status(400).send({ error: err.message });
  });
};

// update the specified runner and map data (multiple amendment not supported)
const updateEventRunner = (req, res) => {
  logReq(req);
  const { eventid, userid } = req.params;
  const requestorRole = req.user.role;
  const requestorId = req.user._id.toString();
  if (requestorRole === 'guest') {
    logger('error')('Error: Guest accounts are not allowed to edit events.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to edit events.' });
  }
  if (!ObjectID.isValid(eventid)) {
    logger('error')('Error updating runner at event: invalid event ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  if (!ObjectID.isValid(userid)) {
    logger('error')('Error updating runner at event: invalid runner ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  // now need to check database to confirm that runner at event exists
  return Event.findById(eventid).then((eventToUpdateRunnerAt) => {
    if (!eventToUpdateRunnerAt) {
      logger('error')('Error updating runner at event: no matching event found.');
      return res.status(404).send({ error: 'Event could not be found.' });
    }
    const runnerIds = (eventToUpdateRunnerAt.runners.length === 0)
      ? []
      : eventToUpdateRunnerAt.runners.map(runner => runner.user.toString());
    // console.log('runnerIds:', runnerIds);
    if (!runnerIds.includes(userid)) {
      logger('error')('Error updating runner at event: runner not present.');
      return res.status(400).send({ error: 'Runner not present in event. Use POST to add.' });
    }
    const allowedToUpdate = ((requestorRole === 'admin')
    || (requestorRole === 'standard' && requestorId === userid));
    if (allowedToUpdate) {
      const fieldsToUpdateRunner = {};
      const validFields = [ // all except comments which have their own PATCH route
        'visibility',
        'courseTitle', // ORIS Name
        'courseLength', // ORIS Distance (km)
        'courseClimb', // ORIS Climbing (m)
        'courseControls', // ORIS Controls
        'fullResults', // [] will replace entire set of results recorded
        'time', // hhh:mm Data.Result_nnnnn.Time [UserID=orisId]
        'place', // Data.Result_nnnn.Place
        'timeBehind', // Data.Result_nnnn.Loss
        'fieldSize', // can work out from ORIS result set length
        'distanceRun', // actual km - from GPS (or some manual measurement of route length)
        'tags', // [] will replace entire set of tags
        'maps', // [] *** important *** will replace the entire map record, request must be complete
      ];
      Object.keys(req.body).forEach((key) => {
        if (validFields.includes(key)) {
          fieldsToUpdateRunner[key] = req.body[key];
        }
      });
      // console.log('fieldsToUpdateRunner:', fieldsToUpdateRunner);
      const numberOfFieldsToUpdate = Object.keys(fieldsToUpdateRunner).length;
      // console.log('fields to be updated:', numberOfFieldsToUpdate);
      if (numberOfFieldsToUpdate === 0) {
        logger('error')('Update runner at event error: no valid fields to update.');
        return res.status(400).send({ error: 'No valid fields to update.' });
      }
      const setObject = Object.keys(fieldsToUpdateRunner).reduce((acc, cur) => {
        return Object.assign(acc, { [`runners.$.${cur}`]: fieldsToUpdateRunner[cur] });
      }, {});
      // console.log('setObject:', setObject);
      return Event.findOneAndUpdate(
        { _id: eventid, 'runners.user': userid },
        { $set: setObject },
        // { $pull: { runners: { user: userid } } },  // to delete instead of update - use below
        { new: true },
      )
        .populate('owner', '_id displayName')
        .populate('organisedBy', '_id shortName')
        .populate('linkedTo', '_id displayName')
        .populate({
          path: 'runners.user',
          select: '_id displayName fullName regNumber orisId profileImage visibility',
          populate: { path: 'memberOf', select: '_id shortName' },
        })
        .populate({
          path: 'runners.comments.author',
          select: '_id displayName fullName regNumber',
        })
        .select('-active -__v')
        .then((updatedEvent) => {
          logger('success')(`Updated ${req.user.email} in ${updatedEvent.name} (${updatedEvent.date}) (${numberOfFieldsToUpdate} field(s)).`);
          return res.status(200).send(updatedEvent);
        })
        .catch((err) => {
          logger('error')('Error updating runner at event:', err.message);
          return res.status(400).send({ error: err.message });
        });
    }
    logger('error')(`Error: ${req.user.email} not allowed to update runner ${userid}.`);
    return res.status(401).send({ error: 'Not allowed to update this runner.' });
  }).catch((err) => {
    logger('error')('Error updating runner at event:', err.message);
    return res.status(400).send({ error: err.message });
  });
};

// update the specified link between events (multiple amendment not supported)
const updateEventLink = (req, res) => {
  logReq(req);
  const { eventlinkid } = req.params;
  const requestorRole = req.user.role;
  if (requestorRole === 'guest') { // guests can't edit, but all standard users can
    logger('error')('Error: Guest accounts are not allowed to edit event links.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to edit event links.' });
  }
  if (!ObjectID.isValid(eventlinkid)) {
    logger('error')('Error updating event link: invalid ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  return LinkedEvent.findById(eventlinkid).then((linkedEventToUpdate) => {
    if (!linkedEventToUpdate) {
      logger('error')('Error updating event link: no matching event found.');
      return res.status(404).send({ error: 'Event link could not be found.' });
    }
    const currentIncludes = linkedEventToUpdate.includes.map(el => el.toString());
    // console.log('includes before editing:', currentIncludes);
    const fieldsToUpdate = {};
    if (req.body.displayName && req.body.displayName !== linkedEventToUpdate.displayName) {
      fieldsToUpdate.displayName = req.body.displayName;
    }
    const checkEventIds = (req.body.includes && Array.isArray(req.body.includes))
      ? validateEventIds(req.body.includes)
      : Promise.resolve(false);
    return checkEventIds.then((eventIds) => {
      if (eventIds) fieldsToUpdate.includes = eventIds;
      const newIncludes = (eventIds)
        ? eventIds.map(el => el.toString())
        : linkedEventToUpdate.includes;
      // console.log('eventIds to be new includes:', newIncludes);
      const addedEventIds = newIncludes.filter(eventId => !currentIncludes.includes(eventId));
      const removedEventIds = currentIncludes.filter(eventId => !newIncludes.includes(eventId));
      // console.log('added, removed:', addedEventIds, removedEventIds);
      const numberOfFieldsToUpdate = Object.keys(fieldsToUpdate).length;
      if (numberOfFieldsToUpdate === 0) {
        logger('error')('Update event link error: no valid fields to update.');
        return res.status(400).send({ error: 'No valid fields to update.' });
      }
      return LinkedEvent.findByIdAndUpdate(eventlinkid, { $set: fieldsToUpdate }, { new: true })
        .populate('includes', '_id name date')
        .select('-__v')
        .then((updatedLinkedEvent) => {
          // now change the linkedEvent references in relevant Events
          Event.updateMany({ _id: { $in: (addedEventIds || []) } },
            { $addToSet: { linkedTo: mongoose.Types.ObjectId(updatedLinkedEvent._id) } })
            .then(() => {
              Event.updateMany({ _id: { $in: (removedEventIds || []) } },
                { $pull: { linkedTo: mongoose.Types.ObjectId(updatedLinkedEvent._id) } })
                .then(() => {
                  logger('success')(`${updatedLinkedEvent.displayName} updated by ${req.user.email} (${numberOfFieldsToUpdate} field(s)).`);
                  return res.status(200).send(updatedLinkedEvent);
                });
            });
        })
        .catch((err) => {
          logger('error')('Error updating linked event:', err.message);
          return res.status(400).send({ error: err.message });
        });
    });
  });
};

// app.patch('/events/:eventid/comments/:userid/:commentid', requireAuth, Events.updateComment);
// edit the specified comment (multiple amendment not supported)
const updateComment = (req, res) => {
  logReq(req);
  const { eventid, userid, commentid } = req.params;
  const newCommentText = req.body.text;
  if (!newCommentText) {
    logger('error')('Error updating comment: no comment content.');
    return res.status(400).send({ error: 'No comment content.' });
  }
  const authorId = req.user._id.toString();
  const authorRole = req.user.role;
  if (authorRole === 'guest') {
    logger('error')('Error: Guest accounts are not allowed to update comments.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to update comments.' });
  }
  if (!ObjectID.isValid(eventid)) {
    logger('error')('Error updating comment: invalid event ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  if (!ObjectID.isValid(userid)) {
    logger('error')('Error updating comment: invalid runner ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  // now need to check database to confirm that runner at event exists
  return Event.findById(eventid).then((eventToUpdateComment) => {
    if (!eventToUpdateComment) {
      logger('error')('Error updating comment: no matching event found.');
      return res.status(404).send({ error: 'Event could not be found.' });
    }
    const runnerIds = (eventToUpdateComment.runners.length === 0)
      ? []
      : eventToUpdateComment.runners.map(runner => runner.user.toString());
    // console.log('runnerIds:', runnerIds);
    if (!runnerIds.includes(userid)) {
      logger('error')('Error updating comment: runner not found.');
      return res.status(400).send({ error: 'Runner not found in event, so not possible to edit comment.' });
    }
    const selectedRunner = eventToUpdateComment.runners
      .find(runner => runner.user.toString() === userid);
    const selectedComment = selectedRunner.comments
      .find(comment => comment._id.toString() === commentid);
    if (!selectedComment) {
      logger('error')('Error updating comment: comment not found.');
      return res.status(400).send({ error: 'The specified comment was not found so could not be updated.' });
    }
    if (selectedComment.author.toString() !== authorId) {
      logger('error')('Error updating comment: you are not the author.');
      return res.status(400).send({ error: 'Only a comment\'s author can update it.' });
    }
    const now = new Date();
    return Event.findOneAndUpdate(
      { _id: eventid, runners: { $elemMatch: { user: userid, 'comments._id': commentid } } },
      {
        $set: {
          'runners.$[outer].comments.$[inner].text': newCommentText,
          'runners.$[outer].comments.$[inner].updatedAt': now,
        },
      },
      {
        arrayFilters: [{ 'outer.user': userid }, { 'inner._id': commentid }],
        new: true,
      },
    )
      .populate('owner', '_id displayName')
      .populate('organisedBy', '_id shortName')
      .populate('linkedTo', '_id displayName')
      .populate({
        path: 'runners.user',
        select: '_id displayName fullName regNumber orisId profileImage visibility',
        populate: { path: 'memberOf', select: '_id shortName' },
      })
      .populate({
        path: 'runners.comments.author',
        select: '_id displayName fullName regNumber',
      })
      .select('-active -__v')
      .then((updatedEvent) => {
        logger('success')(`Updated comment in ${updatedEvent.name} (${updatedEvent.date}).`);
        const runnerToSend = updatedEvent.runners
          .find(runner => runner.user._id.toString() === userid);
        const commentsToSend = runnerToSend.comments;
        return res.status(200).send(commentsToSend); // don't send full event
        // return res.status(200).send(updatedEvent);
      })
      .catch((err) => {
        logger('error')('Error updating comment:', err.message);
        return res.status(400).send({ error: err.message });
      });
  }).catch((err) => {
    logger('error')('Error updating comment:', err.message);
    return res.status(400).send({ error: err.message });
  });
};

// DELETE routes
// Delete the specified event (multiple delete not supported)
// Actually sets active=false rather than true delete (i.e. recoverable on server)
// Will fail if other users have records attached to event, unless done by admin
const deleteEvent = (req, res) => {
  logReq(req);
  const { eventid } = req.params;
  const requestorRole = req.user.role;
  const requestorId = req.user._id.toString();
  if (!ObjectID.isValid(eventid)) {
    logger('error')('Error deleting event: invalid ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  return Event.findById(eventid).then((eventToDelete) => {
    if (!eventToDelete) {
      logger('error')('Error deleting event: no matching event found.');
      return res.status(404).send({ error: 'Event could not be found.' });
    }
    // can only delete if owner is the only runner or there are no runners
    // (forcing the deletion of other runners before the event can go)
    const isAdmin = (requestorRole === 'admin');
    const isOwner = (requestorRole === 'standard'
      && requestorId === eventToDelete.owner.toString());
    // const hasPermissionToDelete = ((requestorRole === 'admin')
    // || (requestorRole === 'standard' && requestorId === eventToDelete.owner.toString()));
    const noOtherRunners = (eventToDelete.runners.length === 0)
      || (eventToDelete.runners.filter((runner) => {
        return (runner.user.toString() !== requestorId);
      }).length === 0);
    const ownerAlone = (isOwner && noOtherRunners);
    // console.log('has permission:', hasPermissionToDelete, 'no others:', noOtherRunners);
    const allowedToDelete = isAdmin || ownerAlone;
    // console.log('doesn\'t actually delete yet!');
    // const allowedToDelete = false;
    if (allowedToDelete) {
      const now = new Date();
      const deletedAt = 'deleted:'.concat((`0${now.getDate()}`).slice(-2))
        .concat((`0${(now.getMonth() + 1)}`).slice(-2))
        .concat(now.getFullYear().toString())
        .concat('@')
        .concat((`0${now.getHours()}`).slice(-2))
        .concat((`0${now.getMinutes()}`).slice(-2));
      const newName = `${eventToDelete.name} ${deletedAt}`;
      const newOrisId = (eventToDelete.orisId)
        ? `${eventToDelete.orisId} ${deletedAt}`
        : null;
      return Event.findByIdAndUpdate(eventid,
        { $set: { active: false, name: newName, orisId: newOrisId } },
        { new: true })
        .then((deletedEvent) => {
          // console.log('deletedEvent:', deletedEvent);
          const { _id: deletedEventId, name } = deletedEvent;
          // delete any references in LinkedEvents
          LinkedEvent.updateMany({},
            { $pull: { includes: mongoose.Types.ObjectId(deletedEventId) } })
            .then(() => {
              logger('success')(`Successfully deleted event ${deletedEventId} (${name})`);
              return res.status(200).send(deletedEvent);
            });
        })
        .catch((err) => {
          logger('error')('Error deleting event:', err.message);
          return res.status(400).send({ error: err.message });
        });
    }
    logger('error')(`Error: ${req.user.email} not allowed to delete ${eventid}.`);
    return res.status(401).send({ error: 'Not allowed to delete this event.' });
  });
};

// app.delete('/events/:eventid/maps/:userid', requireAuth, Events.deleteEventRunner);
// delete the specified runner and map data (multiple amendment not supported) - actually deletes!
const deleteEventRunner = (req, res) => {
  logReq(req);
  const { eventid, userid } = req.params;
  const requestorId = req.user._id.toString();
  const requestorRole = req.user.role;
  if (requestorRole === 'guest') {
    logger('error')('Error: Guest accounts are not allowed to delete runners.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to delete runners.' });
  }
  const isAdmin = (requestorRole === 'admin');
  const isRunner = (requestorRole === 'standard' && requestorId === userid);
  const canDelete = isAdmin || isRunner;
  if (!canDelete) {
    logger('error')('Error: You are not allowed to delete this runner.');
    return res.status(401).send({ error: 'Not allowed to delete this runner.' });
  }
  if (!ObjectID.isValid(eventid)) {
    logger('error')('Error deleting runner: invalid event ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  if (!ObjectID.isValid(userid)) {
    logger('error')('Error deleting runner: invalid runner ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  // now need to check database to confirm that runner at event exists
  return Event.findById(eventid).then((eventToDeleteRunner) => {
    if (!eventToDeleteRunner) {
      logger('error')('Error deleting runner: no matching event found.');
      return res.status(404).send({ error: 'Event could not be found.' });
    }
    const selectedRunner = eventToDeleteRunner.runners
      .find(runner => runner.user.toString() === userid);
    if (!selectedRunner) {
      logger('error')('Error deleting runner: runner not found.');
      return res.status(400).send({ error: 'Runner not found in event, so can not be deleted.' });
    }
    // all checks done, can now delete
    return Event.findOneAndUpdate(
      { _id: eventid },
      { $pull: { runners: { user: userid } } },
      { new: true },
    )
      .populate('owner', '_id displayName')
      .populate('organisedBy', '_id shortName')
      .populate('linkedTo', '_id displayName')
      .populate({
        path: 'runners.user',
        select: '_id displayName fullName regNumber orisId profileImage visibility',
        populate: { path: 'memberOf', select: '_id shortName' },
      })
      .populate({
        path: 'runners.comments.author',
        select: '_id displayName fullName regNumber',
      })
      .select('-active -__v')
      .then((updatedEvent) => {
        logger('success')(`Deleted runner from ${updatedEvent.name} (${updatedEvent.date}).`);
        return res.status(200).send(updatedEvent);
      })
      .catch((err) => {
        logger('error')('Error deleting runner:', err.message);
        return res.status(400).send({ error: err.message });
      });
  }).catch((err) => {
    logger('error')('Error deleting runner:', err.message);
    return res.status(400).send({ error: err.message });
  });
};

// delete the specified link between events (multiple amendment not supported) - actually deletes!
const deleteEventLink = (req, res) => {
  logReq(req);
  const { eventlinkid } = req.params;
  const requestorRole = req.user.role;
  if (!ObjectID.isValid(eventlinkid)) {
    logger('error')('Error deleting event link: invalid ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  // only admin users are allowed to delete linkedEvents
  if (requestorRole === 'admin') {
    return LinkedEvent.findById(eventlinkid).then((linkedEventToDelete) => {
      if (!linkedEventToDelete) {
        logger('error')('Error deleting event link: no matching event link found.');
        return res.status(404).send({ error: 'Event link could not be found.' });
      }
      return LinkedEvent.deleteOne({ _id: eventlinkid }).then((deletion) => {
        if (deletion.deletedCount === 1) {
          // should now go through and delete all references from Event.linkedTo
          return Event.updateMany({ _id: { $in: (linkedEventToDelete.includes || []) } },
            { $pull: { linkedTo: mongoose.Types.ObjectId(linkedEventToDelete._id) } })
            .then(() => {
              logger('success')(`Successfully deleted event link ${linkedEventToDelete._id} (${linkedEventToDelete.displayName})`);
              return res.status(200).send(linkedEventToDelete);
            });
        }
        logger('error')('Error deleting event link: deletedCount not 1');
        return res.status(400).send({ error: 'Error deleting event link: deletedCount not 1' });
      })
        .catch((err) => {
          logger('error')('Error deleting event link:', err.message);
          return res.status(400).send({ error: err.message });
        });
    });
  }
  logger('error')(`Error: ${req.user.email} not allowed to delete ${eventlinkid}.`);
  return res.status(401).send({ error: 'Not allowed to delete this event link.' });
};

// app.delete('/events/:eventid/comments/:userid/:commentid', requireAuth, Events.deleteComment);
// delete the specified comment (multiple amendment not supported) - actually deletes!
const deleteComment = (req, res) => {
  logReq(req);
  const { eventid, userid, commentid } = req.params;
  const authorId = req.user._id.toString();
  const authorRole = req.user.role;
  if (authorRole === 'guest') {
    logger('error')('Error: Guest accounts are not allowed to delete comments.');
    return res.status(401).send({ error: 'Guest accounts are not allowed to delete comments.' });
  }
  if (!ObjectID.isValid(eventid)) {
    logger('error')('Error deleting comment: invalid event ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  if (!ObjectID.isValid(userid)) {
    logger('error')('Error deleting comment: invalid runner ObjectID.');
    return res.status(400).send({ error: 'Invalid ID.' });
  }
  // now need to check database to confirm that runner at event exists
  return Event.findById(eventid).then((eventToDeleteComment) => {
    if (!eventToDeleteComment) {
      logger('error')('Error deleting comment: no matching event found.');
      return res.status(404).send({ error: 'Event could not be found.' });
    }
    const runnerIds = (eventToDeleteComment.runners.length === 0)
      ? []
      : eventToDeleteComment.runners.map(runner => runner.user.toString());
    if (!runnerIds.includes(userid)) {
      logger('error')('Error deleting comment: runner not found.');
      return res.status(400).send({ error: 'Runner not found in event, so not possible to delete comment.' });
    }
    const selectedRunner = eventToDeleteComment.runners
      .find(runner => runner.user.toString() === userid);
    const selectedComment = selectedRunner.comments
      .find(comment => comment._id.toString() === commentid);
    if (!selectedComment) {
      logger('error')('Error deleting comment: comment not found.');
      return res.status(400).send({ error: 'The specified comment was not found so could not be deleted.' });
    }
    if (selectedComment.author.toString() !== authorId && authorRole !== 'admin') {
      logger('error')('Error deleting comment: you are not the author or an administrator.');
      return res.status(400).send({ error: 'Only a comment\'s author or an administrator can delete it.' });
    }
    return Event.findOneAndUpdate(
      { _id: eventid, 'runners.user': userid },
      { $pull: { 'runners.$.comments': { _id: commentid } } },
      { new: true },
    )
      .populate('owner', '_id displayName')
      .populate('organisedBy', '_id shortName')
      .populate('linkedTo', '_id displayName')
      .populate({
        path: 'runners.user',
        select: '_id displayName fullName regNumber orisId profileImage visibility',
        populate: { path: 'memberOf', select: '_id shortName' },
      })
      .populate({
        path: 'runners.comments.author',
        select: '_id displayName fullName regNumber',
      })
      .select('-active -__v')
      .then((updatedEvent) => {
        logger('success')(`Deleted comment in ${updatedEvent.name} (${updatedEvent.date}).`);
        const runnerToSend = updatedEvent.runners
          .find(runner => runner.user._id.toString() === userid);
        const commentsToSend = runnerToSend.comments;
        return res.status(200).send(commentsToSend); // don't send full event
        // return res.status(200).send(updatedEvent);
      })
      .catch((err) => {
        logger('error')('Error deleting comment:', err.message);
        return res.status(400).send({ error: err.message });
      });
  }).catch((err) => {
    logger('error')('Error deleting comment:', err.message);
    return res.status(400).send({ error: err.message });
  });
};

module.exports = {
  createEvent,
  createEventLink,
  addEventRunner,
  orisAddEventRunner,
  postComment,
  validateMapUploadPermission,
  postMap,
  orisCreateEvent,
  orisCreateUserEvents,
  orisGetUserEvents,
  getEventList,
  getEventLinks,
  getEvent,
  updateEvent,
  updateEventLink,
  updateEventRunner,
  updateComment,
  deleteEvent,
  deleteEventLink,
  deleteEventRunner,
  deleteMap,
  deleteComment,
};
